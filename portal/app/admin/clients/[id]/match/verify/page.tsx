import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Verify Emails is a tab of the Matching page now. */
export default function VerifyEmailsPage({ params }: { params: { id: string } }) {
  redirect(matchPath(params.id, "verify"));
}
