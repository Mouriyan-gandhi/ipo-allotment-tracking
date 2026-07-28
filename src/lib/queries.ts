// ============================================================================
//  Read models for the UI.
//
//  Prisma returns Decimal and BigInt values that cannot cross the server/client
//  boundary, so everything is normalised to plain JSON-safe types here. Unknown
//  values stay null and are rendered as "—" — never as a placeholder number.
// ============================================================================

import { prisma } from "./db";
import { daysRemaining } from "./date-engine";
import type { Board, LockinEventType } from "./lockin-rules";

export interface EventRow {
  eventType: LockinEventType;
  rawExpiry: string; // yyyy-MM-dd
  tradingExpiry: string; // yyyy-MM-dd
  isHolidayShifted: boolean;
  qtyShares: string | null;
  valueCr: number | null;
  daysRemaining: number;
}

export interface IpoRow {
  id: string;
  symbol: string | null;
  companyName: string;
  board: Board;
  isin: string | null;
  allotmentDate: string | null;
  allotmentDateSource: "BASIS_OF_ALLOTMENT" | "ANCHOR_CIRCULAR" | "ESTIMATED" | null;
  listingDate: string | null;
  issueOpenDate: string | null;
  issueCloseDate: string | null;
  ipoPriceFinal: number | null;
  ipoPriceMin: number | null;
  ipoPriceMax: number | null;
  listingPrice: number | null;
  cmp: number | null;
  issueSizeCr: number | null;
  anchorQtyShares: string | null;
  anchorValueCr: number | null;
  leadManagers: string[];
  registrar: string | null;
  subQib: number | null;
  subNii: number | null;
  subRetail: number | null;
  subOverall: number | null;
  notes: string | null;
  source: string;
  lastSyncedAt: string | null;
  events: EventRow[];
  /** Soonest event that has not yet passed; null once every event has expired. */
  nextEvent: EventRow | null;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getIpos(board?: Board): Promise<IpoRow[]> {
  const ipos = await prisma.ipo.findMany({
    where: board ? { board } : undefined,
    include: { lockinEvents: true },
  });

  const rows: IpoRow[] = ipos.map((ipo) => {
    const events: EventRow[] = ipo.lockinEvents
      .map((e) => ({
        eventType: e.eventType as LockinEventType,
        rawExpiry: isoDay(e.rawExpiryDate),
        tradingExpiry: isoDay(e.tradingDayExpiryDate),
        isHolidayShifted: e.isHolidayShifted,
        qtyShares: e.qtyShares === null ? null : e.qtyShares.toString(),
        valueCr: num(e.valueCr),
        daysRemaining: daysRemaining(e.tradingDayExpiryDate),
      }))
      .sort((a, b) => (a.tradingExpiry < b.tradingExpiry ? -1 : 1));

    return {
      id: ipo.id,
      symbol: ipo.symbol,
      companyName: ipo.companyName,
      board: ipo.board as Board,
      isin: ipo.isin,
      allotmentDate: ipo.allotmentDate ? isoDay(ipo.allotmentDate) : null,
      allotmentDateSource: ipo.allotmentDateSource,
      listingDate: ipo.listingDate ? isoDay(ipo.listingDate) : null,
      issueOpenDate: ipo.issueOpenDate ? isoDay(ipo.issueOpenDate) : null,
      issueCloseDate: ipo.issueCloseDate ? isoDay(ipo.issueCloseDate) : null,
      ipoPriceFinal: num(ipo.ipoPriceFinal),
      ipoPriceMin: num(ipo.ipoPriceMin),
      ipoPriceMax: num(ipo.ipoPriceMax),
      listingPrice: num(ipo.listingPrice),
      cmp: num(ipo.cmp),
      issueSizeCr: num(ipo.issueSizeCr),
      anchorQtyShares: ipo.anchorQtyShares === null ? null : ipo.anchorQtyShares.toString(),
      anchorValueCr: num(ipo.anchorValueCr),
      leadManagers: ipo.leadManagers,
      registrar: ipo.registrar,
      subQib: num(ipo.subQib),
      subNii: num(ipo.subNii),
      subRetail: num(ipo.subRetail),
      subOverall: num(ipo.subOverall),
      notes: ipo.notes,
      source: ipo.source,
      lastSyncedAt: ipo.lastSyncedAt?.toISOString() ?? null,
      events,
      nextEvent: events.find((e) => e.daysRemaining >= 0) ?? null,
    };
  });

  // Default sort: soonest upcoming unlock first; fully-expired IPOs sink to the bottom.
  return rows.sort((a, b) => {
    if (a.nextEvent && b.nextEvent) return a.nextEvent.daysRemaining - b.nextEvent.daysRemaining;
    if (a.nextEvent) return -1;
    if (b.nextEvent) return 1;
    return a.companyName.localeCompare(b.companyName);
  });
}

export interface SyncStatusInfo {
  lastSuccessAt: string | null;
  hoursSinceSuccess: number | null;
  /** True when the last successful sync is older than 48h (or never happened). */
  isStale: boolean;
}

export async function getSyncStatus(): Promise<SyncStatusInfo> {
  const last = await prisma.syncRun.findFirst({
    where: { status: { in: ["SUCCESS", "PARTIAL"] } },
    orderBy: { startedAt: "desc" },
    select: { finishedAt: true, startedAt: true },
  });
  const at = last?.finishedAt ?? last?.startedAt ?? null;
  if (!at) return { lastSuccessAt: null, hoursSinceSuccess: null, isStale: true };

  const hours = (Date.now() - at.getTime()) / 36e5;
  return { lastSuccessAt: at.toISOString(), hoursSinceSuccess: hours, isStale: hours > 48 };
}

export async function getUnreadNotificationCount(): Promise<number> {
  return prisma.notification.count({ where: { readAt: null, sentAt: { not: null } } });
}
