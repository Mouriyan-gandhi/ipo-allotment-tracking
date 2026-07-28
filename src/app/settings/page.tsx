import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { defaultLockinRules, eventTypeMeta, type Board, type BoardLockinRules, type LockinEventType } from "@/lib/lockin-rules";
import { resolveLockinRules } from "@/lib/lockin-rules";
import { fmtDate } from "@/lib/format";
import { AlertRuleToggles } from "@/components/AlertRuleToggles";

export const dynamic = "force-dynamic";

const BOARDS: Board[] = ["MAINBOARD", "SME"];
const EVENT_TYPES: LockinEventType[] = ["ANCHOR_T1", "ANCHOR_T2", "PRE_IPO", "PROMOTER"];

export default async function SettingsPage() {
  const [settingsRow, holidays, alertRules] = await Promise.all([
    prisma.settings.findUnique({ where: { key: "lockinRules" } }),
    prisma.tradingHoliday.findMany({ orderBy: { date: "asc" } }),
    prisma.alertRule.findMany({ orderBy: [{ eventType: "asc" }, { offsetDays: "desc" }] }),
  ]);

  const overrides = (settingsRow?.value as Partial<Record<Board, Partial<BoardLockinRules>>>) ?? {};

  return (
    <Shell active="/settings">
      <div className="space-y-6">
        {/* ---- lock-in rules ---- */}
        <section>
          <h1 className="text-sm font-semibold">Lock-in rules</h1>
          <p className="mt-1 max-w-3xl text-xs text-fg-muted">
            Durations live in a single config (<code className="text-fg">src/lib/lockin-rules.ts</code>)
            and resolve in the order: global default → per-board override stored here →
            per-IPO override. No duration is hard-coded in any component or in the date
            engine, so SEBI changes are a config edit rather than a code change.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {BOARDS.map((board) => {
              const effective = resolveLockinRules(board, overrides[board]);
              return (
                <div key={board} className="rounded-lg border border-border bg-surface p-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {board}
                  </h2>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {EVENT_TYPES.map((t) => {
                        const rule = effective[t];
                        const isDefault =
                          rule.unit === defaultLockinRules[board][t].unit &&
                          rule.value === defaultLockinRules[board][t].value;
                        return (
                          <tr key={t} className="border-b border-border/60 last:border-0">
                            <td className="py-1.5 pr-2">
                              {eventTypeMeta[t].short}
                              {eventTypeMeta[t].lowConfidence && (
                                <span className="ml-1 text-amber-400" title="Verify against current SEBI ICDR">
                                  ⚠
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-right tnum">
                              {rule.value} {rule.unit}
                            </td>
                            <td className="py-1.5 pl-2 text-right text-[10px] text-fg-dim">
                              {isDefault ? "default" : "overridden"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            ⚠ Promoter lock-in uses an 18-month default that is <strong>not verified</strong>.
            Treat it as a starting point and check the current SEBI ICDR before relying on
            it. Anchor and pre-IPO durations reflect the rules the app was built against and
            should also be re-checked periodically.
          </p>
        </section>

        {/* ---- alerts ---- */}
        <section>
          <h2 className="text-sm font-semibold">Alert rules</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Toggle alerts per event type and offset. Delivery goes through the
            NotificationChannel abstraction; in-app is active and email is a stub.
          </p>
          <div className="mt-2">
            <AlertRuleToggles
              rules={alertRules.map((r) => ({
                id: r.id,
                eventType: r.eventType as LockinEventType,
                offsetDays: r.offsetDays,
                channel: r.channel,
                enabled: r.enabled,
              }))}
            />
          </div>
        </section>

        {/* ---- holidays ---- */}
        <section>
          <h2 className="text-sm font-semibold">
            NSE trading holidays{" "}
            <span className="font-normal text-fg-dim">({holidays.length})</span>
          </h2>
          <p className="mt-1 text-xs text-fg-muted">
            Used to roll a raw expiry forward to the next trading day. Sourced from NSE&apos;s
            published calendar — not hard-coded in logic. Dates beyond the published
            calendar fall back to weekend-only handling, so extend this list as NSE
            publishes future years.
          </p>
          <div className="mt-2 grid gap-x-6 gap-y-1 rounded-lg border border-border bg-surface p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {holidays.map((h) => (
              <div key={h.id} className="flex justify-between gap-2 border-b border-border/40 py-0.5">
                <span className="tnum text-fg-muted">
                  {fmtDate(h.date.toISOString().slice(0, 10))}
                </span>
                <span className="truncate text-fg-dim">{h.description ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
