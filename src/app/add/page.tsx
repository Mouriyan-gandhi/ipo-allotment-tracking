import { Shell } from "@/components/Shell";
import { IpoForm } from "@/components/IpoForm";

export const dynamic = "force-dynamic";

export default function AddIpoPage() {
  return (
    <Shell active="/add">
      <div className="max-w-4xl">
        <h1 className="text-sm font-semibold">Add IPO manually</h1>
        <p className="mt-1 mb-4 text-xs text-fg-muted">
          A safety net for when ingestion cannot reach a source, or gets a field wrong.
          Only the allotment date is required — all four lock-in dates are computed from
          it. Anything left blank stays unknown and renders as “—”.
        </p>
        <div className="rounded-lg border border-border bg-surface p-4">
          <IpoForm />
        </div>
      </div>
    </Shell>
  );
}
