// ============================================================================
//  Chittorgarh adapter — PRIMARY source.
//
//  Chosen as primary because it is the only source verified to publish, in one
//  place and machine-readably, the field this whole app depends on: the BASIS OF
//  ALLOTMENT date. NSE/BSE endpoints block data-centre IPs and do not expose
//  allotment dates in a usable form.
//
//  Two endpoints, both confirmed working:
//
//  1. LIST  (JSON API behind the site's report pages)
//       https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/1/{year}/{fy}/0/{board}
//     - {board} is literally "mainboard" or "sme" and MUST be the last segment.
//     - {year} is the calendar year and is what actually selects the data set.
//     - Returns { reportTableData: [...], totalRecords, totalPages }.
//     - Gives symbol/ISIN/open/close/listing/price — but NO allotment date.
//
//  2. DETAIL (server-rendered page carrying Next.js RSC flight data)
//       https://www.chittorgarh.com/ipo/{slug}/{id}/
//     - Carries timetable_boa_dt (basis of allotment), anchor_portion_size,
//       shares_offered_anchor_investor, registrar_name, subscription figures.
//
//  Marked lowerTrust because it is a third-party aggregator, not an exchange filing.
// ============================================================================

import type { Board } from "../lockin-rules";
import { politeFetchJson, politeFetchText } from "./http";
import type { IpoSourceAdapter, IsoDate, RawIpoDetail, RawIpoRecord } from "./types";

// Report 82 = "IPO in India list". Carries symbol/ISIN/price but NO allotment date.
const LIST_BASE = "https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/1";

// Report 118 = "IPO list by timetable and lot size". Carries the basis-of-allotment
// date (~Timetable_BOA_dt) for every IPO in one request, and covers past years that
// report 82 does not return. This is the primary listing: it makes a multi-year
// backfill one request per (year, board) instead of one request per IPO.
const TIMETABLE_BASE = "https://webnodejs.chittorgarh.com/cloud/report/data-read/118/1/1";
const SITE = "https://www.chittorgarh.com";
const REFERER = { Referer: `${SITE}/` };

interface ListResponse {
  reportTableData?: Record<string, unknown>[];
  totalRecords?: number;
}

// --- parsing helpers ---------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Decode the HTML entities Chittorgarh embeds (e.g. &#8377; for ₹). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).trim();
}

/**
 * Parse Chittorgarh's human date formats into an ISO civil date:
 *   "Friday, December 26, 2025"  |  "December 26, 2025"
 * Returns undefined for anything unrecognised — never guesses.
 */
