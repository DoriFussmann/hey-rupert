import "server-only";
import { randomUUID } from "node:crypto";
import { matchTableError } from "@/lib/match/db-server";
import { loadProfileState, saveProfileState } from "@/lib/match/profile-server";
import { SANDBOX_COMPANY_NAME, SANDBOX_MIGRATION_MISSING } from "@/lib/match/sandbox";
import type { createServiceClient } from "@/lib/supabase/admin";
import { testPilotEmail } from "@/lib/test-pilot";

type ServiceClient = ReturnType<typeof createServiceClient>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function sandboxError(message: string, code?: string) {
  if (/is_match_sandbox|clients_one_match_sandbox/.test(message) || /is_test_pilot/.test(message)) {
    return SANDBOX_MIGRATION_MISSING;
  }
  return matchTableError(message, code);
}

/** The sandbox company's id, or null before it is first created. */
export async function findSandboxId(supabase: ServiceClient): Promise<Result<string | null>> {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("is_match_sandbox", true)
    .maybeSingle();
  if (error) return { ok: false, error: sandboxError(error.message, error.code) };
  return { ok: true, value: data?.id != null ? String(data.id) : null };
}

/**
 * The sandbox company, created on first use: a test pilot client (emails
 * paused, nobody signs in) with Setup open, so its portal can show the
 * Investor Matching page.
 */
export async function ensureSandbox(supabase: ServiceClient): Promise<Result<string>> {
  const existing = await findSandboxId(supabase);
  if (!existing.ok) return existing;
  if (existing.value) return { ok: true, value: existing.value };

  const email = testPilotEmail(`sandbox-${randomUUID().slice(0, 8)}`);
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { role: "client" },
  });
  if (createError || !created.user) {
    return { ok: false, error: createError?.message ?? "The sandbox account could not be created." };
  }
  const id = created.user.id;
  const { error } = await supabase.from("clients").insert({
    id,
    first_name: "Test",
    last_name: "Pilot",
    email,
    company_name: SANDBOX_COMPANY_NAME,
    stage: "setup",
    is_test_pilot: true,
    emails_paused: true,
    is_match_sandbox: true,
  });
  if (error) {
    await supabase.auth.admin.deleteUser(id);
    // Created meanwhile by another request: use that one.
    if (error.code === "23505") {
      const again = await findSandboxId(supabase);
      if (again.ok && again.value) return { ok: true, value: again.value };
    }
    return { ok: false, error: sandboxError(error.message, error.code) };
  }
  return { ok: true, value: id };
}

/**
 * Gives the test client a real client's company profile (answers and
 * settings), so the whole flow can be tried on that company. The real
 * client is not changed. The company name stays the test client's.
 */
export async function copyProfileToSandbox(supabase: ServiceClient, sourceId: string): Promise<Result<{ clientId: string }>> {
  const source = await loadProfileState(supabase, sourceId);
  if (!source.ok) return source;
  if (!source.value) return { ok: false, error: "That client has no company profile yet." };
  const sandbox = await ensureSandbox(supabase);
  if (!sandbox.ok) return sandbox;
  if (sandbox.value === sourceId) return { ok: false, error: "Pick a real client to copy from." };
  const saved = await saveProfileState(supabase, sandbox.value, {
    answers: { ...source.value.answers, company_name: SANDBOX_COMPANY_NAME },
    settings: source.value.settings,
    source: "edit",
  });
  if (!saved.ok) return saved;
  return { ok: true, value: { clientId: sandbox.value } };
}

/**
 * Starts the sandbox clean: its reviews, keep / remove decisions,
 * verification runs and the list pushed to its portal are deleted. Global
 * data (Fund Database fixes, checks, funds hidden for everyone) stays.
 */
export async function resetSandbox(supabase: ServiceClient): Promise<Result<{ clientId: string | null }>> {
  const sandbox = await findSandboxId(supabase);
  if (!sandbox.ok) return sandbox;
  const clientId = sandbox.value;
  if (!clientId) return { ok: true, value: { clientId: null } };

  const deletes = await Promise.all([
    supabase.from("match_reviews").delete().eq("client_id", clientId),
    supabase.from("contact_decisions").delete().eq("client_id", clientId),
    supabase.from("verification_runs").delete().eq("client_id", clientId),
    supabase.from("setup_steps").delete().eq("client_id", clientId).eq("step", "investor_list"),
  ]);
  const failed = deletes.find((result) => result.error);
  if (failed?.error) return { ok: false, error: sandboxError(failed.error.message, failed.error.code) };
  // Saved match runs and capacity plans are permanent; this marks where the
  // test client starts again. Best effort: the reset itself doesn't depend on it.
  await supabase.from("match_sandbox_resets").insert({ client_id: clientId });
  return { ok: true, value: { clientId } };
}
