"use client";

import { useMemo, useState } from "react";
import type { IpoRow } from "@/lib/queries";
import { eventTypeMeta, type LockinEventType } from "@/lib/lockin-rules";
import { urgencyBucket, urgencyClasses } from "@/lib/urgency";
import { fmtCr, fmtDate } from "@/lib/format";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Text tones come from theme tokens so chips stay legible on white as well as dark.
const EVENT_COLOURS: Record<LockinEventType, string> = {
  ANCHOR_T1: "bg-ev-t1/15 text-ev-t1-fg border-ev-t1/30",
  ANCHOR_T2: "bg-ev-t2/15 text-ev-t2-fg border-ev-t2/30",
  PRE_IPO: "bg-ev-pre/15 text-ev-pre-fg border-ev-pre/30",
  PROMOTER: "bg-ev-prom/15 text-ev-prom-fg border-ev-prom/30",
};

interface Chip {
  ipo: IpoRow;
  eventType: LockinEventType;
  daysRemaining: number;
  isHolidayShifted: boolean;
  valueCr: number | null;
}

type BoardFilter = "ALL" | "MAINBOARD" | "SME";
const BOARD_FILTERS: { key: BoardFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "MAINBOARD", label: "Mainboard" },
  { key: "SME", label: "SME" },
];

export function CalendarView({ rows }: { rows: IpoRow[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [selected, setSelected] = useState<IpoRow | null>(null);
  const [board, setBoard] = useState<BoardFilter>("ALL");
  const [types, setTypes] = useState<Set<LockinEventType>>(new Set());

  const visible = useMemo(
    () => (board === "ALL" ? rows : rows.filter((r) => r.board === board)),
    [rows, board],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, Chip[]>();
    for (const ipo of visible) {
      for (const e of ipo.events) {
        // An empty type filter means "show everything" rather than "show nothing".
        if (types.size > 0 && !types.has(e.eventType)) continue;
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
  }, [visible, types]);

  const monthCount = useMemo(() => {
    const prefix = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
    let n = 0;
    for (const [iso, chips] of byDate) if (iso.startsWith(prefix)) n += chips.length;
    return n;
  }, [byDate, cursor]);

  const toggleType = (t: LockinEventType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

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

        {/* Board filter */}
        <div className="flex items-center rounded-md border border-border-strong bg-surface p-0.5">
          {BOARD_FILTERS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBoard(b.key)}
              aria-pressed={board === b.key}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                board === b.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>

        <span className="text-[11px] text-fg-dim tnum">
          {monthCount} event{monthCount === 1 ? "" : "s"} this month
        </span>

        {/* Event-type legend doubles as a filter. */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
          {(Object.keys(EVENT_COLOURS) as LockinEventType[]).map((t) => {
            const on = types.size === 0 || types.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                aria-pressed={types.has(t)}
                title="Click to filter by this event type"
                className={`rounded border px-1.5 py-0.5 transition-opacity ${EVENT_COLOURS[t]} ${
                  on ? "" : "opacity-30"
                }`}
              >
                {eventTypeMeta[t].short}
              </button>
            );
          })}
          {types.size > 0 && (
            <button
              onClick={() => setTypes(new Set())}
              className="rounded border border-border-strong px-1.5 py-0.5 text-fg-dim hover:text-fg"
            >
              clear
            </button>
          )}
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
                          title={`${c.ipo.companyName} (${c.ipo.board}) — ${eventTypeMeta[c.eventType].label}${
                            c.isHolidayShifted ? " (rolled to next trading day)" : ""
                          }`}
                          className={`flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[10px] transition-opacity hover:opacity-80 ${EVENT_COLOURS[c.eventType]}`}
                        >
                          {/* Board marker matters most in the combined "All" view. */}
                          {board === "ALL" && (
                            <span className="shrink-0 opacity-60">
                              {c.ipo.board === "SME" ? "S" : "M"}
                            </span>
                          )}
                          <span className="truncate">{c.ipo.symbol ?? c.ipo.companyName}</span>
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
