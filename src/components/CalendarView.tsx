"use client";

import { useMemo, useState } from "react";
import type { IpoRow } from "@/lib/queries";
import { eventTypeMeta, type LockinEventType } from "@/lib/lockin-rules";
import { urgencyBucket, urgencyClasses } from "@/lib/urgency";
import { fmtCr, fmtDate } from "@/lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EVENT_COLOURS: Record<LockinEventType, string> = {
  ANCHOR_T1: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  ANCHOR_T2: "bg-violet-500/20 text-violet-300 border-violet-500/30",
  PRE_IPO: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  PROMOTER: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

interface Chip {
  ipo: IpoRow;
  eventType: LockinEventType;
  daysRemaining: number;
  isHolidayShifted: boolean;
  valueCr: number | null;
}

export function CalendarView({ rows }: { rows: IpoRow[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selected, setSelected] = useState<IpoRow | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, Chip[]>();
    for (const ipo of rows) {
      for (const e of ipo.events) {
        const list = map.get(e.tradingExpiry) ?? [];
        list.push({
          ipo,
          eventType: e.eventType,
          daysRemaining: e.daysRemaining,
          isHolidayShifted: e.isHolidayShifted,
          valueCr: e.valueCr,
        });
        map.set(e.tradingExpiry, list);
      }
    }
    return map;
  }, [rows]);

  // Build a Monday-first grid covering the whole month.
  const cells = useMemo(() => {
    const first = new Date(Date.UTC(cursor.year, cursor.month - 1, 1));
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();
    const leading = (first.getUTCDay() + 6) % 7; // Mon = 0

    const out: ({ iso: string; day: number } | null)[] = Array(leading).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({
        iso: `${cursor.year}-${String(cursor.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        day: d,
      });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursor]);

  const shift = (delta: number) => {
    const total = cursor.year * 12 + (cursor.month - 1) + delta;
    setCursor({ year: Math.floor(total / 12), month: (total % 12) + 1 });
  };

  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month - 1, 1)).toLocaleDateString(
    "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => shift(-1)}
          className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2"
        >
          ← Prev
        </button>
        <h2 className="min-w-[180px] text-center text-sm font-semibold">{monthLabel}</h2>
        <button
          onClick={() => shift(1)}
          className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2"
        >
          Next →
        </button>
        <button
          onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() + 1 })}
          className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2"
        >
          Today
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
          {(Object.keys(EVENT_COLOURS) as LockinEventType[]).map((t) => (
            <span key={t} className={`rounded border px-1.5 py-0.5 ${EVENT_COLOURS[t]}`}>
              {eventTypeMeta[t].short}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="grid min-w-[720px] grid-cols-7 border-b border-border bg-surface text-[11px] uppercase tracking-wide text-fg-dim">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>

        <div className="grid min-w-[720px] grid-cols-7">
          {cells.map((cell, i) => {
            const chips = cell ? (byDate.get(cell.iso) ?? []) : [];
            const isToday = cell?.iso === todayIso;
            return (
              <div
                key={i}
                className={`min-h-[104px] border-b border-r border-border p-1.5 ${
                  cell ? "" : "bg-surface/40"
                } ${isToday ? "bg-accent/5 ring-1 ring-inset ring-accent/40" : ""}`}
              >
                {cell && (
                  <>
                    <div
                      className={`mb-1 text-[11px] tnum ${isToday ? "font-semibold text-accent" : "text-fg-dim"}`}
                    >
                      {cell.day}
                    </div>
                    <div className="space-y-0.5">
                      {chips.slice(0, 4).map((c, j) => (
                        <button
                          key={j}
                          onClick={() => setSelected(c.ipo)}
                          title={`${c.ipo.companyName} — ${eventTypeMeta[c.eventType].label}${
                            c.isHolidayShifted ? " (rolled to next trading day)" : ""
                          }`}
                          className={`block w-full truncate rounded border px-1 py-0.5 text-left text-[10px] transition-opacity hover:opacity-80 ${EVENT_COLOURS[c.eventType]}`}
                        >
                          {c.ipo.symbol ?? c.ipo.companyName}
                        </button>
                      ))}
                      {chips.length > 4 && (
                        <div className="px-1 text-[10px] text-fg-dim">+{chips.length - 4} more</div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && <DetailPanel ipo={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function DetailPanel({ ipo, onClose }: { ipo: IpoRow; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{ipo.companyName}</h3>
            <p className="font-mono text-xs text-fg-dim">
              {ipo.symbol ?? "—"} · {ipo.board}
            </p>
          </div>
          <button onClick={onClose} className="text-fg-dim hover:text-fg" aria-label="Close">
            ✕
          </button>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Row label="Allotment" value={fmtDate(ipo.allotmentDate)} />
          <Row label="Listing" value={fmtDate(ipo.listingDate)} />
          <Row label="Issue size" value={fmtCr(ipo.issueSizeCr)} />
          <Row label="Anchor value" value={fmtCr(ipo.anchorValueCr)} />
        </dl>

        <h4 className="mt-4 text-[11px] uppercase tracking-wide text-fg-dim">Lock-in events</h4>
        <ul className="mt-1 space-y-1 text-xs">
          {ipo.events.map((e) => {
            const bucket = urgencyBucket(e.daysRemaining);
            return (
              <li key={e.eventType} className="flex items-center justify-between gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${EVENT_COLOURS[e.eventType]}`}>
                  {eventTypeMeta[e.eventType].short}
                </span>
                <span className={`tnum ${urgencyClasses[bucket].text}`}>
                  {fmtDate(e.tradingExpiry)}
                  {e.isHolidayShifted && (
                    <span className="ml-1 text-fg-dim" title={`raw ${e.rawExpiry}`}>
                      ↷
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-dim">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}
