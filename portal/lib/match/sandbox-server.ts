import "server-only";
import { randomUUID } from "node:crypto";
import { matchTableError, selectAll } from "@/lib/match/db-server";
import {
  buildProfile,
  cleanAnswers,
  loadProfileState,
  saveProfileState,
} from "@/lib/match/profile-server";
import { buildView, runClientMatch, storeMatch } from "@/lib/match/run-server";
import {
  SANDBOX_COMPANY_NAME,
  SANDBOX_MIGRATION_MISSING,
  SANDBOX_FIELD_IDS,
  sandboxAnswers,
  type SandboxCompany,
  type SandboxPanel,
} from "@/lib/match/sandbox";
import { DEFAULT_SETTINGS, type MatchAnswers } from "@/lib/match/shared";
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
async function ensureSandbox(supabase: ServiceClient): Promise<Result<string>> {
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

/** What the Match Sandbox panel needs: the sandbox's answers and every real company. */
export async function loadSandboxPanel(supabase: ServiceClient): Promise<Result<SandboxPanel>> {
  const sandbox = await findSandboxId(supabase);
  if (!sandbox.ok) return sandbox;

  const [clients, profiles] = await Promise.all([
    supabase
      .from("clients")
      .select("id, company_name, archived_at, is_match_sandbox")
      .order("company_name", { ascending: true }),
    selectAll<{ client_id: string; answers: unknown; settings: unknown }>((from, to) =>
      supabase
        .from("match_profiles")
        .select("client_id, answers, settings")
        .order("client_id")
        .range(from, to),
    ),
  ]);
  if (clients.error) return { ok: false, error: sandboxError(clients.error.message, clients.error.code) };
  if (!profiles.ok) return profiles;

  const answersById = new Map(profiles.rows.map((row) => [row.client_id, cleanAnswers(row.answers)]));
  const companies: SandboxCompany[] = ((clients.data ?? []) as Record<string, unknown>[])
    .filter((row) => row.is_match_sandbox !== true)
    .map((row) => {
      const id = String(row.id);
      const answers = answersById.get(id);
      const built = answers ? buildProfile(answers, DEFAULT_SETTINGS) : null;
      return {
        id,
        name: String(row.company_name ?? "") || "(no name)",
        ready: Boolean(built?.ready),
        missing: built ? built.gaps.map((gap) => gap.label) : ["Company profile"],
        archived: row.archived_at != null,
      };
    });

  return {
    ok: true,
    value: {
      sandboxId: sandbox.value,
      answers: sandbox.value ? sandboxAnswers(answersById.get(sandbox.value) ?? {}) : {},
      companies,
    },
  };
}

/** Saves the sandbox answers, runs the match and stores it for the Match page. */
export async function runSandboxMatch(
  supabase: ServiceClient,
  raw: unknown,
): Promise<Result<{ clientId: string }>> {
  const answers = sandboxAnswers(cleanAnswers(raw));
  const built = buildProfile(answers, DEFAULT_SETTINGS);
  if (!built.ready) {
    return { ok: false, error: `Set ${built.gaps.map((gap) => gap.label).join(", ")} to run the match.` };
  }
  const sandbox = await ensureSandbox(supabase);
  if (!sandbox.ok) return sandbox;
  const clientId = sandbox.value;

  const current = await loadProfileState(supabase, clientId);
  if (!current.ok) return current;
  const saved = await saveProfileState(supabase, clientId, {
    answers,
    settings: current.value?.settings ?? DEFAULT_SETTINGS,
    source: "edit",
  });
  if (!saved.ok) return saved;

  const run = await runClientMatch(supabase, clientId);
  if (!run.ok) return run;
  await storeMatch(supabase, clientId, buildView(run.value));
  return { ok: true, value: { clientId } };
}

/** A real company's answers for the sandbox fields, to fill the form. */
export async function companyAnswers(supabase: ServiceClient, clientId: string): Promise<Result<MatchAnswers>> {
  const loaded = await loadProfileState(supabase, clientId);
  if (!loaded.ok) return loaded;
  if (!loaded.value) return { ok: false, error: "This company has no company profile yet." };
  const answers: MatchAnswers = {};
  for (const id of SANDBOX_FIELD_IDS) {
    const value = loaded.value.answers[id];
    if (value !== undefined) answers[id] = value;
  }
  return { ok: true, value: answers };
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
  // Saved match runs are permanent; this marks where the sandbox starts again.
  // Best effort: the reset itself doesn't depend on it.
  await supabase.from("match_sandbox_resets").insert({ client_id: clientId });

  const loaded = await loadProfileState(supabase, clientId);
  if (loaded.ok && loaded.value && buildProfile(loaded.value.answers, loaded.value.settings).ready) {
    const run = await runClientMatch(supabase, clientId);
    if (run.ok) await storeMatch(supabase, clientId, buildView(run.value));
  }
  return { ok: true, value: { clientId } };
}
