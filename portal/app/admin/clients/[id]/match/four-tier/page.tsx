import { redirect } from "next/navigation";
import { matchPath } from "@/lib/match/shared";

/** Saved runs are the History tab of the Matching page. */
export default function SavedRunsPage({ params, searchParams }: { params: { id: string }; searchParams: { run?: string } }) {
  const run = typeof searchParams.run === "string" && /^[0-9a-f-]{36}$/i.test(searchParams.run) ? `&run=${searchParams.run}` : "";
  redirect(`${matchPath(params.id, "history")}${run}`);
}
