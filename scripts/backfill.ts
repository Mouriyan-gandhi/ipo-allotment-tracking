/**
 * Full backfill: ingest every IPO the source lists for the requested years.
 *
 * Run directly rather than through /api/sync because this takes minutes and would
 * exceed a serverless function's time limit. Requests are still rate limited by the
 * polite HTTP layer, so this is slow by design.
 *
 * Verified data only: the ESTIMATED allotment-date tier stays OFF, so an IPO whose
 * basis-of-allotment date the source has not published is stored WITHOUT an
 * allotment date and gets no computed lock-in dates. Nothing is inferred.
 *
 * Usage:
 *   npm run backfill                       # current + previous calendar year
 *   npm run backfill -- --years 2026,2025
 *   npm run backfill -- --max 500
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { ChittorgarhAdapter } from "../src/lib/sources/chittorgarh";
import { runSync } from "../src/lib/sync";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const thisYear = new Date().getUTCFullYear();
const years = (arg("--years") ?? `${thisYear},${thisYear - 1}`)
  .split(",")
  .map((y) => Number(y.trim()))
  .filter((y) => Number.isFinite(y));
const max = Number(arg("--max") ?? 500);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  console.log(`Backfilling years: ${years.join(", ")}  (cap ${max} detail fetches)`);
  console.log("Verified data only — the ESTIMATED allotment fallback is disabled.\n");

  const before = await prisma.ipo.count();
  const started = Date.now();

  const result = await runSync(prisma, {
    triggeredBy: "backfill",
    adapters: [new ChittorgarhAdapter(years)],
    maxDetailFetches: max,
    allowEstimatedAllotment: false,
  });

  const after = await prisma.ipo.count();
  const mins = ((Date.now() - started) / 60000).toFixed(1);

  console.log(`\n─────────────────────────────────────────`);
  console.log(`status       : ${result.status}   (${mins} min)`);
  console.log(`rows added   : ${result.rowsAdded}`);
  console.log(`rows updated : ${result.rowsUpdated}`);
  console.log(`IPOs         : ${before} -> ${after}`);
  console.log(`changes      : ${result.changes.length}`);
  console.log(`warnings     : ${result.warnings.length}`);
  console.log(`errors       : ${result.errors.length}`);

  for (const e of result.errors.slice(0, 10)) console.log(`   error: ${e}`);
  for (const w of result.warnings.slice(0, 10)) console.log(`   warn : ${w}`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
