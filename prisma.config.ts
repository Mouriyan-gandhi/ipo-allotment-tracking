// Loads .env (via dotenv) so env() in prisma/schema.prisma resolves for CLI commands.
// The connection URLs (DATABASE_URL pooled 6543, DIRECT_URL session-pooler 5432) live
// in the schema datasource block so the generated client resolves them at app runtime too.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI work (migrate/push/studio) must not go through the transaction pooler, and
    // the Rust engine wants sslmode=require — both of which DIRECT_URL provides.
    // DATABASE_URL carries sslmode=no-verify for the Node pg driver and would fail here.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    directUrl: process.env["DIRECT_URL"],
  },
});
