import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  enclosingObject,
  extractFlightData,
  fieldOf,
  findRecordObject,
  parseHumanDate,
  parseNum,
  mergeRecords,
  parsePositiveNum,
  readField,
  stripTags,
} from "./chittorgarh";

describe("parseHumanDate", () => {
  it("parses the weekday-prefixed format used by timetable_boa_dt", () => {
    expect(parseHumanDate("Friday, December 26, 2025")).toBe("2025-12-26");
  });

  it("parses the bare format used by il_ipo_listing_date", () => {
    expect(parseHumanDate("December 30, 2025")).toBe("2025-12-30");
  });

  it("zero-pads single-digit days and months", () => {
    expect(parseHumanDate("January 5, 2026")).toBe("2026-01-05");
  });

  it("returns undefined rather than guessing on junk or blanks", () => {
    for (const bad of ["", "   ", "TBA", "Not Announced", undefined, null, "26/12/2025"]) {
      expect(parseHumanDate(bad as string)).toBeUndefined();
    }
  });

  it("rejects an unknown month name", () => {
    expect(parseHumanDate("Smarch 3, 2026")).toBeUndefined();
  });
});

describe("parseNum", () => {
  it("strips the ₹ entity, commas and suffixes", () => {
    expect(parseNum("&#8377;114 per share")).toBe(114);
    expect(parseNum("8,773,120")).toBe(8773120);
    expect(parseNum("100.01")).toBe(100.01);
  });

  it("returns undefined for blanks so unknowns stay unknown", () => {
    for (const bad of ["", "  ", "-", null, undefined]) {
      expect(parseNum(bad)).toBeUndefined();
    }
  });
});

describe("decodeEntities / stripTags", () => {
  it("decodes the rupee sign and ampersands", () => {
    expect(decodeEntities("&#8377;108 to &#8377;114")).toBe("₹108 to ₹114");
    expect(decodeEntities("Gujarat Kidney &amp; Super Speciality")).toBe(
      "Gujarat Kidney & Super Speciality",
    );
  });

  it("strips anchor markup down to the company name", () => {
    const cell =
      '<a href="https://www.chittorgarh.com/ipo/ardee-industries-ipo/2860/" title="x">Ardee Industries Ltd.</a> ';
    expect(stripTags(cell)).toBe("Ardee Industries Ltd.");
  });
});

describe("extractFlightData + readField", () => {
  // Mirrors the real page shape: JSON escaped inside a JS string inside a push() call.
  const page = [
    "<html><body>",
    `<script>self.__next_f.push([1,"{\\"company_name\\":\\"Gujarat Kidney \\u0026 Super Speciality Limited\\","])</script>`,
    `<script>self.__next_f.push([1,"\\"timetable_boa_dt\\":\\"Friday, December 26, 2025\\",\\"anchor_portion_size\\":\\"100.01\\","])</script>`,
    `<script>self.__next_f.push([1,"\\"shares_offered_anchor_investor\\":8773120,\\"il_nse_script_symbol\\":\\"GKSL\\",\\"blank_field\\":\\"\\"}"])</script>`,
    "</body></html>",
  ].join("");

  const flight = extractFlightData(page);

  it("reconstructs the concatenated flight payload", () => {
    expect(flight).toContain('"timetable_boa_dt":"Friday, December 26, 2025"');
  });

  it("reads string, numeric and unicode-escaped values", () => {
    expect(readField(flight, "timetable_boa_dt")).toBe("Friday, December 26, 2025");
    expect(readField(flight, "anchor_portion_size")).toBe("100.01");
    expect(readField(flight, "shares_offered_anchor_investor")).toBe("8773120");
    expect(readField(flight, "il_nse_script_symbol")).toBe("GKSL");
    expect(readField(flight, "company_name")).toBe("Gujarat Kidney & Super Speciality Limited");
  });

  it("treats blank and missing fields as undefined", () => {
    expect(readField(flight, "blank_field")).toBeUndefined();
    expect(readField(flight, "does_not_exist")).toBeUndefined();
  });

  it("returns empty string for a page with no flight data", () => {
    expect(extractFlightData("<html><body>nothing</body></html>")).toBe("");
  });

  it("skips undecodable chunks instead of failing the whole parse", () => {
    const mixed = `<script>self.__next_f.push([1,"\\uZZZZbad"])</script>` + page;
    expect(extractFlightData(mixed)).toContain("timetable_boa_dt");
  });

  it("takes the last occurrence, since later chunks carry hydrated values", () => {
    const dup = extractFlightData(
      `<script>self.__next_f.push([1,"{\\"sym\\":\\"OLD\\"}"])</script>` +
        `<script>self.__next_f.push([1,"{\\"sym\\":\\"NEW\\"}"])</script>`,
    );
    expect(readField(dup, "sym")).toBe("NEW");
  });
});

