import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  const { count } = await prisma.notification.updateMany({
    where: { readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true, marked: count });
}
