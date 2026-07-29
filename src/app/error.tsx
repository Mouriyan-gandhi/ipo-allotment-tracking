"use client";

import { useEffect } from "react";

/**
 * Global error boundary.
 *
 * The most likely failure in normal operation is the database being unreachable —
 * on restrictive networks (corporate/hotel/university WiFi, some mobile hotspots)
 * outbound Postgres ports 5432/6543 are blocked even though the web works fine.
 * That case gets a specific, actionable message rather than a bare stack trace,
 * because it is not a bug in the app and the fix is on the network side.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const message = `${error.message} ${error.digest ?? ""}`;
  const looksLikeDbOutage =
    /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|Can't reach database|connection|prisma|pool/i.test(message);

  return (
    <main className="flex min-h-screen items-start justify-center p-6 sm:items-center">
      <div className="w-full max-w-xl rounded-lg border border-border bg-surface p-6">
        <h1 className="text-base font-semibold text-danger">
          {looksLikeDbOutage ? "Can’t reach the database" : "Something went wrong"}
        </h1>

        {looksLikeDbOutage ? (
          <>
            <p className="mt-2 text-sm text-fg-muted">
              The app is running, but it can’t open a connection to Postgres. Your stored
              IPOs and lock-in dates are safe — nothing has been lost.
            </p>
            <p className="mt-3 text-sm text-fg-muted">
              The usual cause is a network that blocks outbound Postgres ports
              (<span className="font-mono text-fg">5432</span> and{" "}
              <span className="font-mono text-fg">6543</span>) while still allowing normal
              web traffic. This is common on corporate, hotel and university WiFi, and on
              some mobile hotspots.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fg-muted">
              <li>Switch to a different network or a mobile hotspot, then retry.</li>
              <li>
                Check reachability:{" "}
                <code className="rounded bg-bg px-1 py-0.5 font-mono text-xs text-fg">
                  nc -z -w 5 &lt;your-db-host&gt; 6543
                </code>
              </li>
              <li>
                Confirm <span className="font-mono text-fg">DATABASE_URL</span> and{" "}
                <span className="font-mono text-fg">DIRECT_URL</span> in{" "}
                <span className="font-mono text-fg">.env</span> (reserved characters in the
                password must be URL-encoded).
              </li>
            </ul>
          </>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">
            An unexpected error occurred while rendering this page.
          </p>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-fg-dim hover:text-fg-muted">
            Technical detail
          </summary>
          <pre className="mt-2 overflow-x-auto rounded bg-bg p-2 text-[11px] text-fg-dim">
            {error.message || "(no message)"}
            {error.digest ? `\ndigest: ${error.digest}` : ""}
          </pre>
        </details>

        <button
          onClick={reset}
          className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
