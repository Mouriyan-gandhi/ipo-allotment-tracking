import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 is driver-adapter based (no bundled query engine). We connect through the
// pg adapter using the pooled DATABASE_URL (Supabase transaction pooler, port 6543).
// A single client is cached on globalThis so Next.js hot-reload doesn't open a new
// pool on every change.

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase connection strings.",
    );
  }
  // Fail fast instead of hanging. On networks that block outbound Postgres ports the
  // TCP connect never completes, and without a timeout every page request would stall
  // for minutes before erroring — far worse than showing the error boundary quickly.
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 10_000,
    // Keep the pool small: Supabase's transaction pooler is the real pool, and
    // serverless instances should not each hold many connections.
    max: 5,
  });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
