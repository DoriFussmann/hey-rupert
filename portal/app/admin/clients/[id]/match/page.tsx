import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Matching for a client opens on the Matching page. */
export default function ClientMatchPage({ params }: { params: { id: string } }) {
  redirect(matchPath(params.id));
}
