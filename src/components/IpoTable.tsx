"use client";

import { Fragment, useMemo, useState } from "react";
import type { EventRow, IpoRow } from "@/lib/queries";
import { eventTypeMeta, type LockinEventType } from "@/lib/lockin-rules";
import { HORIZON_WINDOWS, urgencyBucket, urgencyClasses } from "@/lib/urgency";
import { DASH, fmtCr, fmtDate, fmtDays, fmtMoney, fmtShares } from "@/lib/format";
import { downloadFile, toCsv, toIcs } from "@/lib/export";

type SortKey = "next" | "company" | "listing" | "allotment";
const EVENT_TYPES: LockinEventType[] = ["ANCHOR_T1", "ANCHOR_T2", "PRE_IPO", "PROMOTER"];

export function IpoTable({ rows, title }: { rows: IpoRow[]; title: string }) {
  const [search, setSearch] = useState("");
  const [horizon, setHorizon] = useState<number | null>(null);
  const [eventFilter, setEventFilter] = useState<LockinEventType | null>(null);
  const [hideExpired, setHideExpired] = useState(true);
  const [sort, setSort] = useState<SortKey>("next");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    let out = rows.filter((r) => {
      if (q && !`${r.companyName} ${r.symbol ?? ""}`.toLowerCase().includes(q)) return false;
      if (hideExpired && !r.nextEvent) return false;

      // Event-type and horizon filters look at the events themselves, so a row shows
      // only when it has an event actually satisfying the filter.
      const candidates = r.events.filter((e) => {
        if (eventFilter && e.eventType !== eventFilter) return false;
        if (horizon !== null && (e.daysRemaining < 0 || e.daysRemaining > horizon)) return false;
        if (from && e.tradingExpiry < from) return false;
        if (to && e.tradingExpiry > to) return false;
        return true;
      });
      return candidates.length > 0;
    });

    out = [...out].sort((a, b) => {
      switch (sort) {
        case "company":
          return a.companyName.localeCompare(b.companyName);
        case "listing":
          return (b.listingDate ?? "").localeCompare(a.listingDate ?? "");
        case "allotment":
          return (b.allotmentDate ?? "").localeCompare(a.allotmentDate ?? "");
        default: {
          if (a.nextEvent && b.nextEvent) return a.nextEvent.daysRemaining - b.nextEvent.daysRemaining;
          if (a.nextEvent) return -1;
          if (b.nextEvent) return 1;
          return a.companyName.localeCompare(b.companyName);
        }
      }
    });

    return out;
  }, [rows, search, horizon, eventFilter, hideExpired, sort, from, to]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <section aria-label={`${title} IPO lock-in table`}>
      {/* ---- filter bar ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or symbol…"
          aria-label="Search"
          className="w-56 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-fg-dim focus:border-accent"
        />

        <div className="flex items-center rounded-md border border-border-strong bg-surface p-0.5">
          {HORIZON_WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setHorizon(horizon === w ? null : w)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                horizon === w ? "bg-accent text-black" : "text-fg-muted hover:text-fg"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>

        <select
          value={eventFilter ?? ""}
          onChange={(e) => setEventFilter((e.target.value || null) as LockinEventType | null)}
          aria-label="Event type"
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {eventTypeMeta[t].short}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-xs text-fg-muted">
          from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-fg-muted">
          to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border-strong bg-surface px-1.5 py-1 text-xs outline-none focus:border-accent"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={hideExpired}
            onChange={(e) => setHideExpired(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Hide fully expired
        </label>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
        >
          <option value="next">Sort: soonest unlock</option>
          <option value="company">Sort: company</option>
          <option value="listing">Sort: listing date</option>
          <option value="allotment">Sort: allotment date</option>
        </select>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-fg-dim tnum">
            {filtered.length} of {rows.length}
          </span>
          <button
            onClick={() => downloadFile(`ipo-lockin-${slug}-${stamp}.csv`, toCsv(filtered), "text/csv")}
            className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2"
          >
            CSV
          </button>
          <button
            onClick={() =>
              downloadFile(`ipo-lockin-${slug}-${stamp}.ics`, toIcs(filtered), "text/calendar")
            }
            className="rounded-md border border-border-strong px-2 py-1 text-xs hover:bg-surface-2"
          >
            .ics
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          No IPOs match these filters.
        </p>
      ) : (
        <>
          {/* ---- desktop table ---- */}
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full min-w-[1500px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface text-left text-[11px] uppercase tracking-wide text-fg-dim">
                  <Th className="w-8" />
                  <Th>Company</Th>
                  <Th>Symbol</Th>
                  <Th>Listing</Th>
                  <Th>Allotment</Th>
                  <Th className="text-right">IPO price</Th>
                  <Th className="text-right">Listing px</Th>
                  <Th className="text-right">CMP</Th>
                  <Th>Anchor 30d</Th>
                  <Th>Anchor 90d</Th>
                  <Th>Pre-IPO</Th>
                  <Th className="text-right">Days left</Th>
                  <Th>Next event</Th>
                  <Th className="text-right">Anchor qty</Th>
                  <Th className="text-right">Anchor ₹cr</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const expired = !r.nextEvent;
                  const bucket = urgencyBucket(r.nextEvent?.daysRemaining ?? -1);
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggle(r.id)}
                        className={`cursor-pointer border-b border-border transition-colors hover:bg-surface ${
                          expired ? "opacity-45" : ""
                        }`}
                      >
                        <Td className="text-fg-dim">{open.has(r.id) ? "▾" : "▸"}</Td>
                        <Td className="max-w-[280px] truncate font-medium" title={r.companyName}>
                          {r.companyName}
                        </Td>
                        <Td className="font-mono text-xs">{r.symbol ?? DASH}</Td>
                        <Td className="tnum">{fmtDate(r.listingDate)}</Td>
                        <Td className="tnum">
                          <span className="inline-flex items-center gap-1">
                            {fmtDate(r.allotmentDate)}
                            {r.allotmentDateSource === "ESTIMATED" && (
                              <span
                                title="Estimated from listing date minus 2 business days — not an official basis-of-allotment date"
                                className="cursor-help text-amber-400"
                                aria-label="Estimated allotment date"
                              >
                                ⚠
                              </span>
                            )}
                          </span>
                        </Td>
                        <Td className="text-right tnum">{fmtMoney(r.ipoPriceFinal)}</Td>
                        <Td className="text-right tnum">{fmtMoney(r.listingPrice)}</Td>
                        <Td className="text-right tnum text-fg-dim">{fmtMoney(r.cmp)}</Td>
                        <ExpiryCell event={r.events.find((e) => e.eventType === "ANCHOR_T1")} />
                        <ExpiryCell event={r.events.find((e) => e.eventType === "ANCHOR_T2")} />
                        <ExpiryCell event={r.events.find((e) => e.eventType === "PRE_IPO")} />
                        <Td className={`text-right font-medium tnum ${urgencyClasses[bucket].text}`}>
                          {r.nextEvent ? fmtDays(r.nextEvent.daysRemaining) : "expired"}
                        </Td>
                        <Td>
                          {r.nextEvent ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] ${urgencyClasses[bucket].bg} ${urgencyClasses[bucket].text}`}
                            >
                              {eventTypeMeta[r.nextEvent.eventType].short}
                            </span>
                          ) : (
                            <span className="text-fg-dim">{DASH}</span>
                          )}
                        </Td>
                        <Td className="text-right tnum">{fmtShares(r.anchorQtyShares)}</Td>
                        <Td className="text-right tnum">
                          {r.anchorValueCr === null ? DASH : r.anchorValueCr.toFixed(2)}
                        </Td>
                        <Td className="max-w-[160px] truncate text-fg-muted">{r.notes ?? DASH}</Td>
                      </tr>
                      {open.has(r.id) && (
                        <tr className="border-b border-border bg-surface/60">
                          <td colSpan={16} className="px-4 py-3">
                            <RowDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- mobile cards ---- */}
          <div className="space-y-2 md:hidden">
            {filtered.map((r) => {
              const bucket = urgencyBucket(r.nextEvent?.daysRemaining ?? -1);
              return (
                <div key={r.id} className="rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.companyName}</div>
                      <div className="font-mono text-xs text-fg-dim">
                        {r.symbol ?? DASH} · {r.board}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${urgencyClasses[bucket].bg} ${urgencyClasses[bucket].text}`}
                    >
                      {r.nextEvent
                        ? `${eventTypeMeta[r.nextEvent.eventType].short} · ${fmtDays(r.nextEvent.daysRemaining)}`
                        : "expired"}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <Field label="Allotment" value={fmtDate(r.allotmentDate)} />
                    <Field label="Listing" value={fmtDate(r.listingDate)} />
                    <Field label="IPO price" value={fmtMoney(r.ipoPriceFinal)} />
                    <Field label="Anchor" value={fmtCr(r.anchorValueCr)} />
                  </dl>
                  <div className="mt-2 border-t border-border pt-2">
                    <MiniTimeline events={r.events} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] text-fg-dim">
        Colour: red ≤7d · amber 8–30d · blue 31–90d · grey &gt;90d. Dates shown are the
        trading-day expiry; ⚠ marks an estimated allotment date. Promoter lock-in uses a
        low-confidence default — verify against the current SEBI ICDR.
      </p>
    </section>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-2.5 py-2 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = "",
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td title={title} className={`whitespace-nowrap px-2.5 py-1.5 ${className}`}>
      {children}
    </td>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-dim">{label}</dt>
      <dd className="tnum">{value}</dd>
    </div>
  );
}

