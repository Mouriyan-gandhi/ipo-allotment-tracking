import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const Body = z.object({ id: z.string().min(1), enabled: z.boolean() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await prisma.alertRule.update({
    where: { id: parsed.data.id },
    data: { enabled: parsed.data.enabled },
  });
  return NextResponse.json({ ok: true });
}