export function parseHumanDate(raw: string | undefined | null): IsoDate | undefined {
  if (!raw) return undefined;
  const s = decodeEntities(String(raw)).replace(/^[A-Za-z]+,\s*/, "").trim();
  const m = /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (!m) return undefined;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return undefined;
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Take the yyyy-MM-dd prefix of an ISO timestamp the list API returns. */
function isoDayOf(raw: unknown): IsoDate | undefined {
  if (typeof raw !== "string" || raw.length < 10) return undefined;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/**
 * Parse a quantity or money amount where ZERO IS NOT A REAL VALUE.
 *
 * Chittorgarh emits "0" / "0.00" for fields it has not published yet — an upcoming
 * IPO's issue size, an undisclosed anchor allocation. Storing that as 0 turns
 * "not disclosed" into the factual claim "zero rupees" / "zero shares", which then
 * renders as a real number in the UI instead of "—". No genuine IPO has a zero issue
 * size, zero price or zero anchor allocation, so zero is always absence here.
 */
export function parsePositiveNum(raw: unknown): number | undefined {
  const n = parseNum(raw);
  return n === undefined || n <= 0 ? undefined : n;
}

/** Parse a number that may carry ₹, commas, or be an empty string. */
export function parseNum(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const cleaned = decodeEntities(String(raw)).replace(/[₹,\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/** Pull the numeric IPO id and slug out of the Company cell's anchor tag. */
function parseCompanyCell(html: string): { id?: string; slug?: string; name: string } {
  const m = /\/ipo\/([a-z0-9-]+)\/(\d+)\//i.exec(html);
  return { slug: m?.[1], id: m?.[2], name: stripTags(html) };
}

/**
 * Extract Next.js RSC flight data from a server-rendered page.
 * The payload arrives as many `self.__next_f.push([1,"<escaped>"])` chunks; decoding
 * each as a JSON string and concatenating reconstructs the original text.
 */
export function extractFlightData(html: string): string {
  const chunks: string[] = [];
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      chunks.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // A chunk that won't decode is skipped rather than failing the whole parse.
    }
  }
  return chunks.join("");
}

/**
 * Find the balanced JSON object enclosing `idx`, honouring strings and escapes.
 * Returns the raw object text, or null if braces don't balance.
 */
export function enclosingObject(text: string, idx: number): string | null {
  // Single forward pass tracking string/escape state. A backward scan cannot work
  // here: brace characters occur inside string values (and the payload is full of
  // them), and scanning backwards gives no way to know whether a brace is quoted.
  const stack: number[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;

    if (c === "{") {
      stack.push(i);
    } else if (c === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      // First object to close while spanning idx is the innermost enclosing one.
      if (start <= idx && idx <= i) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Locate the IPO's OWN record object inside the flight payload.
 *
 * This matters for correctness: every IPO page also embeds a peer-comparison table
 * carrying other companies' `company_name` values. Reading fields by scanning the
 * whole payload mixes records together and yields a real IPO's symbol beside a peer
 * company's name. Scoping every read to one parsed object prevents that.
 *
 * When `slug` is supplied it is used both as the anchor and as an identity check, so
 * a redirect to some other page yields null instead of wrong data.
 */
export function findRecordObject(
  flight: string,
  slug?: string,
): Record<string, unknown> | null {
  const anchors = slug
    ? [`"urlrewrite_folder_name":"${slug}"`, `"timetable_boa_dt"`, `"company_name"`]
    : [`"timetable_boa_dt"`, `"urlrewrite_folder_name"`, `"company_name"`];

  for (const anchor of anchors) {
    let from = 0;
    for (;;) {
      const idx = flight.indexOf(anchor, from);
      if (idx < 0) break;
      from = idx + anchor.length;
      const objText = enclosingObject(flight, idx);
      if (!objText) continue;
      try {
        const obj = JSON.parse(objText) as Record<string, unknown>;
        // The main record is field-rich; peer-table entries carry only a handful.
        if (Object.keys(obj).length < 30) continue;
        if (slug && obj["urlrewrite_folder_name"] && obj["urlrewrite_folder_name"] !== slug) {
          continue;
        }
        return obj;
      } catch {
        // Not valid JSON at this boundary — try the next occurrence.
      }
    }
  }
  return null;
}

/** Read a string field from a parsed record, treating blanks as absent. */
export function fieldOf(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/**
 * Read a key's value out of the raw flight text. Retained for list-level and
 * diagnostic use; detail parsing uses findRecordObject so records never mix.
 * Takes the LAST occurrence. Returns undefined when absent or blank.
 */
export function readField(flight: string, key: string): string | undefined {
  const re = new RegExp(`"${key}":\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(-?[\\d.]+))`, "g");
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(flight))) {
    if (m[1] !== undefined) {
      try {
        last = JSON.parse(`"${m[1]}"`) as string;
      } catch {
        last = m[1];
      }
    } else if (m[2] !== undefined) {
      last = m[2];
    }
  }
  const trimmed = last?.trim();
  return trimmed ? trimmed : undefined;
}

function boardParam(board: Board): string {
  return board === "MAINBOARD" ? "mainboard" : "sme";
}

/** Financial year label for a calendar year, e.g. 2026 -> "2026-27". */
function fyLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

// --- adapter -----------------------------------------------------------------

export class ChittorgarhAdapter implements IpoSourceAdapter {
  readonly name = "chittorgarh";
  readonly priority = 1;
  readonly lowerTrust = true;

  /** Calendar years to pull. Defaults to this year and last year. */
  constructor(private readonly years: number[] = defaultYears()) {}

  async fetchUpcomingIPOs(): Promise<RawIpoRecord[]> {
    const out: RawIpoRecord[] = [];
    for (const board of ["MAINBOARD", "SME"] as const) {
      for (const year of this.years) {
        // Timetable report first: it supplies allotment dates and covers past years.
        try {
          out.push(...(await this.fetchTimetableList(board, year)));
        } catch (err) {
          console.warn(`[chittorgarh] timetable ${board} ${year} failed:`, (err as Error).message);
        }
        // Report 82 adds symbol/ISIN/price for the same IPOs; merged by sourceId below.
        try {
          out.push(...(await this.fetchList(board, year)));
        } catch (err) {
          console.warn(`[chittorgarh] list ${board} ${year} failed:`, (err as Error).message);
        }
      }
    }

    // Merge duplicates by sourceId, filling gaps rather than letting the later row win:
    // the two reports carry complementary fields for the same IPO.
    const merged = new Map<string, RawIpoRecord>();
    for (const row of out) {
      const prior = merged.get(row.sourceId);
      merged.set(row.sourceId, prior ? mergeRecords(prior, row) : row);
    }
    return [...merged.values()];
  }

  /**
   * Report 118 — one request per (year, board), including the basis-of-allotment
   * date. `year` is passed both in the path and as ?year= because the endpoint has
   * been observed to honour the query parameter for historical years.
   */
  async fetchTimetableList(board: Board, year: number): Promise<RawIpoRecord[]> {
    const url = `${TIMETABLE_BASE}/${year}/${fyLabel(year)}/0/${boardParam(board)}?year=${year}`;
    const json = await politeFetchJson<ListResponse>(url, { headers: REFERER });
    const rows = json.reportTableData ?? [];

    return rows.flatMap((row): RawIpoRecord[] => {
      const id = row["~id"];
      const name = stripTags(String(row["Company"] ?? ""));
      if (id === undefined || id === null || !name) return [];

      // Only trust rows whose declared type matches the board we asked for.
      const declared = String(row["Issue Type"] ?? "").toLowerCase();
      if (declared && !declared.includes(board === "SME" ? "sme" : "main")) return [];

      const allotmentDate = isoDayOf(row["~Timetable_BOA_dt"]);
      return [
        {
          sourceId: String(id),
          slug: (row["~urlrewrite_folder_name"] as string) || undefined,
          companyName: name,
          board,
          issueOpenDate: isoDayOf(row["~Issue_Open_Date"]),
          issueCloseDate: isoDayOf(row["~Issue_Close_Date"]),
          listingDate: isoDayOf(row["~IPO_Listing_date"]),
          // Published by the source, so it qualifies as the highest-confidence tier.
          allotmentDate,
          allotmentDateSource: allotmentDate ? "BASIS_OF_ALLOTMENT" : undefined,
          source: this.name,
        },
      ];
    });
  }

  async fetchList(board: Board, year: number): Promise<RawIpoRecord[]> {
    const url = `${LIST_BASE}/${year}/${fyLabel(year)}/0/${boardParam(board)}`;
    const json = await politeFetchJson<ListResponse>(url, { headers: REFERER });
    const rows = json.reportTableData ?? [];

    return rows.flatMap((row): RawIpoRecord[] => {
      const { id, slug, name } = parseCompanyCell(String(row["Company"] ?? ""));
      if (!id || !name) return [];
      const symbol = String(row["~nse_symbol"] ?? "").trim();
      const isin = String(row["~isin"] ?? "").trim();
      return [
        {
          sourceId: id,
          slug,
          companyName: name,
          board,
          symbol: symbol || undefined,
          isin: isin || undefined,
          issueOpenDate: isoDayOf(row["~Issue_Open_Date"]),
          issueCloseDate: isoDayOf(row["~IssueCloseDate"]),
          listingDate: isoDayOf(row["~ListingDate"]),
          ipoPriceFinal: parsePositiveNum(row["Issue Price (Rs.)"]),
          issueSizeCr: parsePositiveNum(row["Issue Amount (Rs.cr.)"]),
          source: this.name,
        },
      ];
    });
  }

  /** `idOrSlugged` is the numeric source id; slug is optional but yields a cleaner URL. */
  async fetchIPODetail(idOrSlugged: string, board: Board, slug?: string): Promise<RawIpoDetail | null> {
    const path = slug ? `${slug}/${idOrSlugged}` : `ipo/${idOrSlugged}`;
    const url = slug ? `${SITE}/ipo/${path}/` : `${SITE}/${path}/`;

    let html: string;
    try {
      html = await politeFetchText(url, { headers: REFERER });
    } catch (err) {
      console.warn(`[chittorgarh] detail ${idOrSlugged} failed:`, (err as Error).message);
      return null;
    }

    const flight = extractFlightData(html);
    if (!flight) return null;

    // Scope every read to this IPO's own record — see findRecordObject for why.
    const rec = findRecordObject(flight, slug);
    if (!rec) return null;

    const companyName = fieldOf(rec, "company_name");
    if (!companyName) return null;

    // Allotment date: Chittorgarh publishes the actual basis-of-allotment date, which
    // is our highest-confidence tier. If it is missing we return undefined and let the
    // sync layer apply its documented fallback — we never guess here.
    const allotmentDate = parseHumanDate(fieldOf(rec, "timetable_boa_dt"));
    const anchorShares = parsePositiveNum(fieldOf(rec, "shares_offered_anchor_investor"));

    return {
      sourceId: idOrSlugged,
      slug,
      companyName,
      board,
      symbol: fieldOf(rec, "il_nse_script_symbol"),
      isin: fieldOf(rec, "il_isin"),
      allotmentDate,
      allotmentDateSource: allotmentDate ? "BASIS_OF_ALLOTMENT" : undefined,
      issueOpenDate: parseHumanDate(fieldOf(rec, "timetable_issue_open_date")),
      issueCloseDate: parseHumanDate(fieldOf(rec, "timetable_issue_close_date")),
      listingDate:
        parseHumanDate(fieldOf(rec, "timetable_listing_dt")) ??
        parseHumanDate(fieldOf(rec, "il_ipo_listing_date")),
      ipoPriceFinal: parsePositiveNum(fieldOf(rec, "issue_price_final")),
      ipoPriceMin: parsePositiveNum(fieldOf(rec, "issue_price_lower")),
      ipoPriceMax: parsePositiveNum(fieldOf(rec, "cap_price")),
      issueSizeCr: parsePositiveNum(fieldOf(rec, "issue_total_amt")),
      anchorValueCr: parsePositiveNum(fieldOf(rec, "anchor_portion_size")),
      anchorQtyShares: anchorShares !== undefined ? BigInt(Math.round(anchorShares)) : undefined,
      registrar: fieldOf(rec, "registrar_name"),
      source: this.name,
    };
  }
}

function defaultYears(): number[] {
  const y = new Date().getUTCFullYear();
  return [y, y - 1];
}

/**
 * Fill gaps in `a` from `b` without overwriting anything `a` already knows.
 * The two Chittorgarh reports describe the same IPO with different columns, so a
 * last-write-wins merge would discard whichever report was fetched first.
 */
export function mergeRecords(a: RawIpoRecord, b: RawIpoRecord): RawIpoRecord {
  const out = { ...a } as unknown as Record<string, unknown>;
  const from = b as unknown as Record<string, unknown>;
  for (const key of Object.keys(from)) {
    const incoming = from[key];
    if (incoming === undefined || incoming === null || incoming === "") continue;
    const current = out[key];
    if (current === undefined || current === null || current === "") out[key] = incoming;
  }
  return out as unknown as RawIpoRecord;
}
