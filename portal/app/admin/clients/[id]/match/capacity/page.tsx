import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Campaign planning is the Plan tab of the Matching page. */
export default function CapacityPage({ params }: { params: { id: string } }) {
  redirect(matchPath(params.id, "plan"));
}
