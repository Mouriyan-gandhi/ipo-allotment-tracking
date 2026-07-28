/**
 * One-off repair: convert stored zeros back to NULL.
 *
 * Chittorgarh emits "0"/"0.00" for values it has not published (an upcoming IPO's
 * issue size, an undisclosed anchor allocation). Earlier ingests stored those as 0,
 * which the UI renders as a real figure — asserting "zero shares unlock" instead of
 * showing "—". The adapter now rejects non-positive values at parse time; this
 * repairs rows written before that fix.
 *
 * Zero is never legitimate for these fields: no IPO has a zero issue size, zero
 * price, or zero anchor allocation.
 *
 * Usage: npm run clean:zeros
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildRecomputeContext, recomputeLockinEvents } from "../src/lib/lockin-service";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  console.log("Repairing zero placeholders -> NULL\n");

  const before = {
    issueSizeCr: await prisma.ipo.count({ where: { issueSizeCr: 0 } }),
    ipoPriceFinal: await prisma.ipo.count({ where: { ipoPriceFinal: 0 } }),
    ipoPriceMin: await prisma.ipo.count({ where: { ipoPriceMin: 0 } }),
    ipoPriceMax: await prisma.ipo.count({ where: { ipoPriceMax: 0 } }),
    listingPrice: await prisma.ipo.count({ where: { listingPrice: 0 } }),
    anchorValueCr: await prisma.ipo.count({ where: { anchorValueCr: 0 } }),
    anchorQtyShares: await prisma.ipo.count({ where: { anchorQtyShares: BigInt(0) } }),
  };

  for (const [field, n] of Object.entries(before)) {
    if (n === 0) continue;
    const where =
      field === "anchorQtyShares" ? { [field]: BigInt(0) } : { [field]: 0 };
    await prisma.ipo.updateMany({
      where: where as never,
      data: { [field]: null } as never,
    });
    console.log(`  ${field.padEnd(16)} ${n} row(s) -> NULL`);
  }

  // Lock-in event quantities derive from the anchor totals, so re-materialise every
  // IPO whose events could have carried a zero.
  const ctx = await buildRecomputeContext(prisma);
  const affected = await prisma.ipo.findMany({
    where: { lockinEvents: { some: { OR: [{ qtyShares: BigInt(0) }, { valueCr: 0 }] } } },
    select: { id: true },
  });
  for (const { id } of affected) await recomputeLockinEvents(prisma, id, ctx);
  console.log(`  lock-in events   recomputed for ${affected.length} IPO(s)`);

  console.log("\nRemaining zeros:");
  console.log("  Ipo.issueSizeCr     :", await prisma.ipo.count({ where: { issueSizeCr: 0 } }));
  console.log("  Ipo.anchorQtyShares :", await prisma.ipo.count({ where: { anchorQtyShares: BigInt(0) } }));
  console.log("  LockinEvent.qty     :", await prisma.lockinEvent.count({ where: { qtyShares: BigInt(0) } }));
  console.log("  LockinEvent.value   :", await prisma.lockinEvent.count({ where: { valueCr: 0 } }));
}

main()
  .catch((e) => {
    console.error("Repair failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
