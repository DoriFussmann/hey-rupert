import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Campaign capacity is a tab of the Matching page. */
export default function CapacityPage({ params }: { params: { id: string } }) {
  redirect(matchPath(params.id, "capacity"));
}
