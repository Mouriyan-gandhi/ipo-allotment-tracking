// CSV and .ics generation for the current view. Hand-rolled so no field is invented:
// anything unknown is exported as an empty cell rather than a placeholder.

import type { IpoRow } from "./queries";
import { eventTypeMeta } from "./lockin-rules";

const CSV_COLUMNS = [
  "Company",
  "Symbol",
  "Board",
  "Listing date",
  "Allotment date",
  "Allotment source",
  "IPO price",
  "Listing price",
  "CMP",
  "Anchor 30d",
  "Anchor 90d",
  "Pre-IPO unlock",
  "Promoter unlock",
  "Days to next unlock",
  "Next event",
  "Anchor qty (shares)",
  "Anchor value (Rs cr)",
  "Source",
  "Notes",
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const expiryOf = (row: IpoRow, type: string): string =>
  row.events.find((e) => e.eventType === type)?.tradingExpiry ?? "";

export function toCsv(rows: IpoRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.companyName,
        r.symbol,
        r.board,
        r.listingDate,
        r.allotmentDate,
        r.allotmentDateSource,
        r.ipoPriceFinal,
        r.listingPrice,
        r.cmp,
        expiryOf(r, "ANCHOR_T1"),
        expiryOf(r, "ANCHOR_T2"),
        expiryOf(r, "PRE_IPO"),
        expiryOf(r, "PROMOTER"),
        r.nextEvent?.daysRemaining,
        r.nextEvent ? eventTypeMeta[r.nextEvent.eventType].short : "",
        r.anchorQtyShares,
        r.anchorValueCr,
        r.source,
        r.notes,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

/** Fold long lines per RFC 5545 (75 octets); simple char-based fold is sufficient here. */
function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) parts.push(` ${line.slice(i, i + 72)}`);
  return parts.join("\r\n");
}

const escapeIcs = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/**
 * One all-day VEVENT per lock-in event, on the trading-day expiry.
 * DTEND is exclusive per the spec, so it is the day after DTSTART.
 */
export function toIcs(rows: IpoRow[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IPO Lock-in Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:IPO Lock-in Expiries",
  ];

  for (const r of rows) {
    for (const e of r.events) {
      const start = e.tradingExpiry.replace(/-/g, "");
      const endDate = new Date(`${e.tradingExpiry}T00:00:00.000Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const end = endDate.toISOString().slice(0, 10).replace(/-/g, "");

      const meta = eventTypeMeta[e.eventType];
      const title = `${r.symbol ?? r.companyName} — ${meta.short} unlock`;

      const description = [
        `${r.companyName} (${r.board})`,
        `Event: ${meta.label}`,
        r.allotmentDate ? `Allotment: ${r.allotmentDate}` : null,
        e.isHolidayShifted ? `Raw expiry ${e.rawExpiry}, rolled to next trading day` : null,
        e.valueCr !== null ? `Anchor value: Rs ${e.valueCr} cr` : null,
        meta.lowConfidence ? "Low-confidence default — verify against current SEBI ICDR" : null,
      ]
        .filter(Boolean)
        .join("\n");

      out.push(
        "BEGIN:VEVENT",
        foldLine(`UID:${r.id}-${e.eventType}@ipo-lockin-tracker`),
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${start}`,
        `DTEND;VALUE=DATE:${end}`,
        foldLine(`SUMMARY:${escapeIcs(title)}`),
        foldLine(`DESCRIPTION:${escapeIcs(description)}`),
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    }
  }

  out.push("END:VCALENDAR");
  return out.join("\r\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
