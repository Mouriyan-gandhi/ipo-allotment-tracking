import { Shell } from "@/components/Shell";
import { DashboardStrip } from "@/components/DashboardStrip";
import { IpoTable } from "@/components/IpoTable";
import { getIpos } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function SmePage() {
  const rows = await getIpos("SME");
  return (
    <Shell active="/sme">
      <DashboardStrip rows={rows} />
      <IpoTable rows={rows} title="SME" />
    </Shell>
  );
}
