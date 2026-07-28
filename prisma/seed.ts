/**
 * Seeds the database from committed, real source data.
 *
 *   - prisma/nse-holidays.json  : NSE equity trading holidays (from NSE's own API)
 *   - prisma/seed-data.json     : real IPOs snapshotted from Chittorgarh
 *
 * Idempotent: safe to re-run. Existing rows are updated, never duplicated, and any
 * field the user has manually overridden is left alone.
 *
 * Usage: npm run seed
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import {
  buildRecomputeContext,
  isoToDate,
  recomputeLockinEvents,
} from "../src/lib/lockin-service";
import type { Board } from "../src/lib/lockin-rules";

interface SeedFile {
  generatedAt: string;
  source: string;
  records: SeedRecord[];
}

interface SeedRecord {
  sourceId: string;
  slug?: string;
  companyName: string;
  board: Board;
  symbol?: string;
  isin?: string;
  allotmentDate?: string;
  allotmentDateSource?: "BASIS_OF_ALLOTMENT" | "ANCHOR_CIRCULAR" | "ESTIMATED";
  issueOpenDate?: string;
  issueCloseDate?: string;
  listingDate?: string;
  ipoPriceFinal?: number;
  ipoPriceMin?: number;
  ipoPriceMax?: number;
  issueSizeCr?: number;
  anchorValueCr?: number;
  anchorQtyShares?: string;
  registrar?: string;
  leadManagers?: string[];
  source: string;
}

interface HolidayRecord {
  date: string;
  description: string;
  weekDay?: string;
}

const readJson = <T>(p: string): T =>
  JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8")) as T;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function seedHolidays() {
  const holidays = readJson<HolidayRecord[]>("prisma/nse-holidays.json");
  for (const h of holidays) {
    await prisma.tradingHoliday.upsert({
      where: { date_exchange: { date: isoToDate(h.date), exchange: "NSE" } },
      create: { date: isoToDate(h.date), description: h.description, exchange: "NSE" },
      update: { description: h.description },
    });
  }
  console.log(`  trading holidays : ${holidays.length}`);
  return holidays.length;
}

async function seedAlertRules() {
  // T-7, T-1 and morning-of, per the spec, for every event type. In-app only; the
  // email channel exists as a stub and is left disabled.
  const offsets = [7, 1, 0];
  const eventTypes = ["ANCHOR_T1", "ANCHOR_T2", "PRE_IPO", "PROMOTER"] as const;
  let n = 0;
  for (const eventType of eventTypes) {
    for (const offsetDays of offsets) {
      await prisma.alertRule.upsert({
        where: {
          eventType_offsetDays_channel: { eventType, offsetDays, channel: "IN_APP" },
        },
        create: { eventType, offsetDays, channel: "IN_APP", enabled: true },
        update: {},
      });
      n++;
    }
  }
  console.log(`  alert rules      : ${n}`);
}

async function seedSettings() {
  // Empty object = no per-board overrides; defaults in lib/lockin-rules.ts apply.
  await prisma.settings.upsert({
    where: { key: "lockinRules" },
    create: { key: "lockinRules", value: {} },
    update: {},
  });
  await prisma.settings.upsert({
    where: { key: "alertsEnabled" },
    create: { key: "alertsEnabled", value: { IN_APP: true, EMAIL: false } },
    update: {},
  });
  console.log(`  settings         : 2 keys`);
}

async function seedIpos() {
  const file = readJson<SeedFile>("prisma/seed-data.json");
  let added = 0;
  let updated = 0;

  for (const r of file.records) {
    const existing = await prisma.ipo.findUnique({
      where: { source_sourceRef: { source: r.source, sourceRef: r.sourceId } },
      select: { id: true, manualOverrides: true },
    });

    // Never clobber a field the user has hand-edited.
    const overrides = (existing?.manualOverrides as Record<string, boolean> | null) ?? {};
    const keep = <T>(field: string, value: T): T | undefined =>
      overrides[field] ? undefined : value;

    const data = {
      symbol: keep("symbol", r.symbol ?? null),
      companyName: keep("companyName", r.companyName)!,
      board: r.board,
      isin: keep("isin", r.isin ?? null),
      allotmentDate: keep("allotmentDate", r.allotmentDate ? isoToDate(r.allotmentDate) : null),
      allotmentDateSource: keep("allotmentDate", r.allotmentDateSource ?? null),
      listingDate: keep("listingDate", r.listingDate ? isoToDate(r.listingDate) : null),
      issueOpenDate: keep("issueOpenDate", r.issueOpenDate ? isoToDate(r.issueOpenDate) : null),
      issueCloseDate: keep("issueCloseDate", r.issueCloseDate ? isoToDate(r.issueCloseDate) : null),
      ipoPriceFinal: keep("ipoPriceFinal", r.ipoPriceFinal ?? null),
      ipoPriceMin: keep("ipoPriceMin", r.ipoPriceMin ?? null),
      ipoPriceMax: keep("ipoPriceMax", r.ipoPriceMax ?? null),
      issueSizeCr: keep("issueSizeCr", r.issueSizeCr ?? null),
      anchorValueCr: keep("anchorValueCr", r.anchorValueCr ?? null),
      anchorQtyShares: keep(
        "anchorQtyShares",
        r.anchorQtyShares ? BigInt(r.anchorQtyShares) : null,
      ),
      registrar: keep("registrar", r.registrar ?? null),
      leadManagers: keep("leadManagers", r.leadManagers ?? []),
      source: r.source,
      sourceRef: r.sourceId,
      lastSyncedAt: new Date(),
    };

    if (existing) {
      await prisma.ipo.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.ipo.create({ data });
      added++;
    }
  }

  console.log(`  IPOs             : ${added} added, ${updated} updated`);
  return file;
}

async function main() {
  console.log("Seeding from committed real source data\n");

  await seedHolidays();
  await seedAlertRules();
  await seedSettings();
  const file = await seedIpos();

  // Materialise lock-in events last, once holidays and rules are in place.
  const ctx = await buildRecomputeContext(prisma);
  const ipos = await prisma.ipo.findMany({ select: { id: true } });
  let events = 0;
  for (const { id } of ipos) events += await recomputeLockinEvents(prisma, id, ctx);
  console.log(`  lock-in events   : ${events}`);

  const withAllotment = await prisma.ipo.count({ where: { allotmentDate: { not: null } } });
  console.log(
    `\nDone. ${ipos.length} IPOs (${withAllotment} with an allotment date), ` +
      `snapshot taken ${file.generatedAt.slice(0, 10)} from ${file.source}.`,
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
