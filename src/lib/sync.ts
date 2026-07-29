// ============================================================================
//  Ingestion / sync engine.
//
//  Responsibilities, in order:
//    1. run source adapters in priority order, tolerating failures
//    2. resolve the allotment date through the documented fallback chain
//    3. upsert on (source, sourceRef), never overwriting a manually-edited field
//    4. detect and log what actually changed (the "cross-check" step)
//    5. sanity-validate each row and record anything implausible
//    6. recompute lock-in events for rows whose inputs moved
//
//  A failure of every source is an expected outcome, not an exception: it produces a
//  FAILED SyncRun row and leaves stored data untouched so the UI still renders.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import { ChittorgarhAdapter } from "./sources/chittorgarh";
import type { IpoSourceAdapter, RawIpoDetail } from "./sources/types";
import { addDays, dateToCivil, instantToCivil, isTradingDay } from "./date-engine";
import {
  buildRecomputeContext,
  isoToDate,
  recomputeLockinEvents,
  type RecomputeContext,
} from "./lockin-service";
import type { Board } from "./lockin-rules";

export interface SyncResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  rowsAdded: number;
  rowsUpdated: number;
  changes: FieldChange[];
  warnings: string[];
  errors: string[];
}

export interface FieldChange {
  ipo: string;
  field: string;
  from: string | null;
  to: string | null;
}

/** Fields sync is allowed to write. Anything absent here is user-owned. */
const SYNCABLE_FIELDS = [
  "symbol",
  "companyName",
  "isin",
  "allotmentDate",
  "listingDate",
  "issueOpenDate",
  "issueCloseDate",
  "ipoPriceFinal",
  "ipoPriceMin",
  "ipoPriceMax",
  "issueSizeCr",
  "anchorValueCr",
  "anchorQtyShares",
  "registrar",
  "leadManagers",
] as const;

export function defaultAdapters(): IpoSourceAdapter[] {
  // Chittorgarh is currently the only source that publishes a basis-of-allotment
  // date. Additional adapters slot in here and are tried in priority order.
  return [new ChittorgarhAdapter()];
}

/**
 * Resolve the allotment date, never guessing silently.
 *   1. explicit basis-of-allotment  -> BASIS_OF_ALLOTMENT
 *   2. anchor circular date         -> ANCHOR_CIRCULAR
 *   3. listing date - 2 trading days-> ESTIMATED (flagged in the UI)
 */
export function resolveAllotmentDate(
  detail: RawIpoDetail,
  holidays: Set<string>,
  /**
   * Whether tier 3 (listing date - 2 trading days) may be used. Defaults to FALSE:
   * that tier is an inference, not published data, and every lock-in date derives
   * from it. With it off, an IPO whose allotment date the source has not published
   * is stored with allotmentDate = null and simply has no computed events, rather
   * than carrying dates built on a guess.
   */
  allowEstimated = false,
): { date: Date; source: "BASIS_OF_ALLOTMENT" | "ANCHOR_CIRCULAR" | "ESTIMATED" } | null {
  if (detail.allotmentDate) {
    return {
      date: isoToDate(detail.allotmentDate),
      source: detail.allotmentDateSource ?? "BASIS_OF_ALLOTMENT",
    };
  }
  if (!allowEstimated) return null;
  if (!detail.listingDate) return null;

  // Walk back two trading days from listing.
  let civil = dateToCivil(isoToDate(detail.listingDate));
  let stepped = 0;
  for (let guard = 0; guard < 20 && stepped < 2; guard++) {
    civil = addDays(civil, -1);
    if (isTradingDay(civil, holidays)) stepped++;
  }
  return { date: isoToDate(keyOf(civil)), source: "ESTIMATED" };
}