function ExpiryCell({ event }: { event?: EventRow }) {
  if (!event) return <Td className="text-fg-dim">{DASH}</Td>;
  const bucket = urgencyBucket(event.daysRemaining);
  return (
    <Td className={`tnum ${urgencyClasses[bucket].text}`}>
      <span className="inline-flex items-center gap-1">
        {fmtDate(event.tradingExpiry)}
        {event.isHolidayShifted && (
          <span
            title={`Raw expiry ${event.rawExpiry} fell on a non-trading day; rolled forward`}
            className="cursor-help text-fg-dim"
          >
            ↷
          </span>
        )}
      </span>
    </Td>
  );
}

/** Expanded row: full event timeline plus the IPO metadata. */
function RowDetail({ row }: { row: IpoRow }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-[11px] uppercase tracking-wide text-fg-dim">Lock-in timeline</h3>
        <table className="w-full text-xs">
          <tbody>
            {row.events.map((e) => {
              const bucket = urgencyBucket(e.daysRemaining);
              const meta = eventTypeMeta[e.eventType];
              return (
                <tr key={e.eventType} className="border-b border-border/60 last:border-0">
                  <td className="py-1 pr-3">
                    <span className={`inline-block h-2 w-2 rounded-full ${urgencyClasses[bucket].dot}`} />
                  </td>
                  <td className="py-1 pr-3">
                    {meta.label}
                    {meta.lowConfidence && (
                      <span className="ml-1 text-amber-400" title="Verify against current SEBI ICDR">
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3 tnum">{fmtDate(e.tradingExpiry)}</td>
                  <td className="py-1 pr-3 tnum text-fg-dim">
                    {e.isHolidayShifted ? `raw ${fmtDate(e.rawExpiry)}` : ""}
                  </td>
                  <td className={`py-1 text-right tnum ${urgencyClasses[bucket].text}`}>
                    {fmtDays(e.daysRemaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] uppercase tracking-wide text-fg-dim">IPO details</h3>
          <a
            href={`/edit/${row.id}`}
            className="rounded-md border border-border-strong px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            Edit
          </a>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <Field label="Board" value={row.board} />
          <Field label="ISIN" value={row.isin ?? DASH} />
          <Field label="Issue open" value={fmtDate(row.issueOpenDate)} />
          <Field label="Issue close" value={fmtDate(row.issueCloseDate)} />
          <Field label="Issue size" value={fmtCr(row.issueSizeCr)} />
          <Field
            label="Price band"
            value={
              row.ipoPriceMin !== null && row.ipoPriceMax !== null
                ? `${fmtMoney(row.ipoPriceMin)}–${fmtMoney(row.ipoPriceMax)}`
                : DASH
            }
          />
          <Field label="Registrar" value={row.registrar ?? DASH} />
          <Field label="Lead managers" value={row.leadManagers.length ? row.leadManagers.join(", ") : DASH} />
          <Field label="Sub. QIB" value={row.subQib === null ? DASH : `${row.subQib}×`} />
          <Field label="Sub. NII" value={row.subNii === null ? DASH : `${row.subNii}×`} />
          <Field label="Sub. retail" value={row.subRetail === null ? DASH : `${row.subRetail}×`} />
          <Field label="Sub. overall" value={row.subOverall === null ? DASH : `${row.subOverall}×`} />
          <Field label="Allotment source" value={row.allotmentDateSource ?? DASH} />
          <Field label="Data source" value={row.source} />
        </dl>
      </div>
    </div>
  );
}

function MiniTimeline({ events }: { events: EventRow[] }) {
  return (
    <ul className="space-y-0.5 text-[11px]">
      {events.map((e) => {
        const bucket = urgencyBucket(e.daysRemaining);
        return (
          <li key={e.eventType} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className={`h-1.5 w-1.5 rounded-full ${urgencyClasses[bucket].dot}`} />
              {eventTypeMeta[e.eventType].short}
            </span>
            <span className={`tnum ${urgencyClasses[bucket].text}`}>
              {fmtDate(e.tradingExpiry)} · {fmtDays(e.daysRemaining)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
