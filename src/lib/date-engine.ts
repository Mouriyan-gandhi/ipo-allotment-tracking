// ============================================================================
//  DATE ENGINE — the correctness-critical core.
//
//  Rules (per the spec):
//   - All computation happens on Asia/Kolkata CIVIL dates (India has no DST; the
//     offset is a constant +05:30, but we still derive the civil date via the IANA
//     zone so it stays correct if that ever changes).
//   - Day durations (e.g. anchor 30/90): add calendar days.
//   - Month durations (e.g. 6/12/18): add calendar months keeping the day-of-month,
//     CLAMPED to month-end when the target month is shorter (31 Aug + 6m -> 28/29 Feb).
//   - After the raw expiry is computed, roll forward off weekends + NSE holidays to
//     the next trading day, storing rawExpiryDate and tradingDayExpiryDate separately.
//
//  IMPORTANT: this file must never contain the lock-in duration literals
//  30, 90, 6, 12 or 18 — every duration comes from resolveLockinRules().
//
//  Representation: a "civil date" is stored/returned as a Date anchored to UTC
//  midnight of that Y-M-D. Interpreting the UTC calendar fields of such a Date
//  always yields the intended IST civil date, independent of the server timezone.
// ============================================================================

import { formatInTimeZone } from "date-fns-tz";
import {
  type Board,
  type BoardLockinRules,
  type DurationRule,
  type LockinEventType,
  resolveLockinRules,
} from "./lockin-rules";

export const IST_TZ = "Asia/Kolkata";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Max consecutive non-trading days we'll ever roll across (long weekend + holidays).
const MAX_ROLL_FORWARD_DAYS = 14;

/** A calendar date in the Asia/Kolkata civil calendar. `month` is 1-12. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

// --- civil <-> Date conversions ---------------------------------------------

function daysInMonth(year: number, monthIndex0: number): number {
  // Day 0 of the following month = last day of the target month.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Anchor a civil date to a concrete Date at UTC midnight (the canonical storage form). */
export function civilToDate(cd: CivilDate): Date {
  return new Date(Date.UTC(cd.year, cd.month - 1, cd.day, 0, 0, 0, 0));
}

/** Read the civil date back out of a UTC-midnight-anchored Date. */
export function dateToCivil(d: Date): CivilDate {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Convert an arbitrary instant into the Asia/Kolkata civil date it falls on. */
export function instantToCivil(instant: Date): CivilDate {
  const iso = formatInTimeZone(instant, IST_TZ, "yyyy-MM-dd");
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function civilKey(cd: CivilDate): string {
  return `${cd.year}-${String(cd.month).padStart(2, "0")}-${String(cd.day).padStart(2, "0")}`;
}

// --- arithmetic --------------------------------------------------------------

export function addDays(cd: CivilDate, n: number): CivilDate {
  return dateToCivil(new Date(civilToDate(cd).getTime() + n * MS_PER_DAY));
}

/** Add calendar months keeping day-of-month, clamped to the target month's last day. */
export function addMonths(cd: CivilDate, n: number): CivilDate {
  const totalMonthIndex = cd.month - 1 + n;
  const year = cd.year + Math.floor(totalMonthIndex / 12);
  const monthIndex0 = ((totalMonthIndex % 12) + 12) % 12;
  const day = Math.min(cd.day, daysInMonth(year, monthIndex0));
  return { year, month: monthIndex0 + 1, day };
}

export function applyDuration(cd: CivilDate, rule: DurationRule): CivilDate {
  return rule.unit === "days" ? addDays(cd, rule.value) : addMonths(cd, rule.value);
}

export function daysBetween(from: CivilDate, to: CivilDate): number {
  return Math.round((civilToDate(to).getTime() - civilToDate(from).getTime()) / MS_PER_DAY);
}

// --- trading-day roll-forward ------------------------------------------------

export function isWeekend(cd: CivilDate): boolean {
  const dow = civilToDate(cd).getUTCDay(); // 0 = Sunday ... 6 = Saturday
  return dow === 0 || dow === 6;
}

/** `holidays` is a Set of civilKey() strings (yyyy-MM-dd) of NSE trading holidays. */
export function isTradingDay(cd: CivilDate, holidays: Set<string>): boolean {
  return !isWeekend(cd) && !holidays.has(civilKey(cd));
}

/** Roll forward to the next trading day. `shifted` is true if any move happened. */
export function rollForwardToTradingDay(
  cd: CivilDate,
  holidays: Set<string>,
): { date: CivilDate; shifted: boolean } {
  let current = cd;
  let shifted = false;
  for (let i = 0; i < MAX_ROLL_FORWARD_DAYS; i++) {
    if (isTradingDay(current, holidays)) return { date: current, shifted };
    current = addDays(current, 1);
    shifted = true;
  }
  // Extremely unlikely: give up and return whatever we reached rather than loop forever.
  return { date: current, shifted };
}

// --- event computation -------------------------------------------------------

export interface ComputedLockinEvent {
  eventType: LockinEventType;
  rawExpiryDate: Date; // UTC-midnight-anchored civil date
  tradingDayExpiryDate: Date; // UTC-midnight-anchored civil date
  isHolidayShifted: boolean;
}

// Deterministic ordering (chronological under default rules).
export const EVENT_ORDER: LockinEventType[] = ["ANCHOR_T1", "ANCHOR_T2", "PRE_IPO", "PROMOTER"];

export interface ComputeLockinParams {
  allotmentDate: Date;
  board: Board;
  holidays: Set<string>;
  settingsOverride?: Partial<BoardLockinRules>;
  ipoOverride?: Partial<BoardLockinRules>;
  /** Promoter lock-in is a low-confidence default; callers may exclude it. Default: include. */
  includePromoter?: boolean;
}

export function computeLockinEvents(params: ComputeLockinParams): ComputedLockinEvent[] {
  const {
    allotmentDate,
    board,
    holidays,
    settingsOverride,
    ipoOverride,
    includePromoter = true,
  } = params;

  const rules = resolveLockinRules(board, settingsOverride, ipoOverride);
  const allotCivil = instantToCivil(allotmentDate);
  const types = includePromoter
    ? EVENT_ORDER
    : EVENT_ORDER.filter((t) => t !== "PROMOTER");

  return types.map((eventType) => {
    const rawCivil = applyDuration(allotCivil, rules[eventType]);
    const { date: tradingCivil, shifted } = rollForwardToTradingDay(rawCivil, holidays);
    return {
      eventType,
      rawExpiryDate: civilToDate(rawCivil),
      tradingDayExpiryDate: civilToDate(tradingCivil),
      isHolidayShifted: shifted,
    };
  });
}

// --- helpers for the UI ------------------------------------------------------

/** Today's civil date in IST. */
export function todayIST(now: Date = new Date()): CivilDate {
  return instantToCivil(now);
}

/**
 * Whole days from today (IST) until a stored expiry Date. Negative = already passed,
 * 0 = today (morning-of).
 */
export function daysRemaining(expiry: Date, now: Date = new Date()): number {
  return daysBetween(todayIST(now), dateToCivil(expiry));
}
