"use client";

import { useMemo } from "react";
import type { IpoRow } from "@/lib/queries";
import { HORIZON_WINDOWS, urgencyBucket, urgencyClasses } from "@/lib/urgency";
import { eventTypeMeta } from "@/lib/lockin-rules";
import { fmtCr } from "@/lib/format";

const TIMELINE_DAYS = 90;

/** Counts for the next 7/30/90 days, anchor value unlocking this month, 90-day timeline. */
export function DashboardStrip({ rows }: { rows: IpoRow[] }) {
  const stats = useMemo(() => {
    const upcoming = rows.flatMap((r) =>
      r.events
        .filter((e) => e.daysRemaining >= 0)
        .map((e) => ({ ...e, companyName: r.companyName, symbol: r.symbol })),
    );

    const counts = Object.fromEntries(
      HORIZON_WINDOWS.map((w) => [w, upcoming.filter((e) => e.daysRemaining <= w).length]),
    ) as Record<(typeof HORIZON_WINDOWS)[number], number>;

    // "This month" = remainder of the current calendar month, in IST civil dates.
    const now = new Date();
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31`;
    const anchorValueThisMonth = upcoming
      .filter((e) => e.tradingExpiry <= monthEnd && e.valueCr !== null)
      .reduce((sum, e) => sum + (e.valueCr ?? 0), 0);

    const hasAnchorValue = upcoming.some((e) => e.tradingExpiry <= monthEnd && e.valueCr !== null);

    return { upcoming, counts, anchorValueThisMonth, hasAnchorValue };
  }, [rows]);

  return (
    <section className="mb-4 grid gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_2fr]">
      {HORIZON_WINDOWS.map((w) => {
        const bucket = urgencyBucket(w === 7 ? 1 : w === 30 ? 20 : 60);
        return (
          <div key={w} className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="text-[11px] uppercase tracking-wide text-fg-dim">
              Next {w} days
            </div>
            <div className={`mt-0.5 text-2xl font-semibold tnum ${urgencyClasses[bucket].text}`}>
              {stats.counts[w]}
            </div>
            <div className="text-[11px] text-fg-dim">unlock events</div>
          </div>
        );
      })}

      <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
        <div className="text-[11px] uppercase tracking-wide text-fg-dim">
          Anchor value this month
        </div>
        <div className="mt-0.5 text-2xl font-semibold tnum">
          {stats.hasAnchorValue ? fmtCr(stats.anchorValueThisMonth) : "—"}
        </div>
        <div className="text-[11px] text-fg-dim">
          {stats.hasAnchorValue ? "disclosed anchor portions only" : "no disclosed anchor value"}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface px-3 py-2.5 lg:col-span-5">
        <Timeline events={stats.upcoming} />
      </div>
    </section>
  );
}

function Timeline({
  events,
}: {
  events: { daysRemaining: number; eventType: string; companyName: string; tradingExpiry: string }[];
}) {
  const within = events.filter((e) => e.daysRemaining <= TIMELINE_DAYS);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-fg-dim">
          Next {TIMELINE_DAYS} days
        </span>
        <span className="text-[11px] text-fg-dim">{within.length} events</span>
      </div>

      <div className="relative mt-2 h-9 rounded-md bg-surface-2">
        {/* Week gridlines for visual scale. */}
        {Array.from({ length: TIMELINE_DAYS / 7 + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute top-0 h-full w-px bg-border"
            style={{ left: `${((i * 7) / TIMELINE_DAYS) * 100}%` }}
          />
        ))}

        {within.map((e, i) => {
          const bucket = urgencyBucket(e.daysRemaining);
          return (
            <div
              key={i}
              title={`${e.companyName} — ${eventTypeMeta[e.eventType as keyof typeof eventTypeMeta]?.short ?? e.eventType} on ${e.tradingExpiry}`}
              className={`absolute top-1.5 h-6 w-[3px] rounded-full ${urgencyClasses[bucket].dot}`}
              style={{
                left: `calc(${(e.daysRemaining / TIMELINE_DAYS) * 100}% - 1.5px)`,
              }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-fg-dim tnum">
        <span>today</span>
        <span>+30d</span>
        <span>+60d</span>
        <span>+90d</span>
      </div>
    </div>
  );
}
