import { describe, expect, it } from "vitest";
import { resolveAllotmentDate, validateRow } from "./sync";
import type { RawIpoDetail } from "./sources/types";

const base: RawIpoDetail = {
  sourceId: "1",
  companyName: "Test Co Ltd",
  board: "MAINBOARD",
  source: "chittorgarh",
};

const noHolidays = new Set<string>();
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("resolveAllotmentDate — verified data only by default", () => {
  it("uses the source-published basis-of-allotment date", () => {
    const r = resolveAllotmentDate(
      { ...base, allotmentDate: "2026-07-13", allotmentDateSource: "BASIS_OF_ALLOTMENT" },
      noHolidays,
    )!;
    expect(iso(r.date)).toBe("2026-07-13");
    expect(r.source).toBe("BASIS_OF_ALLOTMENT");
  });

  it("preserves an anchor-circular attribution", () => {
    const r = resolveAllotmentDate(
      { ...base, allotmentDate: "2026-07-13", allotmentDateSource: "ANCHOR_CIRCULAR" },
      noHolidays,
    )!;
    expect(r.source).toBe("ANCHOR_CIRCULAR");
  });

  it("returns null rather than inferring a date when none is published", () => {
    // The listing date is present and tier 3 *could* produce a value — it must not,
    // because an inferred allotment date silently corrupts all four lock-in dates.
    const r = resolveAllotmentDate({ ...base, listingDate: "2026-07-15" }, noHolidays);
    expect(r).toBeNull();
  });

  it("still returns null when there is nothing at all to work from", () => {
    expect(resolveAllotmentDate(base, noHolidays)).toBeNull();
  });

  it("uses listing minus two TRADING days only when explicitly opted in", () => {
    // Wed 2026-07-15 -> back two trading days = Mon 2026-07-13.
    const r = resolveAllotmentDate({ ...base, listingDate: "2026-07-15" }, noHolidays, true)!;
    expect(iso(r.date)).toBe("2026-07-13");
    expect(r.source).toBe("ESTIMATED");
  });

  it("skips weekends when estimating", () => {
    // Mon 2026-07-13 -> back two trading days skips Sun/Sat = Thu 2026-07-09.
    const r = resolveAllotmentDate({ ...base, listingDate: "2026-07-13" }, noHolidays, true)!;
    expect(iso(r.date)).toBe("2026-07-09");
  });

  it("skips holidays when estimating", () => {
    // 2026-08-14 is a Friday; with Thu 13th a holiday, two trading days back = Tue 11th.
    const r = resolveAllotmentDate(
      { ...base, listingDate: "2026-08-14" },
      new Set(["2026-08-13"]),
      true,
    )!;
    expect(iso(r.date)).toBe("2026-08-11");
  });
});

describe("validateRow — catches parse errors as inconsistent date sequences", () => {
  it("accepts a coherent sequence", () => {
    expect(
      validateRow(
        { ...base, issueOpenDate: "2026-07-08", issueCloseDate: "2026-07-10", listingDate: "2026-07-15" },
        "2026-07-13",
      ),
    ).toEqual([]);
  });

  it("flags an allotment date before the issue closes", () => {
    const p = validateRow({ ...base, issueCloseDate: "2026-07-10" }, "2026-07-08");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/precedes issue close/);
  });

  it("flags an allotment date after listing", () => {
    const p = validateRow({ ...base, listingDate: "2026-07-15" }, "2026-07-16");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/after listing/);
  });

  it("flags an issue that opens after it closes", () => {
    const p = validateRow(
      { ...base, issueOpenDate: "2026-07-12", issueCloseDate: "2026-07-10" },
      null,
    );
    expect(p.some((x) => /opens after it closes/.test(x))).toBe(true);
  });

  it("reports nothing when there is no allotment date to check", () => {
    expect(validateRow({ ...base, listingDate: "2026-07-15" }, null)).toEqual([]);
  });
});
