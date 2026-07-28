"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { eventTypeMeta, type LockinEventType } from "@/lib/lockin-rules";

interface Rule {
  id: string;
  eventType: LockinEventType;
  offsetDays: number;
  channel: string;
  enabled: boolean;
}

const offsetLabel = (d: number) => (d === 0 ? "morning of" : `T-${d}`);

export function AlertRuleToggles({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [local, setLocal] = useState(rules);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(rule: Rule) {
    const next = !rule.enabled;
    setBusy(rule.id);
    setLocal((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));
    try {
      const res = await fetch("/api/settings/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: next }),
      });
      if (!res.ok) throw new Error("failed");
      router.refresh();
    } catch {
      // Roll the optimistic update back so the UI never claims a save that failed.
      setLocal((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !next } : r)));
    } finally {
      setBusy(null);
    }
  }

  const byEvent = local.reduce<Record<string, Rule[]>>((acc, r) => {
    (acc[r.eventType] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(byEvent).map(([eventType, list]) => (
        <div key={eventType} className="rounded-lg border border-border bg-surface p-3">
          <div className="text-xs font-medium">
            {eventTypeMeta[eventType as LockinEventType].short}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {list
              .sort((a, b) => b.offsetDays - a.offsetDays)
              .map((r) => (
                <button
                  key={r.id}
                  disabled={busy === r.id}
                  onClick={() => toggle(r)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                    r.enabled
                      ? "border-accent/40 bg-accent/15 text-accent"
                      : "border-border-strong text-fg-dim hover:text-fg"
                  }`}
                >
                  {offsetLabel(r.offsetDays)}
                  <span className="ml-1 text-[10px] opacity-70">{r.channel}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
