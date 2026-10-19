"use server";

import { revalidatePath } from "next/cache";
import {
  deleteClient,
  generateNda,
  generateServiceOrder,
  sendDefaultStatementOfWork,
  sendNda,
  sendServiceOrder,
} from "@/app/admin/actions";
import { getAuthContext } from "@/lib/auth";
import { isClaudeConfigured } from "@/lib/anthropic";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadSetupSteps } from "@/lib/setup-server";
import type { SetupStepState } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";
import {
  TEST_PILOT_MIGRATION_MISSING,
  isTestPilotColumnError,
} from "@/lib/test-pilot";
import { attachMaterialFile } from "@/lib/materials-server";
import {
  completeIntakeWithTestData,
  confirmReviewAsClient,
  confirmSowAsClient,
  createTestDeckUploadUrl,
  loadTestClient,
  markSetupFeePaid,
  removeClientFiles,
  signNdaAsClient,
  signServiceOrderAsClient,
  submitMaterialsWithTestData,
  type ReviewStep,
  type StepResult,
} from "@/lib/test-pilot-server";
import type { MaterialFile } from "@/lib/setup";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type TestRunResult =
  | {
      ok: true;
      /** What was done, in order. */
      done: string[];
      /** Why it stopped: whose turn it is, or that setup is complete. */
      stop: string;
      owner: "admin" | "done" | "paused";
    }
  | { ok: false; error: string; done: string[] };

/** A Claude step only starts this early in a run, to stay inside the time limit. */
const CLAUDE_START_BUDGET_MS = 30_000;
const MAX_STEPS = 25;

async function requireAdmin() {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") {
    return { ok: false as const, error: "You do not have permission to do that." };
  }
  if (!isServiceRoleConfigured()) {
    return { ok: false as const, error: "Service role key is not configured." };
  }
  return { ok: true as const, supabase: createServiceClient() };
}

function revalidateClient(clientId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/portal", "layout");
}

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

type Step =
  | { kind: "client"; label: string; claude?: boolean; run: () => Promise<StepResult> }
  /** Rupert's routine step (issuing a document), done for you in a full test. */
  | { kind: "issue"; label: string; todo: string; claude?: false; run: () => Promise<StepResult> }
  | { kind: "stop"; owner: "admin" | "done"; label: string }
  | { kind: "error"; error: string };

