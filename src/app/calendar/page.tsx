import { Shell } from "@/components/Shell";
import { CalendarView } from "@/components/CalendarView";
import { getIpos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const rows = await getIpos();
  return (
    <Shell active="/calendar">
      <CalendarView rows={rows} />
    </Shell>
  );
}
