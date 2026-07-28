import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/sync";

// Ingestion is server-only and can take a while; never let it run at the edge.
export const runtime = "nodejs";
export const maxDuration = 300;

/** Manual "Sync now" — session-gated by proxy.ts. */
export async function POST() {
  try {
    const result = await runSync(prisma, { triggeredBy: "manual" });
    return NextResponse.json(result, { status: result.status === "FAILED" ? 502 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, status: "FAILED" },
      { status: 500 },
    );
  }
}