function toStep(result: { ok: true } | { ok: false; error: string }): StepResult {
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** The next thing to do for this test client, in process order. */
async function nextStep(
  supabase: ServiceClient,
  client: Record<string, unknown>,
): Promise<Step> {
  const clientId = String(client.id);

  if (!client.sow_confirmed_at) {
    const { data: sent, error } = await supabase
      .from("statement_of_work_sends")
      .select("id")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .limit(1);
    if (error) return { kind: "error", error: error.message };
    return sent && sent.length > 0
      ? { kind: "client", label: "Confirmed the Statement of Work", run: () => confirmSowAsClient(supabase, clientId) }
      : {
          kind: "issue",
          label: "Sent the Statement of Work",
          todo: "send the Statement of Work",
          run: async () => toStep(await sendDefaultStatementOfWork(clientId)),
        };
  }
  if (!text(client.service_order_content)) {
    return {
      kind: "issue",
      label: "Issued the Service Order (no invoice for a test pilot)",
      todo: "issue the Service Order",
      run: async () => {
        const generated = await generateServiceOrder(clientId);
        if (!generated.ok) return generated;
        return toStep(await sendServiceOrder(clientId, generated.content ?? "", ""));
      },
    };
  }
  if (!client.service_order_agreed_at) {
    return { kind: "client", label: "Signed the Service Order", run: () => signServiceOrderAsClient(supabase, client) };
  }
  if (!client.payment_received_at) {
    return { kind: "client", label: "Setup Fee marked as paid", run: () => markSetupFeePaid(supabase, clientId) };
  }
  if (!client.nda_sent_at) {
    return {
      kind: "issue",
      label: "Issued the NDA",
      todo: "issue the NDA",
      run: async () => {
        const generated = await generateNda(clientId);
        if (!generated.ok) return generated;
        return toStep(await sendNda(clientId, generated.content ?? ""));
      },
    };
  }
  if (!client.nda_signed_at) {
    return { kind: "client", label: "Signed the NDA", run: () => signNdaAsClient(supabase, client) };
  }
  if (!client.intake_completed_at) {
    return {
      kind: "client",
      claude: true,
      label: "Completed the intake (written by AI from the website and deck)",
      run: () => completeIntakeWithTestData(supabase, client),
    };
  }

  const rows = (await loadSetupSteps(supabase, [clientId])).get(clientId) ?? [];
  const row = (step: SetupStepState["step"]) => rows.find((item) => item.step === step) ?? null;

  if (row("materials")?.status !== "submitted") {
    return {
      kind: "client",
      claude: true,
      label: "Submitted the company materials (written by AI)",
      run: () => submitMaterialsWithTestData(supabase, client),
    };
  }
  const reviews: { step: ReviewStep; label: string; yours: string }[] = [
    {
      step: "deck_review",
      label: "Confirmed the Analysis & Feedback",
      yours: "run Analyze and push the feedback (Setup → Analysis & Feedback)",
    },
    { step: "framing", label: "Confirmed the outreach narrative", yours: "build and push the outreach narrative" },
    { step: "investor_list", label: "Confirmed the investor list", yours: "run Rupert Match and send the investor list" },
    { step: "email_copy", label: "Confirmed the email copy", yours: "write and push the email copy" },
  ];
  for (const review of reviews) {
    const status = row(review.step)?.status;
    // "published": feedback sent before the client confirmed it.
    if (status === "confirmed" || status === "published") continue;
    if (status === "with_client") {
      return {
        kind: "client",
        label: review.label,
        run: () => confirmReviewAsClient(supabase, clientId, review.step),
      };
    }
    return { kind: "stop", owner: "admin", label: `Your turn: ${review.yours}.` };
  }

  return {
    kind: "stop",
    owner: "done",
    label: "Setup is complete. For a real client, the next step is the first monthly invoice and launch.",
  };
}

async function runSteps(clientId: string, mode: "one" | "all"): Promise<TestRunResult> {
  const done: string[] = [];
  const access = await requireAdmin();
  if (!access.ok) return { ...access, done };
  const { supabase } = access;
  const started = Date.now();
  let claudeRan = false;

  try {
    for (let count = 0; count < MAX_STEPS; count += 1) {
      const loaded = await loadTestClient(supabase, clientId);
      if (!loaded.ok) return { ok: false, error: loaded.error, done };
      const step = await nextStep(supabase, loaded.client);

      if (step.kind === "error") return { ok: false, error: step.error, done };
      if (step.kind === "stop") return { ok: true, done, stop: step.label, owner: step.owner };
      if (mode === "one" && done.length > 0) {
        return { ok: true, done, stop: "Done. Click again for the next step.", owner: "paused" };
      }
      if (mode === "one" && step.kind === "issue") {
        return {
          ok: true,
          done,
          stop: `Your turn first: ${step.todo}. Or use Run full test, which does it for you.`,
          owner: "admin",
        };
      }
      if (step.claude) {
        if (!isClaudeConfigured()) {
          return { ok: false, error: "Claude is not configured (ANTHROPIC_API_KEY).", done };
        }
        if (claudeRan || Date.now() - started > CLAUDE_START_BUDGET_MS) {
          return {
            ok: true,
            done,
            stop: "Paused before the next AI step to stay within the time limit. Click Run full test again to continue.",
            owner: "paused",
          };
        }
        claudeRan = true;
      }

      const result = await step.run();
      if (!result.ok) {
        return {
          ok: false,
          error: isTestPilotColumnError(result.error) ? TEST_PILOT_MIGRATION_MISSING : result.error,
          done,
        };
      }
      done.push(step.label);
    }
    return { ok: true, done, stop: "Stopped after many steps. Click again to continue.", owner: "paused" };
  } finally {
    if (done.length > 0) revalidateClient(clientId);
  }
}

/** Completes the client's current step (signs, pays, confirms or fills in). */
export async function completeClientStep(clientId: string): Promise<TestRunResult> {
  return runSteps(clientId, "one");
}

/** Runs every step it can, stopping at Rupert's own work (analysis, narrative, match). */
export async function runFullTest(clientId: string): Promise<TestRunResult> {
  return runSteps(clientId, "all");
}

export async function saveTestWebsite(
  clientId: string,
  website: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const loaded = await loadTestClient(access.supabase, clientId);
  if (!loaded.ok) return loaded;
  const value = text(website);
  if (value && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(value)) {
    return { ok: false, error: "Enter a valid website, e.g. acme.com." };
  }
  const { error } = await access.supabase
    .from("clients")
    .update({ company_website: value || null })
    .eq("id", clientId);
  if (error) {
    return {
      ok: false,
      error: isTestPilotColumnError(error.message) ? TEST_PILOT_MIGRATION_MISSING : error.message,
    };
  }
  revalidatePath(`/admin/clients/${clientId}`);
  return { ok: true };
}

/** Step 1 of attaching the test deck: a signed upload URL. */
export async function createTestDeckUpload(
  clientId: string,
  file: { name: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const loaded = await loadTestClient(access.supabase, clientId);
  if (!loaded.ok) return loaded;
  return createTestDeckUploadUrl(access.supabase, clientId, file);
}

/** Step 2: records the uploaded deck on the client's materials. */
export async function registerTestDeck(
  clientId: string,
  file: { path: string; name: string; size: number; type: string },
): Promise<{ ok: true; file: MaterialFile } | { ok: false; error: string }> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const loaded = await loadTestClient(access.supabase, clientId);
  if (!loaded.ok) return loaded;
  const result = await attachMaterialFile(access.supabase, clientId, file);
  if (result.ok) revalidatePath(`/admin/clients/${clientId}`);
  return result;
}

/** Deletes a test pilot client with its login, data and files. */
export async function deleteTestClient(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await requireAdmin();
  if (!access.ok) return access;
  const loaded = await loadTestClient(access.supabase, clientId);
  if (!loaded.ok) return loaded;
  await removeClientFiles(access.supabase, clientId);
  const deleted = await deleteClient(clientId);
  if (!deleted.ok) return { ok: false, error: deleted.error };
  return { ok: true };
}
