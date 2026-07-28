import { Shell } from "@/components/Shell";
import { prisma } from "@/lib/db";
import { fmtRelative } from "@/lib/format";

export const dynamic = "force-dynamic";

interface SyncErrors {
  errors?: string[];
  warnings?: string[];
  changes?: { ipo: string; field: string; from: string | null; to: string | null }[];
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-emerald-500/15 text-emerald-300",
  PARTIAL: "bg-amber-500/15 text-amber-300",
  FAILED: "bg-red-500/15 text-red-300",
};

export default async function SyncHistoryPage() {
  const runs = await prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });

  return (
    <Shell active="/sync">
      <h1 className="mb-3 text-sm font-semibold">Sync history</h1>

      {runs.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
          No sync has run yet. Use “Sync now” in the header, or wait for the daily 08:00 IST job.
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const detail = (run.errors as SyncErrors | null) ?? {};
            const duration = run.finishedAt
              ? `${((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000).toFixed(1)}s`
              : "running…";

            return (
              <div key={run.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLES[run.status] ?? ""}`}
                  >
                    {run.status}
                  </span>
                  <span className="text-fg-muted">{run.source}</span>
                  <span className="text-xs text-fg-dim">via {run.triggeredBy}</span>
                  <span className="text-xs text-fg-dim tnum">
                    {fmtRelative(run.startedAt.toISOString())} · {duration}
                  </span>
                  <span className="ml-auto text-xs tnum">
                    <span className="text-emerald-400">+{run.rowsAdded}</span>{" "}
                    <span className="text-fg-dim">new,</span>{" "}
                    <span className="text-sky-400">{run.rowsUpdated}</span>{" "}
                    <span className="text-fg-dim">updated</span>
                  </span>
                </div>

                {!!detail.changes?.length && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
                      {detail.changes.length} field change
                      {detail.changes.length === 1 ? "" : "s"} detected
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-fg-dim">
                      {detail.changes.slice(0, 40).map((c, i) => (
                        <li key={i} className="tnum">
                          <span className="text-fg-muted">{c.ipo}</span> · {c.field}:{" "}
                          {c.from ?? "—"} → <span className="text-fg">{c.to ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {!!detail.warnings?.length && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-amber-400/80 hover:text-amber-300">
                      {detail.warnings.length} warning{detail.warnings.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-300/70">
                      {detail.warnings.slice(0, 20).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {!!detail.errors?.length && (
                  <details className="mt-1" open>
                    <summary className="cursor-pointer text-xs text-red-400/80 hover:text-red-300">
                      {detail.errors.length} error{detail.errors.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-xs text-red-300/70">
                      {detail.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
