import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilKey,
  civilToDate,
  computeLockinEvents,
  daysBetween,
  daysRemaining,
  instantToCivil,
  isTradingDay,
  isWeekend,
  rollForwardToTradingDay,
} from "./date-engine";
import { defaultLockinRules, resolveLockinRules } from "./lockin-rules";

const noHolidays = new Set<string>();

/** Helper: build a UTC-midnight-anchored civil Date the way the DB stores them. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("month-end clamping (the spec's headline case)", () => {
  it("31 Aug + 6 months -> 28 Feb in a non-leap year (NOT 3 Mar)", () => {
    // 2025-08-31 + 6 months; Feb 2026 has 28 days.
    expect(addMonths({ year: 2025, month: 8, day: 31 }, 6)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("31 Aug + 6 months -> 29 Feb in a leap year", () => {
    // 2023-08-31 + 6 months; Feb 2024 is a leap February.
    expect(addMonths({ year: 2023, month: 8, day: 31 }, 6)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it("31 Jan + 1 month clamps to 28/29 Feb", () => {
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonths({ year: 2024, month: 1, day: 31 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
  });

  it("31 Oct + 1 month clamps to 30 Nov (30-day month)", () => {
    expect(addMonths({ year: 2025, month: 10, day: 31 }, 1)).toEqual({
      year: 2025,
      month: 11,
      day: 30,
    });
  });

  it("does not clamp when the target month is long enough", () => {
    expect(addMonths({ year: 2025, month: 1, day: 15 }, 6)).toEqual({
      year: 2025,
      month: 7,
      day: 15,
    });
  });

  it("rolls the year over correctly for 12 and 18 month durations", () => {
    expect(addMonths({ year: 2025, month: 3, day: 10 }, 12)).toEqual({
      year: 2026,
      month: 3,
      day: 10,
    });
    expect(addMonths({ year: 2025, month: 3, day: 10 }, 18)).toEqual({
      year: 2026,
      month: 9,
      day: 10,
    });
  });
});

describe("leap-year handling", () => {
  it("29 Feb + 12 months clamps to 28 Feb the following (non-leap) year", () => {
    expect(addMonths({ year: 2024, month: 2, day: 29 }, 12)).toEqual({
      year: 2025,
      month: 2,
      day: 28,
    });
  });

  it("29 Feb + 48 months lands on 29 Feb again (next leap year)", () => {
    expect(addMonths({ year: 2024, month: 2, day: 29 }, 48)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it("addDays crosses 29 Feb in a leap year", () => {
    // 2024-02-28 + 1 day = 2024-02-29 (leap), + 2 days = 2024-03-01
    expect(addDays({ year: 2024, month: 2, day: 28 }, 1)).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(addDays({ year: 2024, month: 2, day: 28 }, 2)).toEqual({
      year: 2024,
      month: 3,
      day: 1,
    });
  });

  it("addDays skips 29 Feb in a non-leap year", () => {
    expect(addDays({ year: 2025, month: 2, day: 28 }, 1)).toEqual({
      year: 2025,
      month: 3,
      day: 1,
    });
  });
});

describe("day arithmetic (anchor tranches)", () => {
  it("adds 30 and 90 calendar days across month boundaries", () => {
    // 2025-12-26 + 30d = 2026-01-25 ; + 90d = 2026-03-26
    expect(addDays({ year: 2025, month: 12, day: 26 }, 30)).toEqual({
      year: 2026,
      month: 1,
      day: 25,
    });
    expect(addDays({ year: 2025, month: 12, day: 26 }, 90)).toEqual({
      year: 2026,
      month: 3,
      day: 26,
    });
  });

  it("daysBetween is the inverse of addDays", () => {
    const from = { year: 2025, month: 12, day: 26 };
    expect(daysBetween(from, addDays(from, 90))).toBe(90);
    expect(daysBetween(addDays(from, 5), from)).toBe(-5);
  });
});

describe("weekend + holiday roll-forward", () => {
  it("identifies weekends correctly", () => {
    expect(isWeekend({ year: 2026, month: 1, day: 24 })).toBe(true); // Saturday
    expect(isWeekend({ year: 2026, month: 1, day: 25 })).toBe(true); // Sunday
    expect(isWeekend({ year: 2026, month: 1, day: 26 })).toBe(false); // Monday
  });

  it("rolls a Saturday expiry forward to Monday and flags the shift", () => {
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 24 }, noHolidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 26 });
    expect(r.shifted).toBe(true);
  });

  it("rolls a Sunday expiry forward to Monday", () => {
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 25 }, noHolidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 26 });
    expect(r.shifted).toBe(true);
  });

  it("leaves a normal weekday untouched and does NOT flag a shift", () => {
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 27 }, noHolidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 27 });
    expect(r.shifted).toBe(false);
  });

  it("rolls forward past a weekday holiday", () => {
    // 2026-01-26 is a Monday (Republic Day) -> expect Tuesday 27th.
    const holidays = new Set(["2026-01-26"]);
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 26 }, holidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 27 });
    expect(r.shifted).toBe(true);
  });

  it("rolls across a holiday-adjacent long weekend (Fri holiday -> Monday)", () => {
    // Fri 2026-01-02 holiday, Sat 3rd, Sun 4th -> Mon 2026-01-05
    const holidays = new Set(["2026-01-02"]);
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 2 }, holidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 5 });
    expect(r.shifted).toBe(true);
  });

  it("rolls across consecutive holidays plus a weekend", () => {
    // Thu 1 Jan + Fri 2 Jan holidays, then weekend -> Mon 5 Jan
    const holidays = new Set(["2026-01-01", "2026-01-02"]);
    const r = rollForwardToTradingDay({ year: 2026, month: 1, day: 1 }, holidays);
    expect(r.date).toEqual({ year: 2026, month: 1, day: 5 });
    expect(r.shifted).toBe(true);
  });

  it("isTradingDay respects both weekends and holidays", () => {
    const holidays = new Set(["2026-01-26"]);
    expect(isTradingDay({ year: 2026, month: 1, day: 26 }, holidays)).toBe(false);
    expect(isTradingDay({ year: 2026, month: 1, day: 24 }, holidays)).toBe(false);
    expect(isTradingDay({ year: 2026, month: 1, day: 27 }, holidays)).toBe(true);
  });
});

describe("Asia/Kolkata civil-date handling", () => {
  it("an instant late on 31 Dec UTC is already 1 Jan in IST", () => {
    // 2025-12-31T19:00Z == 2026-01-01T00:30 IST
    expect(instantToCivil(new Date("2025-12-31T19:00:00.000Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  it("an instant early on 1 Jan UTC is still 1 Jan in IST", () => {
    expect(instantToCivil(new Date("2026-01-01T04:00:00.000Z"))).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  it("civilToDate/civilKey round-trip to UTC midnight", () => {
    const cd = { year: 2026, month: 2, day: 28 };
    expect(civilToDate(cd).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(civilKey(cd)).toBe("2026-02-28");
  });
});

describe("computeLockinEvents — end to end", () => {
  // Real values pulled from Chittorgarh for Gujarat Kidney & Super Speciality (SME):
  // basis of allotment = Friday, 26 Dec 2025.
  const allotment = d("2025-12-26");

  it("produces all four events for a MAINBOARD IPO with correct offsets", () => {
    const events = computeLockinEvents({
      allotmentDate: allotment,
      board: "MAINBOARD",
      holidays: noHolidays,
    });
    const by = Object.fromEntries(events.map((e) => [e.eventType, e]));

    expect(events).toHaveLength(4);
    // +30d -> 2026-01-25 (Sunday) -> rolls to Mon 26 Jan
    expect(by.ANCHOR_T1.rawExpiryDate.toISOString()).toBe("2026-01-25T00:00:00.000Z");
    expect(by.ANCHOR_T1.tradingDayExpiryDate.toISOString()).toBe("2026-01-26T00:00:00.000Z");
    expect(by.ANCHOR_T1.isHolidayShifted).toBe(true);
    // +90d -> 2026-03-26 (Thursday) -> unchanged
    expect(by.ANCHOR_T2.rawExpiryDate.toISOString()).toBe("2026-03-26T00:00:00.000Z");
    expect(by.ANCHOR_T2.isHolidayShifted).toBe(false);
    // Mainboard PRE_IPO = +6 months -> 2026-06-26
    expect(by.PRE_IPO.rawExpiryDate.toISOString()).toBe("2026-06-26T00:00:00.000Z");
  });

  it("SME uses a 12-month PRE_IPO while anchors stay identical", () => {
    const mb = computeLockinEvents({ allotmentDate: allotment, board: "MAINBOARD", holidays: noHolidays });
    const sme = computeLockinEvents({ allotmentDate: allotment, board: "SME", holidays: noHolidays });

    const mbPre = mb.find((e) => e.eventType === "PRE_IPO")!;
    const smePre = sme.find((e) => e.eventType === "PRE_IPO")!;
    // SME pre-IPO is a year out, mainboard six months.
    expect(smePre.rawExpiryDate.toISOString()).toBe("2026-12-26T00:00:00.000Z");
    expect(mbPre.rawExpiryDate.toISOString()).toBe("2026-06-26T00:00:00.000Z");

    // Anchor tranches must match across boards under current rules.
    for (const t of ["ANCHOR_T1", "ANCHOR_T2"] as const) {
      expect(sme.find((e) => e.eventType === t)!.rawExpiryDate.toISOString()).toBe(
        mb.find((e) => e.eventType === t)!.rawExpiryDate.toISOString(),
      );
    }
  });

  it("can exclude the low-confidence PROMOTER event", () => {
    const events = computeLockinEvents({
      allotmentDate: allotment,
      board: "SME",
      holidays: noHolidays,
      includePromoter: false,
    });
    expect(events.map((e) => e.eventType)).toEqual(["ANCHOR_T1", "ANCHOR_T2", "PRE_IPO"]);
  });

  it("honours a per-IPO rule override (rules are data, not code)", () => {
    const events = computeLockinEvents({
      allotmentDate: allotment,
      board: "MAINBOARD",
      holidays: noHolidays,
      ipoOverride: { PRE_IPO: { unit: "months", value: 3 } },
    });
    const pre = events.find((e) => e.eventType === "PRE_IPO")!;
    expect(pre.rawExpiryDate.toISOString()).toBe("2026-03-26T00:00:00.000Z");
  });

  it("applies month-end clamping through the full pipeline", () => {
    // Allotment 31 Aug 2025 + 6 months -> 28 Feb 2026 (Saturday) -> rolls to Mon 2 Mar.
    const events = computeLockinEvents({
      allotmentDate: d("2025-08-31"),
      board: "MAINBOARD",
      holidays: noHolidays,
    });
    const pre = events.find((e) => e.eventType === "PRE_IPO")!;
    expect(pre.rawExpiryDate.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(pre.tradingDayExpiryDate.toISOString()).toBe("2026-03-02T00:00:00.000Z");
    expect(pre.isHolidayShifted).toBe(true);
  });

  it("always preserves rawExpiryDate separately from tradingDayExpiryDate", () => {
    const events = computeLockinEvents({
      allotmentDate: allotment,
      board: "SME",
      holidays: new Set(["2026-01-26"]),
    });
    for (const e of events) {
      if (!e.isHolidayShifted) {
        expect(e.tradingDayExpiryDate.toISOString()).toBe(e.rawExpiryDate.toISOString());
      } else {
        expect(e.tradingDayExpiryDate.getTime()).toBeGreaterThan(e.rawExpiryDate.getTime());
      }
    }
  });
});

describe("daysRemaining", () => {
  const now = new Date("2026-01-20T10:00:00.000Z"); // 20 Jan 2026 IST

  it("counts forward, returns 0 on the morning of, and negative once passed", () => {
    expect(daysRemaining(d("2026-01-27"), now)).toBe(7);
    expect(daysRemaining(d("2026-01-20"), now)).toBe(0);
    expect(daysRemaining(d("2026-01-19"), now)).toBe(-1);
  });

  it("uses the IST civil date, not UTC, near midnight", () => {
    // 2026-01-20T19:00Z is already 21 Jan in IST, so a 22 Jan expiry is 1 day out.
    const lateUtc = new Date("2026-01-20T19:00:00.000Z");
    expect(daysRemaining(d("2026-01-22"), lateUtc)).toBe(1);
  });
});

describe("lockin-rules config integrity", () => {
  it("resolution order is default -> settings -> per-IPO", () => {
    const resolved = resolveLockinRules(
      "MAINBOARD",
      { PRE_IPO: { unit: "months", value: 9 } },
      { PRE_IPO: { unit: "months", value: 3 } },
    );
    expect(resolved.PRE_IPO).toEqual({ unit: "months", value: 3 });
    // Untouched keys fall through to the board default.
    expect(resolved.ANCHOR_T1).toEqual(defaultLockinRules.MAINBOARD.ANCHOR_T1);
  });

  it("settings override applies when there is no per-IPO override", () => {
    const resolved = resolveLockinRules("SME", { PROMOTER: { unit: "months", value: 36 } });
    expect(resolved.PROMOTER).toEqual({ unit: "months", value: 36 });
  });
});
