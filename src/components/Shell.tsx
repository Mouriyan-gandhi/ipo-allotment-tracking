import Link from "next/link";
import { getSyncStatus, getUnreadNotificationCount } from "@/lib/queries";
import { fmtRelative } from "@/lib/format";
import { SyncNowButton } from "./SyncNowButton";

// Calendar is the landing view, so it leads and points at "/".
const TABS = [
  { href: "/", label: "Calendar" },
  { href: "/mainboard", label: "Mainboard" },
  { href: "/sme", label: "SME" },
  { href: "/all", label: "All" },
];

const UTILITY = [
  { href: "/add", label: "Add IPO" },
  { href: "/sync", label: "Sync history" },
  { href: "/settings", label: "Settings" },
];

export async function Shell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  const [sync, unread] = await Promise.all([getSyncStatus(), getUnreadNotificationCount()]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            IPO Lock-in Tracker
          </Link>

          <nav className="flex items-center gap-1" aria-label="Views">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active === t.href ? "page" : undefined}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                  active === t.href
                    ? "bg-surface-2 text-fg"
                    : "text-fg-muted hover:bg-surface hover:text-fg"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-xs text-fg-muted">
            {UTILITY.map((u) => (
              <Link key={u.href} href={u.href} className="hover:text-fg">
                {u.label}
              </Link>
            ))}
            <Link href="/notifications" className="relative hover:text-fg" aria-label="Notifications">
              Alerts
              {unread > 0 && (
                <span className="ml-1 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  {unread}
                </span>
              )}
            </Link>
            <span className="hidden sm:inline text-fg-dim">
              synced {fmtRelative(sync.lastSuccessAt)}
            </span>
            <SyncNowButton />
          </div>
        </div>
      </header>

      {sync.isStale && (
        <div
          role="status"
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-300"
        >
          {sync.lastSuccessAt
            ? `Last successful sync was ${fmtRelative(sync.lastSuccessAt)} — data may be out of date.`
            : "No successful sync has run yet — showing seeded data only."}{" "}
          Lock-in dates are still computed from stored allotment dates.
        </div>
      )}

      <main className="mx-auto max-w-[1800px] px-4 py-4">{children}</main>
    </div>
  );
}
