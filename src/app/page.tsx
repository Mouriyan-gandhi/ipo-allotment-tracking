import { Shell } from "@/components/Shell";
import { CalendarView } from "@/components/CalendarView";
import { getIpos } from "@/lib/queries";

export const dynamic = "force-dynamic";

// The calendar is the landing view: it answers "what is unlocking soon" at a glance.
// Rendered directly at "/" rather than redirecting, so there is no extra hop.
export default async function HomePage() {
  const rows = await getIpos();
  return (
    <Shell active="/">
      <CalendarView rows={rows} />
    </Shell>
  );
}