describe("findRecordObject — peer-table contamination guard", () => {
  // Regression test for a real bug: every Chittorgarh IPO page embeds a
  // peer-comparison table containing OTHER companies' company_name values. Scanning
  // the whole payload produced rows like symbol "KUSUMGAR" beside company "SRF Ltd" —
  // a real IPO's symbol attached to a peer company's name.
  const main = JSON.stringify({
    urlrewrite_folder_name: "gujarat-kidney-and-super-speciality-ipo",
    company_name: "Gujarat Kidney & Super Speciality Ltd.",
    il_nse_script_symbol: "GKSL",
    timetable_boa_dt: "Friday, December 26, 2025",
    anchor_portion_size: "100.01",
    // Padded so the record clears the "field-rich" threshold that separates the main
    // record from small peer entries.
    ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`pad_${i}`, i])),
  });
  const peer = JSON.stringify({ company_name: "Yatharth Hospital & Trauma Care Ltd", peer_id: 7 });
  const flight = `{"page":[${main},{"peers":[${peer}]}]}`;

  it("returns the IPO's own record, not a peer-table entry", () => {
    const rec = findRecordObject(flight, "gujarat-kidney-and-super-speciality-ipo")!;
    expect(rec).not.toBeNull();
    expect(fieldOf(rec, "company_name")).toBe("Gujarat Kidney & Super Speciality Ltd.");
    expect(fieldOf(rec, "il_nse_script_symbol")).toBe("GKSL");
  });

  it("never returns a peer company name, even without a slug hint", () => {
    const rec = findRecordObject(flight)!;
    expect(fieldOf(rec, "company_name")).not.toBe("Yatharth Hospital & Trauma Care Ltd");
  });

  it("rejects the page when the slug identifies a different IPO", () => {
    // Guards against a redirect silently yielding another company's data.
    const rec = findRecordObject(
      `{"a":[${JSON.stringify({
        urlrewrite_folder_name: "some-other-ipo",
        company_name: "Other Co",
        ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, i])),
      })}]}`,
      "gujarat-kidney-and-super-speciality-ipo",
    );
    expect(rec).toBeNull();
  });

  it("returns null when there is no record at all", () => {
    expect(findRecordObject("{}", "x")).toBeNull();
  });

  it("fieldOf treats blank strings as absent", () => {
    expect(fieldOf({ a: "", b: "  ", c: "v", d: null }, "a")).toBeUndefined();
    expect(fieldOf({ a: "", b: "  ", c: "v", d: null }, "b")).toBeUndefined();
    expect(fieldOf({ a: "", b: "  ", c: "v", d: null }, "d")).toBeUndefined();
    expect(fieldOf({ a: "", b: "  ", c: "v", d: null }, "c")).toBe("v");
  });
});

