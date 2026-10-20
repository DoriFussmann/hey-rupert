import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Rupert Match now opens on the Fund Database page, with this client picked. */
export default function ClientMatchPage({ params }: { params: { id: string } }) {
  redirect(matchPath(params.id));
}
