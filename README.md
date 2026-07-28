# Indian IPO Lock-in Tracker

Tracks lock-in expiry dates for every Indian IPO — Mainboard and SME — so you can see
at a glance which stocks have supply hitting the market in the next N days.

For each IPO, four events are computed automatically from the allotment date:

| Event | Mainboard | SME |
| --- | --- | --- |
| Anchor lock-in tranche 1 (50%) | allotment + 30 days | allotment + 30 days |
| Anchor lock-in tranche 2 (50%) | allotment + 90 days | allotment + 90 days |
| Pre-IPO / non-promoter shareholders | allotment + 6 months | allotment + 12 months |
| Promoter ⚠ | allotment + 18 months | allotment + 18 months |

> ⚠ **The promoter duration is a low-confidence default.** It is a starting point, not a
> verified figure — check the current SEBI ICDR before relying on it. The UI flags it
> everywhere it appears and never presents it as fact.

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the values (see Environment below)
npm run db:push           # create the tables
npm run seed              # load real seed data + NSE holidays
npm run dev               # http://localhost:3000
```

Sign in with the value you set for `APP_PASSWORD`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm test` | Run the date-engine and parser unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Push the Prisma schema to the database |
| `npm run db:studio` | Browse the data in Prisma Studio |
| `npm run seed` | Seed holidays, alert rules, settings and IPOs (idempotent) |
| `npm run snapshot` | Re-fetch `prisma/seed-data.json` from Chittorgarh |

---

## Environment

Copy `.env.example` to `.env`. Two connection strings are needed because **two
different clients read them, and they need different SSL settings**:

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | app runtime (node-postgres) | Pooled, port 6543. Needs `sslmode=no-verify` — Supabase's pooler presents a self-signed chain, and `pg` treats `sslmode=require` as full verification, failing with `SELF_SIGNED_CERT_IN_CHAIN`. |
| `DIRECT_URL` | Prisma CLI (Rust schema engine) | Session pooler, port 5432. Needs `sslmode=require`; **without any `sslmode` the schema engine hangs indefinitely** on its connectivity probe. |
| `APP_PASSWORD` | login | The single shared password gating the whole app. |
| `SESSION_SECRET` | session cookie | Signs the auth cookie. Rotating it logs you out. |
| `CRON_SECRET` | `/api/cron/sync` | Bearer token Vercel Cron must send. |

If your database password contains reserved URL characters (`#`, `@`, `/`, `?`, `&`),
**URL-encode them** (`#` → `%23`) or authentication fails silently.

---

## Architecture

```
src/lib/lockin-rules.ts   Single source of truth for every duration
src/lib/date-engine.ts    IST civil-date maths, clamping, trading-day roll-forward
src/lib/lockin-service.ts The only writer of LockinEvent rows
src/lib/sources/          Pluggable IpoSourceAdapter implementations
src/lib/sync.ts           Ingestion: fallback, change detection, validation
src/lib/notifications.ts  NotificationChannel abstraction (in-app + email stub)
src/proxy.ts              Auth gate (Next 16 renamed `middleware` to `proxy`)
```

### Lock-in rules are data, not code

Every duration lives in `src/lib/lockin-rules.ts`. **No duration literal appears in the
date engine or in any component** — the engine consumes `resolveLockinRules()` output
only. Resolution order:

```
global default  →  per-board Settings override  →  per-IPO override
```

So when SEBI changes a rule, you edit config (or a Settings row), not code. Existing
rows are re-materialised by `recomputeAll()`.

### Date engine

- All maths happens on **Asia/Kolkata civil dates**, never raw UTC arithmetic.
- Day durations add calendar days. Month durations add calendar months keeping the
  day-of-month, **clamped to month-end**: 31 Aug + 6 months → 28 Feb (29 Feb in a leap
  year), never 3 Mar.
- After computing the raw expiry it rolls forward off weekends and NSE holidays to the
  next trading day. **Both dates are stored** (`rawExpiryDate` and
  `tradingDayExpiryDate`) and the UI marks shifted rows with `↷`.

Unit tests are mandatory and cover month-end clamping, leap-year handling, and
weekend/holiday roll-forward. Run `npm test`.

### Trading holidays

Seeded from **NSE's own published calendar**, not hard-coded in logic, and editable in
Settings. The seeded list currently covers 2026. Dates beyond the published calendar
fall back to weekend-only handling, so extend the list as NSE publishes future years.

---

## Data ingestion

### Why Chittorgarh is the primary source

The app depends on one field above all others: the **basis-of-allotment date**. Every
lock-in date is computed from it.

Chittorgarh was verified to publish it (`timetable_boa_dt`), machine-readably, together
with anchor quantity and value, registrar, and the full issue timetable. NSE and BSE
endpoints block data-centre IPs and do not expose allotment dates in a usable form. In
the current dataset **51 of 52 IPOs carry a real basis-of-allotment date and none are
estimated**.

Two endpoints are used:

