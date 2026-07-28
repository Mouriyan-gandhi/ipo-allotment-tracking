// ============================================================================
//  Lock-in event materialisation.
//
//  LockinEvent rows are a cache of what the date engine computes. They must be
//  recomputed whenever anything they depend on changes: the parent IPO's allotment
//  date, its board, its per-IPO rule override, the global rule settings, or the
//  trading-holiday calendar.
//
//  Everything funnels through recomputeLockinEvents() so there is exactly one
//  writer for that table.
// ============================================================================

import type { PrismaClient } from "@/generated/prisma/client";
import { civilToDate, computeLockinEvents, instantToCivil } from "./date-engine";
import type { Board, BoardLockinRules } from "./lockin-rules";

export const SETTINGS_KEYS = {
  lockinRules: "lockinRules",
  alertsEnabled: "alertsEnabled",
  lastSyncAt: "lastSyncAt",
} as const;

/** Load NSE holidays as a Set of yyyy-MM-dd keys for the date engine. */
export async function loadHolidaySet(prisma: PrismaClient, exchange = "NSE"): Promise<Set<string>> {
  const rows = await prisma.tradingHoliday.findMany({
    where: { exchange },
    select: { date: true },
  });
  // @db.Date values come back anchored at UTC midnight, which is exactly the civil
  // representation the engine expects.
  return new Set(rows.map((r) => instantToCivil(r.date)).map((c) => keyOf(c)));
}

function keyOf(c: { year: number; month: number; day: number }): string {
  return `${c.year}-${String(c.month).padStart(2, "0")}-${String(c.day).padStart(2, "0")}`;
}

/** Per-board rule overrides stored in Settings under the `lockinRules` key. */
export async function loadSettingsRules(
  prisma: PrismaClient,
): Promise<Partial<Record<Board, Partial<BoardLockinRules>>>> {
  const row = await prisma.settings.findUnique({ where: { key: SETTINGS_KEYS.lockinRules } });
  return (row?.value as Partial<Record<Board, Partial<BoardLockinRules>>>) ?? {};
}

export interface RecomputeContext {
  holidays: Set<string>;
  settingsRules: Partial<Record<Board, Partial<BoardLockinRules>>>;
}

/** Build the context once and reuse it across many IPOs — avoids refetching per row. */
export async function buildRecomputeContext(prisma: PrismaClient): Promise<RecomputeContext> {
  const [holidays, settingsRules] = await Promise.all([
    loadHolidaySet(prisma),
    loadSettingsRules(prisma),
  ]);
  return { holidays, settingsRules };
}

/**
 * Recompute and persist the lock-in events for one IPO.
 *
 * Returns the number of events written. An IPO with no allotment date has no
 * computable events, so any stale rows are removed and 0 is returned — we never
 * invent an allotment date to fill the gap.
 */
export async function recomputeLockinEvents(
  prisma: PrismaClient,
  ipoId: string,
  ctx: RecomputeContext,
): Promise<number> {
  const ipo = await prisma.ipo.findUnique({
    where: { id: ipoId },
    select: {
      id: true,
      board: true,
      allotmentDate: true,
      lockinRuleOverride: true,
      anchorQtyShares: true,
      anchorValueCr: true,
    },
  });
  if (!ipo) return 0;

  if (!ipo.allotmentDate) {
    await prisma.lockinEvent.deleteMany({ where: { ipoId } });
    return 0;
  }

  const board = ipo.board as Board;
  const events = computeLockinEvents({
    allotmentDate: ipo.allotmentDate,
    board,
    holidays: ctx.holidays,
    settingsOverride: ctx.settingsRules[board],
    ipoOverride: (ipo.lockinRuleOverride as Partial<BoardLockinRules> | null) ?? undefined,
  });

  for (const e of events) {
    // Anchor tranches release 50% of the anchor allocation each; other event types
    // have no disclosed quantity, so they stay null rather than being guessed.
    const isAnchor = e.eventType === "ANCHOR_T1" || e.eventType === "ANCHOR_T2";
    const qtyShares =
      isAnchor && ipo.anchorQtyShares !== null ? ipo.anchorQtyShares / BigInt(2) : null;
    const valueCr =
      isAnchor && ipo.anchorValueCr !== null ? Number(ipo.anchorValueCr) / 2 : null;

    await prisma.lockinEvent.upsert({
      where: { ipoId_eventType: { ipoId, eventType: e.eventType } },
      create: {
        ipoId,
        eventType: e.eventType,
        rawExpiryDate: e.rawExpiryDate,
        tradingDayExpiryDate: e.tradingDayExpiryDate,
        isHolidayShifted: e.isHolidayShifted,
        qtyShares,
        valueCr,
      },
      update: {
        rawExpiryDate: e.rawExpiryDate,
        tradingDayExpiryDate: e.tradingDayExpiryDate,
        isHolidayShifted: e.isHolidayShifted,
        qtyShares,
        valueCr,
      },
    });
  }

  return events.length;
}

/** Recompute every IPO — used after a rules or holiday-calendar change. */
export async function recomputeAll(prisma: PrismaClient): Promise<number> {
  const ctx = await buildRecomputeContext(prisma);
  const ipos = await prisma.ipo.findMany({ select: { id: true } });
  let total = 0;
  for (const { id } of ipos) total += await recomputeLockinEvents(prisma, id, ctx);
  return total;
}

/** Convert an ISO yyyy-MM-dd civil date string into the stored Date form. */
export function isoToDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return civilToDate({ year, month, day });
}
