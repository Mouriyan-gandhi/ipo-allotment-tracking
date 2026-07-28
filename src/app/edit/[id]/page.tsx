import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { IpoForm } from "@/components/IpoForm";
import { getIpos } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Next 16: route params arrive as a Promise.
export default async function EditIpoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = (await getIpos()).find((r) => r.id === id);
  if (!row) notFound();

  return (
    <Shell active="/edit">
      <div className="max-w-4xl">
        <h1 className="text-sm font-semibold">Edit {row.companyName}</h1>
        <p className="mt-1 mb-4 text-xs text-fg-muted">
          Any field you change here is recorded in <code className="text-fg">manualOverrides</code>{" "}
          and will never be overwritten by a later sync. Changing the allotment date
          recomputes all four lock-in events.
        </p>
        <div className="rounded-lg border border-border bg-surface p-4">
          <IpoForm initial={row} />
        </div>
      </div>
    </Shell>
  );
}
