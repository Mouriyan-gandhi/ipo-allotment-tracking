import { Shell } from "@/components/Shell";
import { DashboardStrip } from "@/components/DashboardStrip";
import { IpoTable } from "@/components/IpoTable";
import { getIpos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AllPage() {
  const rows = await getIpos();
  return (
    <Shell active="/all">
      <DashboardStrip rows={rows} />
      <IpoTable rows={rows} title="All IPOs" />
    </Shell>
  );
}
