/**
 * One-off snapshot: pulls real IPO data from Chittorgarh and writes it to
 * prisma/seed-data.json.
 *
 * Why a committed snapshot rather than seeding from a live fetch:
 *   - `npm run seed` then works offline and produces identical results every time
 *   - the seed is still REAL source data, so nothing is fabricated
 *   - it exercises the adapter end to end before the app depends on it
 *
 * Re-run with `npm run snapshot` to refresh. Requests are rate limited by
 * politeFetch, so this takes a couple of minutes.
 *
 * Usage: npm run snapshot [-- --per-board 15]
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ChittorgarhAdapter } from "../src/lib/sources/chittorgarh";
import type { Board } from "../src/lib/lockin-rules";
import type { RawIpoDetail } from "../src/lib/sources/types";

const argOf = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const PER_BOARD = argOf("--per-board", 15);

async function main() {
  const adapter = new ChittorgarhAdapter();
  const out: RawIpoDetail[] = [];
  const problems: string[] = [];

  for (const board of ["MAINBOARD", "SME"] as const) {
    console.log(`\n=== ${board} ===`);
    const years = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1];

    // Gather list rows across years, newest listing first.
    const listed: Awaited<ReturnType<typeof adapter.fetchList>> = [];
    for (const year of years) {
      try {
        listed.push(...(await adapter.fetchList(board as Board, year)));
      } catch (err) {
        problems.push(`list ${board} ${year}: ${(err as Error).message}`);
      }
    }

    // Only IPOs that have actually listed can have a settled allotment date.
    const candidates = listed
      .filter((r) => r.listingDate)
      .sort((a, b) => (b.listingDate! < a.listingDate! ? -1 : 1))
      .slice(0, PER_BOARD);

    console.log(`  ${listed.length} listed rows -> fetching detail for ${candidates.length}`);

    for (const row of candidates) {
      const detail = await adapter.fetchIPODetail(row.sourceId, board as Board, row.slug);
      if (!detail) {
        problems.push(`detail ${board} ${row.companyName}: no data`);
        console.log(`  ✗ ${row.companyName}`);
        continue;
      }
      // Merge: list data fills gaps the detail page leaves blank.
      const merged: RawIpoDetail = {
        ...detail,
        symbol: detail.symbol ?? row.symbol,
        isin: detail.isin ?? row.isin,
        listingDate: detail.listingDate ?? row.listingDate,
        issueOpenDate: detail.issueOpenDate ?? row.issueOpenDate,
        issueCloseDate: detail.issueCloseDate ?? row.issueCloseDate,
        ipoPriceFinal: detail.ipoPriceFinal ?? row.ipoPriceFinal,
        issueSizeCr: detail.issueSizeCr ?? row.issueSizeCr,
      };
      out.push(merged);
      console.log(
        `  ✓ ${merged.symbol ?? "—"} ${merged.companyName.slice(0, 38).padEnd(38)} allot=${merged.allotmentDate ?? "—"} anchor=${merged.anchorValueCr ?? "—"}cr`,
      );
    }
  }

  const withAllotment = out.filter((r) => r.allotmentDate).length;
  const target = resolve(process.cwd(), "prisma/seed-data.json");

  writeFileSync(
    target,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "chittorgarh",
        note:
          "Real data snapshotted from Chittorgarh. Unknown values are omitted rather than " +
          "filled with placeholders. Regenerate with `npm run snapshot`.",
        records: out,
      },
      // BigInt needs an explicit serialiser.
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ),
  );

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Wrote ${out.length} records -> prisma/seed-data.json`);
  console.log(`With allotment date: ${withAllotment}/${out.length}`);
  if (problems.length) {
    console.log(`\nProblems (${problems.length}):`);
    for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
  }
}

main().catch((err) => {
  console.error("Snapshot failed:", err);
  process.exit(1);
});