1. **List** — `webnodejs.chittorgarh.com/cloud/report/data-read/82/1/1/{year}/{fy}/0/{board}`
   where `{board}` is `mainboard` or `sme` and must be the final path segment.
2. **Detail** — the IPO page, whose Next.js RSC payload carries the full record.

Adapters implement `IpoSourceAdapter` and are tried in priority order, so a broken
source can be swapped or disabled without touching the app. Chittorgarh is flagged
`lowerTrust` because it is a third-party aggregator rather than an exchange filing.

> **Parsing note.** Every IPO page also embeds a *peer-comparison table* carrying other
> companies' names. Scanning the whole payload therefore mixes records together and can
> pair a real IPO's symbol with a peer company's name. All reads are scoped to the IPO's
> own parsed record, with the URL slug as an identity guard. There is a regression test
> for this.

### Allotment date resolution

Never guessed silently:

1. Explicit basis-of-allotment → `BASIS_OF_ALLOTMENT`
2. Anchor circular date → `ANCHOR_CIRCULAR`
3. Listing date − 2 trading days → `ESTIMATED`, and the UI shows a ⚠ on that row

### Cross-checking

With a single source you cannot compare sources, so sync does two more useful things:

- **Change detection** — every field is diffed against what is stored, and changes are
  logged to Sync History. If the allotment date moves, all four events are recomputed.
- **Sanity validation** — rows are flagged when the allotment date falls outside the
  close→listing window, which is how a parsing error usually surfaces.

### What sync will not touch

Upserts key on `(source, sourceRef)` and **never overwrite a field you have edited by
hand** — manual edits are recorded in `manualOverrides` and checked before every write.
A source dropping a field is also never treated as "the value became blank".

To stay polite, detail pages are fetched only for IPOs that are new or can still change
(no allotment date yet, or listed within the last 30 days), boards are interleaved so
neither starves the other, and requests are serialised per host with a minimum gap,
exponential backoff, and no retries on genuine 4xx.

---

## Scheduling

`vercel.json` registers one cron job hitting `/api/cron/sync` at **02:30 UTC = 08:00
IST** daily. The route authenticates with `Authorization: Bearer $CRON_SECRET`. The same
ingestion runs behind the **Sync now** button in the header.

**Why Vercel Cron** over GitHub Actions or `node-cron`: it is native to the deploy
target, needs no extra account or service, and the free tier covers one daily job at
this scale. `node-cron` is a non-starter on serverless, which has no long-lived process.
GitHub Actions is the sensible fallback if you later need multiple runs a day or heavier
compute than a serverless function allows.

---

## Deploying to Vercel

1. Push the repo to GitHub and import it into Vercel.
2. Add `DATABASE_URL`, `DIRECT_URL`, `APP_PASSWORD`, `SESSION_SECRET` and `CRON_SECRET`
   as environment variables. **Change `APP_PASSWORD` from the local value.**
3. Deploy. The cron job registers automatically from `vercel.json`.

> **Expect scraping from Vercel to be less reliable than from your own machine.**
> Chittorgarh's robots.txt permits general clients (`User-agent: *` → `Allow: /`; the
> blocks target AI-training crawlers such as GPTBot and CCBot), but a WAF may still
> challenge data-centre IPs. If that happens the app degrades gracefully — stored data
> still renders, the stale-sync banner appears after 48 hours, and you can run a sync
> from your machine or add rows by hand.

---

## Assumptions

Chosen deliberately, and all editable:

1. **Single user, no accounts.** One shared password in `APP_PASSWORD`, checked by
   `src/proxy.ts` against an HMAC-signed cookie.
2. **CMP is out of scope for v1.** The column exists and always renders "—". The seam
   for a future price feed is `fetchCmp(symbol)` in `src/lib/cmp.ts`; no price is ever
   fabricated or estimated.
3. **Anchor quantity/value appear only when a source discloses them**, otherwise "—".
4. **Anchor T1/T2 are identical across boards** under current SEBI norms, but are still
   stored per board so they can diverge.
5. **Seed data is a committed snapshot**, not a live fetch, so `npm run seed` is offline
   and deterministic — while still being real Chittorgarh data. Refresh it with
   `npm run snapshot`.

**No fabricated data, anywhere.** Unknown values render as "—", never as a placeholder
number or an invented date.

---

## Implementation notes

Deviations from the original specification, and why:

- **Prisma 7** moved connection URLs out of `schema.prisma` into `prisma.config.ts`,
  switched to the `prisma-client` generator, and became driver-adapter based (hence
  `@prisma/adapter-pg`).
- **`symbol` is nullable and is not the sync key.** An NSE symbol is not assigned until
  listing, so most freshly-ingested IPOs have none — and those are exactly the rows with
  upcoming unlocks. Storing a placeholder would be fabricated data, so sync identity is
  `(source, sourceRef)`. `@@unique([symbol, board])` is kept for rows that do have a
  symbol; Postgres allows repeated NULLs in a unique index.
- **`middleware.ts` is now `proxy.ts`** (Next.js 16 rename).
- **SQLite is not supported.** The schema relies on Postgres arrays, enums and JSON.
