import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildRecomputeContext, isoToDate, recomputeLockinEvents } from "@/lib/lockin-service";

export const runtime = "nodejs";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const optionalIso = z.union([isoDate, z.literal("")]).optional();
const optionalNum = z.union([z.number(), z.literal("")]).optional();

// allotmentDate is the only genuinely required field, per the spec — everything else
// can be filled in later or left unknown.
const IpoBody = z.object({
  id: z.string().optional(),
  companyName: z.string().min(1, "Company name is required"),
  board: z.enum(["MAINBOARD", "SME"]),
  allotmentDate: isoDate,
  symbol: z.string().optional(),
  isin: z.string().optional(),
  listingDate: optionalIso,
  issueOpenDate: optionalIso,
  issueCloseDate: optionalIso,
  ipoPriceFinal: optionalNum,
  issueSizeCr: optionalNum,
  anchorValueCr: optionalNum,
  anchorQtyShares: z.string().optional(),
  registrar: z.string().optional(),
  notes: z.string().optional(),
});

const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const dat = (v: string | undefined) => (v && v.trim() ? isoToDate(v) : null);
const num = (v: number | "" | undefined) => (v === "" || v === undefined ? null : v);

export async function POST(request: Request) {
  const parsed = IpoBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const b = parsed.data;

  const fields = {
    companyName: b.companyName.trim(),
    board: b.board,
    symbol: str(b.symbol),
    isin: str(b.isin),
    allotmentDate: isoToDate(b.allotmentDate),
    allotmentDateSource: "BASIS_OF_ALLOTMENT" as const,
    listingDate: dat(b.listingDate),
    issueOpenDate: dat(b.issueOpenDate),
    issueCloseDate: dat(b.issueCloseDate),
    ipoPriceFinal: num(b.ipoPriceFinal),
    issueSizeCr: num(b.issueSizeCr),
    anchorValueCr: num(b.anchorValueCr),
    anchorQtyShares: b.anchorQtyShares?.trim() ? BigInt(b.anchorQtyShares.trim()) : null,
    registrar: str(b.registrar),
    notes: str(b.notes),
  };

  // Every field touched by hand is recorded in manualOverrides so a later sync can
  // never overwrite the user's entry.
  const manualOverrides = Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== null)
      .map(([k]) => [k, true]),
  );

  try {
    let id: string;
    if (b.id) {
      const existing = await prisma.ipo.findUnique({
        where: { id: b.id },
        select: { manualOverrides: true },
      });
      const merged = {
        ...((existing?.manualOverrides as Record<string, boolean>) ?? {}),
        ...manualOverrides,
      };
      const updated = await prisma.ipo.update({
        where: { id: b.id },
        data: { ...fields, manualOverrides: merged },
      });
      id = updated.id;
    } else {
      const created = await prisma.ipo.create({
        data: { ...fields, source: "manual", manualOverrides },
      });
      id = created.id;
    }

    const ctx = await buildRecomputeContext(prisma);
    const events = await recomputeLockinEvents(prisma, id, ctx);
    return NextResponse.json({ ok: true, id, events });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "An IPO with that symbol already exists on this board." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
