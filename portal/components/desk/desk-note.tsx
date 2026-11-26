import Link from "next/link";
import { getPortalView } from "@/lib/data";
import { DESK_PATH, STEP_LABEL, type DeskStep } from "@/lib/desk";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";

/**
 * On a step's page: says that what the client sends from here is also on
 * their Desk, with a link to that step's items. Shown once there is at least
 * one such item, so it never points at an empty list.
 */
export async function DeskNote({ step }: { step: DeskStep }) {
  const { client } = await getPortalView();
  if (!client || !isServiceRoleConfigured()) return null;

  let open = 0;
  let total = 0;
  try {
    const { data, error } = await createServiceClient()
      .from("desk_items")
      .select("status")
      .eq("client_id", client.id)
      .eq("step", step)
      .limit(500);
    if (error || !data) return null;
    total = data.length;
    open = data.filter((row) => row.status !== "closed").length;
  } catch {
    return null;
  }
  if (total === 0) return null;

  return (
    <p className="mt-lg rounded-card border border-border bg-surface px-lg py-md text-body-sm text-secondary">
      Everything you send from this page is also on your Desk, with Rupert&apos;s answers.{" "}
      <Link href={`${DESK_PATH}?step=${step}`} className="text-primary no-underline hover:text-primary-hover">
        {STEP_LABEL[step]} on your Desk
        {open > 0 ? ` (${open} open)` : ""}
      </Link>
    </p>
  );
}
