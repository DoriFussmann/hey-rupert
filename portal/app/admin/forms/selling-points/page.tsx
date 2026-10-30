import { PageHeader } from "@/components/page-header";
import { SellingPointsEditor } from "@/app/admin/forms/selling-points/selling-points-editor";
import { SELLING_POINTS } from "@/lib/brief";
import { loadSellingPoints } from "@/lib/brief-server";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function SellingPointsPage() {
  const points = isServiceRoleConfigured() ? await loadSellingPoints(createServiceClient()) : SELLING_POINTS;
  return (
    <>
      <PageHeader
        title="Selling points"
        description="The list Rupert scores for every raise in the Company Brief. He picks the three strongest for the narrative. The guidance says what each point means. Changes apply the next time you score."
      />
      <SellingPointsEditor initialPoints={points} defaultPoints={SELLING_POINTS} />
    </>
  );
}