const keyOf = (c: { year: number; month: number; day: number }): string =>
  `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;

/** Flag rows whose dates are internally inconsistent — usually a parsing error. */
export function validateRow(detail: RawIpoDetail, allotmentIso: string | null): string[] {
  const problems: string[] = [];
  const label = detail.symbol ?? detail.companyName;

  if (allotmentIso && detail.issueCloseDate && allotmentIso < detail.issueCloseDate) {
    problems.push(`${label}: allotment ${allotmentIso} precedes issue close ${detail.issueCloseDate}`);
  }
  if (allotmentIso && detail.listingDate && allotmentIso > detail.listingDate) {
    problems.push(`${label}: allotment ${allotmentIso} is after listing ${detail.listingDate}`);
  }
  if (detail.issueOpenDate && detail.issueCloseDate && detail.issueOpenDate > detail.issueCloseDate) {
    problems.push(`${label}: issue opens after it closes`);
  }
  return problems;
}

const asIso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v);

export interface RunSyncOptions {
  triggeredBy: string;
  adapters?: IpoSourceAdapter[];
  /** Cap detail fetches per run so a scheduled job stays polite. */
  maxDetailFetches?: number;
  /**
   * Allow the ESTIMATED allotment-date tier (listing - 2 trading days).
   * Off by default: only dates the source actually publishes are stored.
   */
  allowEstimatedAllotment?: boolean;
}

export async function runSync(
  prisma: PrismaClient,
  opts: RunSyncOptions,
): Promise<SyncResult> {
  const adapters = opts.adapters ?? defaultAdapters();
  const maxDetail = opts.maxDetailFetches ?? 40;

  const run = await prisma.syncRun.create({
    data: {
      source: adapters.map((a) => a.name).join(","),
      status: "FAILED", // pessimistic until proven otherwise
      triggeredBy: opts.triggeredBy,
    },
  });

  const result: SyncResult = {
    status: "FAILED",
    rowsAdded: 0,
    rowsUpdated: 0,
    changes: [],
    warnings: [],
    errors: [],
  };

  const ctx: RecomputeContext = await buildRecomputeContext(prisma);
  let anySourceWorked = false;
  // An IPO can be touched by both passes; count it once so Sync History stays honest.
  const counted = new Set<string>();

  for (const adapter of adapters) {
    let listing;
    try {
      listing = await adapter.fetchUpcomingIPOs();
      anySourceWorked = true;
    } catch (err) {
      result.errors.push(`${adapter.name}: ${(err as Error).message}`);
      continue;
    }

    // Only fetch detail for rows that are new, or whose data can still change.
    // Detail pages are one request each, so this keeps a daily run to a handful.
    const existing = await prisma.ipo.findMany({
      where: { source: adapter.name },
      select: {
        sourceRef: true,
        allotmentDate: true,
        listingDate: true,
        issueOpenDate: true,
        issueCloseDate: true,
      },
    });
    const known = new Map(existing.map((e) => [e.sourceRef, e]));

    const todayIso = keyOf(instantToCivil(new Date()));

    // Pass 1 — persist everything the listing already gives us. The timetable report
    // supplies the basis-of-allotment date, so lock-in dates materialise here without
    // a single detail request. This is what makes a multi-year backfill tractable.
    for (const row of listing) {
      if (!row.allotmentDate) continue;

      // Skip rows the listing describes exactly as they are already stored. Without
      // this, every daily run re-upserts the entire history (500+ rows, each with its
      // lock-in events), which cannot finish inside a serverless timeout. New and
      // changed rows still flow through untouched.
      const prior = known.get(row.sourceId);
      if (
        prior &&
        asIso(prior.allotmentDate) === (row.allotmentDate ?? null) &&
        asIso(prior.listingDate) === (row.listingDate ?? null) &&
        asIso(prior.issueOpenDate) === (row.issueOpenDate ?? null) &&
        asIso(prior.issueCloseDate) === (row.issueCloseDate ?? null)
      ) {
        continue;
      }

      const resolved = resolveAllotmentDate(
        row as RawIpoDetail,
        ctx.holidays,
        opts.allowEstimatedAllotment ?? false,
      );
      result.warnings.push(...validateRow(row as RawIpoDetail, resolved ? asIso(resolved.date) : null));
      await upsertIpo(prisma, adapter.name, row as RawIpoDetail, resolved, ctx, result, todayIso, counted);
    }

    // Pass 2 — spend the detail budget on enrichment (symbol, price, anchor, ISIN)
    // and on rows still missing an allotment date, newest first.
    const needsDetail = listing.filter((row) => {
      const prior = known.get(row.sourceId);
      if (!prior) return true; // never seen
      if (!prior.allotmentDate && !row.allotmentDate) return true;
      // Recheck recently-listed IPOs; older ones are settled.
      const listed = prior.listingDate ? asIso(prior.listingDate)! : null;
      return !listed || listed >= keyOf(addDays(instantToCivil(new Date()), -30));
    });

    // Interleave the boards before applying the budget. Without this, the board
    // listed first consumes the whole allowance every run and the other board never
    // catches up (SME has ~100 IPOs a year against mainboard's ~40).
    const byBoard = new Map<Board, typeof needsDetail>();
    for (const row of needsDetail) {
      const list = byBoard.get(row.board) ?? [];
      list.push(row);
      byBoard.set(row.board, list);
    }
    const interleaved: typeof needsDetail = [];
    const queues = [...byBoard.values()];
    for (let i = 0; interleaved.length < needsDetail.length; i++) {
      for (const q of queues) if (i < q.length) interleaved.push(q[i]);
    }

    for (const row of interleaved.slice(0, maxDetail)) {
      let detail: RawIpoDetail | null = null;
      try {
        detail =
          adapter instanceof ChittorgarhAdapter
            ? await adapter.fetchIPODetail(row.sourceId, row.board, row.slug)
            : await adapter.fetchIPODetail(row.sourceId, row.board);
      } catch (err) {
        result.errors.push(`${adapter.name} detail ${row.companyName}: ${(err as Error).message}`);
        continue;
      }
      if (!detail) {
        result.warnings.push(`${adapter.name}: no detail for ${row.companyName}`);
        continue;
      }

      // List data fills gaps the detail page leaves blank.
      const merged: RawIpoDetail = {
        ...detail,
        symbol: detail.symbol ?? row.symbol,
        isin: detail.isin ?? row.isin,
        listingDate: detail.listingDate ?? row.listingDate,
        issueOpenDate: detail.issueOpenDate ?? row.issueOpenDate,
        issueCloseDate: detail.issueCloseDate ?? row.issueCloseDate,
        ipoPriceFinal: detail.ipoPriceFinal ?? row.ipoPriceFinal,
        issueSizeCr: detail.issueSizeCr ?? row.issueSizeCr,
      };

      const resolved = resolveAllotmentDate(
        merged,
        ctx.holidays,
        opts.allowEstimatedAllotment ?? false,
      );
      const allotIso = resolved ? asIso(resolved.date) : null;
      result.warnings.push(...validateRow(merged, allotIso));
      if (!resolved) {
        // Recorded, not hidden: the row is still stored so it appears in the UI,
        // but with no allotment date and therefore no computed lock-in dates.
        result.warnings.push(
          `${merged.symbol ?? merged.companyName}: source has not published a basis-of-allotment date — stored without lock-in dates`,
        );
      }

      await upsertIpo(prisma, adapter.name, merged, resolved, ctx, result, todayIso, counted);
    }
  }

  result.status = !anySourceWorked
    ? "FAILED"
    : result.errors.length > 0
      ? "PARTIAL"
      : "SUCCESS";

  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      status: result.status,
      rowsAdded: result.rowsAdded,
      rowsUpdated: result.rowsUpdated,
      // Stored as a plain JSON object so Prisma's InputJsonValue accepts it.
      errors:
        result.errors.length || result.warnings.length || result.changes.length
          ? {
              errors: result.errors,
              warnings: result.warnings,
              changes: result.changes.map((c) => ({
                ipo: c.ipo,
                field: c.field,
                from: c.from,
                to: c.to,
              })),
            }
          : undefined,
    },
  });

  return result;
}

async function upsertIpo(
  prisma: PrismaClient,
  sourceName: string,
  detail: RawIpoDetail,
  resolved: { date: Date; source: string } | null,
  ctx: RecomputeContext,
  result: SyncResult,
  todayIso: string,
  counted: Set<string>,
) {
  const existing = await prisma.ipo.findUnique({
    where: { source_sourceRef: { source: sourceName, sourceRef: detail.sourceId } },
  });

  const overrides = (existing?.manualOverrides as Record<string, boolean> | null) ?? {};

  const incoming: Record<string, unknown> = {
    symbol: detail.symbol ?? null,
    companyName: detail.companyName,
    isin: detail.isin ?? null,
    allotmentDate: resolved?.date ?? null,
    listingDate: detail.listingDate ? isoToDate(detail.listingDate) : null,
    issueOpenDate: detail.issueOpenDate ? isoToDate(detail.issueOpenDate) : null,
    issueCloseDate: detail.issueCloseDate ? isoToDate(detail.issueCloseDate) : null,
    ipoPriceFinal: detail.ipoPriceFinal ?? null,
    ipoPriceMin: detail.ipoPriceMin ?? null,
    ipoPriceMax: detail.ipoPriceMax ?? null,
    issueSizeCr: detail.issueSizeCr ?? null,
    anchorValueCr: detail.anchorValueCr ?? null,
    anchorQtyShares: detail.anchorQtyShares ?? null,
    registrar: detail.registrar ?? null,
    leadManagers: detail.leadManagers ?? [],
  };

  // Drop any field the user has taken ownership of, and never overwrite a known
  // value with a blank one — a source dropping a field is not evidence it changed.
  const data: Record<string, unknown> = {};
  for (const field of SYNCABLE_FIELDS) {
    if (overrides[field]) continue;
    const value = incoming[field];
    if (value === null && existing && existing[field as keyof typeof existing] !== null) continue;
    if (Array.isArray(value) && value.length === 0 && existing) continue;
    data[field] = value;
  }

  if (resolved && !overrides.allotmentDate) data.allotmentDateSource = resolved.source;
  data.lastSyncedAt = new Date();

  if (!existing) {
    await prisma.ipo.create({
      data: {
        ...data,
        companyName: detail.companyName,
        board: detail.board as Board,
        source: sourceName,
        sourceRef: detail.sourceId,
      } as never,
    });
    if (!counted.has(detail.sourceId)) {
      counted.add(detail.sourceId);
      result.rowsAdded++;
    }
    const created = await prisma.ipo.findUnique({
      where: { source_sourceRef: { source: sourceName, sourceRef: detail.sourceId } },
      select: { id: true },
    });
    if (created) await recomputeLockinEvents(prisma, created.id, ctx);
    return;
  }

  // Change detection: record what actually moved before writing.
  let allotmentMoved = false;
  for (const [field, value] of Object.entries(data)) {
    if (field === "lastSyncedAt") continue;
    const before = asIso(existing[field as keyof typeof existing]);
    const after = asIso(value);
    if (before !== after) {
      result.changes.push({ ipo: detail.symbol ?? detail.companyName, field, from: before, to: after });
      if (field === "allotmentDate") allotmentMoved = true;
    }
  }

  await prisma.ipo.update({ where: { id: existing.id }, data: data as never });
  if (!counted.has(detail.sourceId)) {
    counted.add(detail.sourceId);
    result.rowsUpdated++;
  }

  // Lock-in events depend on the allotment date, so recompute only when it moved.
  if (allotmentMoved) await recomputeLockinEvents(prisma, existing.id, ctx);
  void todayIso;
}
