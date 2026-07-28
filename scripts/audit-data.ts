/**
 * Data provenance audit.
 *
 * Verifies that nothing shown in the UI is invented. Checks, in order:
 *   1. every allotment date is one the source published (no ESTIMATED tier)
 *   2. every stored IPO is attributable to a named source
 *   3. every lock-in event descends from a verified allotment date
 *   4. date sequences are internally consistent (open <= close <= allotment <= listing)
 *   5. no placeholder values masquerading as data (0 prices, epoch dates, "N/A" text)
 *   6. reports which fields are derived rather than fetched, so they are not
 *      mistaken for source data
 *
 * Exits non-zero if any check fails.
 *
 * Usage: npm run audit
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log("DATA PROVENANCE AUDIT\n");

  const total = await prisma.ipo.count();
  const withAllot = await prisma.ipo.count({ where: { allotmentDate: { not: null } } });

  console.log(`Scope: ${total} IPOs, ${withAllot} with an allotment date\n`);

  // 1. No inferred allotment dates.
  console.log("1. Allotment date provenance");
  const estimated = await prisma.ipo.count({ where: { allotmentDateSource: "ESTIMATED" } });
  const basis = await prisma.ipo.count({ where: { allotmentDateSource: "BASIS_OF_ALLOTMENT" } });
  const circular = await prisma.ipo.count({ where: { allotmentDateSource: "ANCHOR_CIRCULAR" } });
  check("no ESTIMATED (inferred) allotment dates", estimated === 0, `found ${estimated}`);
  check(
    "every allotment date is source-published",
    basis + circular === withAllot,
    `BASIS_OF_ALLOTMENT ${basis}, ANCHOR_CIRCULAR ${circular}`,
  );

  // 2. Attribution.
  console.log("\n2. Source attribution");
  const bySource = await prisma.ipo.groupBy({ by: ["source"], _count: { _all: true } });
  for (const s of bySource) console.log(`     ${s.source}: ${s._count._all}`);
  const unattributed = await prisma.ipo.count({ where: { OR: [{ source: "" }] } });
  check("every IPO names its source", unattributed === 0);

  // 3. Events descend from verified dates.
  console.log("\n3. Lock-in event lineage");
  const events = await prisma.lockinEvent.count();
  const orphanEvents = await prisma.lockinEvent.count({ where: { ipo: { allotmentDate: null } } });
  check("no event without a verified allotment date", orphanEvents === 0, `${events} events total`);

  const missingEvents = await prisma.ipo.count({
    where: { allotmentDate: { not: null }, lockinEvents: { none: {} } },
  });
  check("every IPO with an allotment date has events", missingEvents === 0);

  // 4. Date sequence sanity.
  console.log("\n4. Date sequence consistency");
  const rows = await prisma.ipo.findMany({
    select: {
      symbol: true,
      companyName: true,
      issueOpenDate: true,
      issueCloseDate: true,
      allotmentDate: true,
      listingDate: true,
    },
  });
  const badSequence = rows.filter((r) => {
    const o = iso(r.issueOpenDate);
    const c = iso(r.issueCloseDate);
    const a = iso(r.allotmentDate);
    const l = iso(r.listingDate);
    if (o && c && o > c) return true;
    if (c && a && a < c) return true;
    if (a && l && a > l) return true;
    return false;
  });
  check("open <= close <= allotment <= listing", badSequence.length === 0, `${badSequence.length} anomalies`);
  for (const r of badSequence.slice(0, 5)) {
    console.log(
      `     ⚠ ${r.symbol ?? r.companyName}: open=${iso(r.issueOpenDate)} close=${iso(r.issueCloseDate)} allot=${iso(r.allotmentDate)} list=${iso(r.listingDate)}`,
    );
  }

  // 5. No placeholder values pretending to be data.
  console.log("\n5. Placeholder detection");
  // Zero is never a real value for any of these: the source emits 0 to mean
  // "not disclosed", and storing it asserts a fact ("zero shares unlock").
  const zeroPrice = await prisma.ipo.count({ where: { ipoPriceFinal: 0 } });
  const zeroIssue = await prisma.ipo.count({ where: { issueSizeCr: 0 } });
  const zeroAnchorVal = await prisma.ipo.count({ where: { anchorValueCr: 0 } });
  const zeroAnchorQty = await prisma.ipo.count({ where: { anchorQtyShares: BigInt(0) } });
  const zeroEventQty = await prisma.lockinEvent.count({ where: { qtyShares: BigInt(0) } });
  const zeroEventVal = await prisma.lockinEvent.count({ where: { valueCr: 0 } });
  const junkNames = await prisma.ipo.count({
    where: { OR: [{ companyName: "N/A" }, { companyName: "-" }, { companyName: "" }] },
  });
  const epoch = await prisma.ipo.count({ where: { allotmentDate: new Date("1970-01-01") } });
  check("no zero IPO prices posing as real", zeroPrice === 0, `found ${zeroPrice}`);
  check("no zero issue sizes posing as real", zeroIssue === 0, `found ${zeroIssue}`);
  check("no zero anchor values posing as real", zeroAnchorVal === 0, `found ${zeroAnchorVal}`);
  check("no zero anchor quantities posing as real", zeroAnchorQty === 0, `found ${zeroAnchorQty}`);
  check("no zero event quantities posing as real", zeroEventQty === 0, `found ${zeroEventQty}`);
  check("no zero event values posing as real", zeroEventVal === 0, `found ${zeroEventVal}`);
  check("no placeholder company names", junkNames === 0);
  check("no epoch/sentinel dates", epoch === 0);

  // 6. Disclose derived (not fetched) values, so they are not mistaken for source data.
  console.log("\n6. Values DERIVED rather than fetched (by design, disclosed)");
  console.log("     • lock-in expiry dates  <- allotment date + lockinRules durations");
  console.log("     • trading-day expiry    <- raw expiry rolled off NSE holidays/weekends");
  console.log("     • anchor tranche qty    <- disclosed anchor total / 2 (SEBI 50-50 split)");
  console.log("     • days remaining        <- today (IST) vs stored expiry");
  console.log("     Everything else is stored exactly as the source published it.");

  // Coverage of source-published fields (nulls are honest gaps, not failures).
  console.log("\n7. Source field coverage (null = source did not publish it)");
  for (const [label, n] of [
    ["symbol", await prisma.ipo.count({ where: { symbol: { not: null } } })],
    ["isin", await prisma.ipo.count({ where: { isin: { not: null } } })],
    ["listingDate", await prisma.ipo.count({ where: { listingDate: { not: null } } })],
    ["ipoPriceFinal", await prisma.ipo.count({ where: { ipoPriceFinal: { not: null } } })],
    ["issueSizeCr", await prisma.ipo.count({ where: { issueSizeCr: { not: null } } })],
    ["anchorValueCr", await prisma.ipo.count({ where: { anchorValueCr: { not: null } } })],
    ["registrar", await prisma.ipo.count({ where: { registrar: { not: null } } })],
    ["cmp (out of scope in v1)", await prisma.ipo.count({ where: { cmp: { not: null } } })],
  ] as const) {
    console.log(`     ${String(label).padEnd(26)} ${n}/${total}`);
  }

  console.log(`\n${failures === 0 ? "✅ AUDIT PASSED — no invented data found" : `❌ AUDIT FAILED — ${failures} check(s) failed`}`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Audit failed to run:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