describe("enclosingObject", () => {
  it("finds balanced braces around an index", () => {
    const t = 'xx{"a":1,"b":{"c":2}}yy';
    expect(enclosingObject(t, t.indexOf('"a"'))).toBe('{"a":1,"b":{"c":2}}');
  });

  it("ignores braces inside string values", () => {
    const t = '{"a":"}{","b":2}';
    expect(enclosingObject(t, t.indexOf('"b"'))).toBe(t);
  });

  it("ignores escaped quotes inside strings", () => {
    const t = '{"a":"say \\"hi\\" }","b":2}';
    expect(enclosingObject(t, t.indexOf('"b"'))).toBe(t);
  });

  it("returns null when braces never balance", () => {
    expect(enclosingObject('{"a":1', 3)).toBeNull();
  });
});

describe("parsePositiveNum — zero means 'not disclosed', never a real value", () => {
  it("rejects the zero placeholders the source emits", () => {
    // Real cases seen in production data: an upcoming IPO's issue size arrives as
    // "0.00", and undisclosed anchor allocations arrive as 0. Storing those as 0
    // turns "not disclosed" into "zero rupees"/"zero shares" in the UI.
    for (const zero of ["0", "0.00", "0.0", 0, "₹0", "&#8377;0.00"]) {
      expect(parsePositiveNum(zero)).toBeUndefined();
    }
  });

  it("rejects negatives, which are never meaningful here", () => {
    expect(parsePositiveNum("-5")).toBeUndefined();
  });

  it("still returns genuine positive values untouched", () => {
    expect(parsePositiveNum("100.01")).toBe(100.01);
    expect(parsePositiveNum("8,773,120")).toBe(8773120);
    expect(parsePositiveNum("&#8377;114 per share")).toBe(114);
    expect(parsePositiveNum("0.5")).toBe(0.5);
  });

  it("treats blanks as absent, like parseNum", () => {
    for (const blank of ["", "  ", "-", null, undefined]) {
      expect(parsePositiveNum(blank)).toBeUndefined();
    }
  });

  it("differs from parseNum only on non-positive input", () => {
    expect(parseNum("0")).toBe(0);
    expect(parsePositiveNum("0")).toBeUndefined();
  });
});

describe("mergeRecords — two reports describing the same IPO", () => {
  // Report 118 (timetable) supplies the allotment date; report 82 supplies symbol,
  // ISIN and price. A last-write-wins merge would discard whichever arrived first.
  const timetable = {
    sourceId: "2276",
    companyName: "Modern Diagnostic & Research Centre Ltd.",
    board: "SME" as const,
    allotmentDate: "2026-01-05",
    allotmentDateSource: "BASIS_OF_ALLOTMENT" as const,
    listingDate: "2026-01-07",
    source: "chittorgarh",
  };
  const list = {
    sourceId: "2276",
    companyName: "Modern Diagnostic & Research Centre Ltd.",
    board: "SME" as const,
    symbol: "MODERN",
    isin: "INE0XYZ01011",
    ipoPriceFinal: 74,
    source: "chittorgarh",
  };

  it("keeps fields from both sides", () => {
    const m = mergeRecords(timetable, list);
    expect(m.allotmentDate).toBe("2026-01-05");
    expect(m.symbol).toBe("MODERN");
    expect(m.isin).toBe("INE0XYZ01011");
    expect(m.ipoPriceFinal).toBe(74);
  });

  it("is order independent for complementary fields", () => {
    const a = mergeRecords(timetable, list);
    const b = mergeRecords(list, timetable);
    expect(a.allotmentDate).toBe(b.allotmentDate);
    expect(a.symbol).toBe(b.symbol);
  });

  it("never lets an absent value overwrite a known one", () => {
    const blank = { ...list, symbol: undefined, isin: "", ipoPriceFinal: undefined };
    const m = mergeRecords(list, blank as typeof list);
    expect(m.symbol).toBe("MODERN");
    expect(m.isin).toBe("INE0XYZ01011");
    expect(m.ipoPriceFinal).toBe(74);
  });

  it("keeps the first side's value when both are populated", () => {
    const m = mergeRecords(list, { ...list, symbol: "OTHER" });
    expect(m.symbol).toBe("MODERN");
  });
});
