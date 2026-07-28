import { Shell } from "@/components/Shell";
import { DashboardStrip } from "@/components/DashboardStrip";
import { IpoTable } from "@/components/IpoTable";
import { getIpos } from "@/lib/queries";

// Always read live data; lock-in urgency changes every day.
export const dynamic = "force-dynamic";

export default async function MainboardPage() {
  const rows = await getIpos("MAINBOARD");
  return (
    <Shell active="/mainboard">
      <DashboardStrip rows={rows} />
      <IpoTable rows={rows} title="Mainboard" />
    </Shell>
  );
}
