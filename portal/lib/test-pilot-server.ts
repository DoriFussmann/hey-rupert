import "server-only";
import { randomUUID } from "crypto";
import type { createServiceClient } from "@/lib/supabase/admin";
import { callClaudeAgent, callClaudeTool, webFetchTool } from "@/lib/anthropic";
import { promptSystem } from "@/lib/prompts";
import { loadPrompt } from "@/lib/prompts-server";
import { prepareFiles, saveIntakeBrief } from "@/lib/agents-server";
import type { IntakeBrief, IntakeMessage, TopicStatus } from "@/lib/intake";
import { buildClientContext, loadIntakeSettings } from "@/lib/intake-server";
import { advanceStage, advanceToKickoff } from "@/lib/kickoff";
import { loadMaterialFields } from "@/lib/material-fields-server";
import { loadOrCreateMaterials, safeFileName } from "@/lib/materials-server";
import {
  PROFILE_PROPERTIES,
  cleanAnswers,
  loadProfileState,
  profileLabelsText,
  saveProfileState,
} from "@/lib/match/profile-server";
import { DEFAULT_SETTINGS, type MatchAnswers } from "@/lib/match/shared";
import { notifyAdmin } from "@/lib/notify";
import { mergeServiceOrder } from "@/lib/service-order";
import {
  MATERIALS_BUCKET,
  MATERIAL_MAX_BYTES,
  asMaterials,
  fileExtension,
  formatBytes,
  type MaterialsPayload,
  type SetupResponse,
} from "@/lib/setup";
import { loadSetupStep, nowIso, setupTableError } from "@/lib/setup-server";
import { testSigner } from "@/lib/test-pilot";

type ServiceClient = ReturnType<typeof createServiceClient>;

export type StepResult = { ok: true } | { ok: false; error: string };

/** Setup steps the "client" confirms in a test run. */
export type ReviewStep = "deck_review" | "framing" | "investor_list" | "email_copy";

const TEST_IP = "test-pilot";

function text(value: unknown) {
  return value != null ? String(value).trim() : "";
}

/** Loads the client and checks it is a test pilot. */
export async function loadTestClient(supabase: ServiceClient, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client not found." };
  const client = data as Record<string, unknown>;
  if (client.is_test_pilot !== true) {
    return { ok: false as const, error: "This is not a test pilot client." };
  }
  return { ok: true as const, client };
}

// ---------------------------------------------------------------------------
// Onboarding: what the client signs and pays

export async function confirmSowAsClient(
  supabase: ServiceClient,
  clientId: string,
): Promise<StepResult> {
  const { error } = await supabase
    .from("clients")
    .update({ sow_confirmed_at: nowIso() })
    .eq("id", clientId)
    .is("sow_confirmed_at", null);
  if (error) return { ok: false, error: error.message };
  await notifyAdmin(supabase, clientId, "sow_confirmed", { email: false });
  return { ok: true };
}

/** Signs the active Service Order or NDA with the test signer. */
async function signActive(
  supabase: ServiceClient,
  client: Record<string, unknown>,
  table: "service_order_sends" | "signed_documents",
  docType: "nda" | null,
): Promise<{ ok: true; signedAt: string } | { ok: false; error: string }> {
  let query = supabase
    .from(table)
    .select("id, content, signed_at")
    .eq("client_id", String(client.id))
    .is("archived_at", null);
  if (docType) query = query.eq("doc_type", docType);
  const { data: send, error } = await query.maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!send) return { ok: false, error: "The document has not been issued yet." };
  if (send.signed_at) return { ok: true, signedAt: String(send.signed_at) };

  const signer = testSigner(client);
  const signedAt = nowIso();
  const { error: signError } = await supabase
    .from(table)
    .update({
      signed_at: signedAt,
      signer_company: signer.company_name,
      signer_name: signer.signer_name,
      signer_email: signer.signer_email,
      signer_title: signer.signer_title,
      signed_content: mergeServiceOrder(String(send.content ?? ""), signer),
      signed_ip: TEST_IP,
      signed_user_agent: TEST_IP,
    })
    .eq("id", send.id)
    .is("signed_at", null);
  if (signError) return { ok: false, error: signError.message };
  return { ok: true, signedAt };
}

export async function signServiceOrderAsClient(
  supabase: ServiceClient,
  client: Record<string, unknown>,
): Promise<StepResult> {
  const signed = await signActive(supabase, client, "service_order_sends", null);
  if (!signed.ok) return signed;
  const clientId = String(client.id);
  const { error } = await supabase
    .from("clients")
    .update({ service_order_agreed_at: signed.signedAt })
    .eq("id", clientId);
  if (error) return { ok: false, error: error.message };
  await advanceToKickoff(supabase, clientId);
  await notifyAdmin(supabase, clientId, "service_order_agreed", { email: false });
  return { ok: true };
}

export async function markSetupFeePaid(
  supabase: ServiceClient,
  clientId: string,
): Promise<StepResult> {
  const { error } = await supabase
    .from("clients")
    .update({ payment_received_at: nowIso() })
    .eq("id", clientId)
    .is("payment_received_at", null);
  if (error) return { ok: false, error: error.message };
  await advanceToKickoff(supabase, clientId);
  await notifyAdmin(supabase, clientId, "setup_fee_paid", { email: false });
  return { ok: true };
}

export async function signNdaAsClient(
  supabase: ServiceClient,
  client: Record<string, unknown>,
): Promise<StepResult> {
  const signed = await signActive(supabase, client, "signed_documents", "nda");
  if (!signed.ok) return signed;
  const clientId = String(client.id);
  const { error } = await supabase
    .from("clients")
    .update({ nda_signed_at: signed.signedAt })
    .eq("id", clientId);
  if (error) return { ok: false, error: error.message };
  await advanceStage(supabase, clientId, ["nda"], "intake");
  await notifyAdmin(supabase, clientId, "nda_signed", { email: false });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Intake, written by Claude from the website and the test deck

const INTAKE_TOOL = {
  name: "submit_test_intake",
  description: "Deliver the test intake: the per-topic answers and the company profile.",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "array",
        description: "One answer per intake topic.",
        items: {
          type: "object",
          properties: {
            topic_id: { type: "string" },
            answer: { type: "string" },
          },
          required: ["topic_id", "answer"],
        },
      },
      profile: {
        type: "object",
        description: "The company profile for investor matching. Use the exact allowed labels.",
        properties: PROFILE_PROPERTIES,
      },
    },
    required: ["summary", "profile"],
  },
};

function websiteUrl(value: string) {
  if (!value) return "";
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** PDFs and other readable files already attached to the materials draft. */
async function materialsFiles(supabase: ServiceClient, clientId: string) {
  const loaded = await loadSetupStep(supabase, clientId, "materials");
  if (!loaded.ok || !loaded.row) return [];
  return asMaterials(loaded.row.draft).files;
}

export async function completeIntakeWithTestData(
  supabase: ServiceClient,
  client: Record<string, unknown>,
): Promise<StepResult> {
  const clientId = String(client.id);
  const settings = await loadIntakeSettings(supabase);
  const prompt = await loadPrompt(supabase, "test_pilot_intake", { clientId, purpose: "Test Pilot: intake answers" });
  if (!prompt.ok) return { ok: false, error: prompt.error };
  const website = websiteUrl(text(client.company_website));
  const files = await prepareFiles(supabase, await materialsFiles(supabase, clientId));

  const topics = settings.topics
    .map((topic) => `- [${topic.id}] ${topic.title}: ${topic.guidance}`)
    .join("\n");
  const result = await callClaudeAgent<{ summary?: unknown; profile?: unknown }>({
    system: promptSystem(prompt.value, profileLabelsText()),
    content: [
      ...files.blocks,
      {
        type: "text",
        text: [
          "## What Rupert knows",
          buildClientContext(client),
          website ? `Company website: ${website}` : "No website was given.",
          "## Intake topics",
          topics,
          `Deliver the result by calling the ${INTAKE_TOOL.name} tool.`,
        ].join("\n\n"),
      },
    ],
    tool: INTAKE_TOOL,
    serverTools: website ? [webFetchTool(3)] : [],
    maxTokens: 8000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const raw = Array.isArray(result.input.summary) ? result.input.summary : [];
  const byTopic = new Map<string, string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    byTopic.set(text(entry.topic_id), text(entry.answer));
  }
  const summary = settings.topics.map((topic) => ({
    topic_id: topic.id,
    title: topic.title,
    answer: byTopic.get(topic.id) || "Not provided.",
  }));
  const answers: MatchAnswers = {
    ...cleanAnswers(result.input.profile),
    company_name: text(client.company_name),
  };
  if (website && !answers.website) answers.website = website;

  const at = nowIso();
  const topicStatus: Record<string, TopicStatus> = Object.fromEntries(
    summary.map((item) => [
      item.topic_id,
      { status: "covered" as const, note: item.answer.slice(0, 500) },
    ]),
  );
  const messages: IntakeMessage[] = [
    {
      role: "assistant",
      content: `Test pilot: this intake was filled in automatically from ${
        website || "the company details"
      }${files.read.length > 0 ? ` and ${files.read.join(", ")}` : ""}.`,
      at,
    },
  ];

  const { error: interviewError } = await supabase.from("intake_interviews").upsert(
    {
      client_id: clientId,
      messages,
      topic_status: topicStatus,
      summary,
      status: "completed",
      client_message_count: 0,
      completed_at: at,
      updated_at: at,
    },
    { onConflict: "client_id" },
  );
  if (interviewError) return { ok: false, error: interviewError.message };

  const { error: clientError } = await supabase
    .from("clients")
    .update({ intake_completed_at: at })
    .eq("id", clientId)
    .is("intake_completed_at", null);
  if (clientError) return { ok: false, error: clientError.message };

  const list = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value.join(", ") : text(value);
  const brief: IntakeBrief = {
    summary: summary.map((item) => `**${item.title}.** ${item.answer}`).join("\n\n"),
    industry: list(answers.core_vertical) || list(answers.core_industry),
    geography: [list(answers.hq_city), list(answers.hq_country)].filter(Boolean).join(", "),
    stage: list(answers.stage),
    raise_amount: list(answers.raise_amount),
    generated_at: at,
    based_on: at,
    edited_at: null,
  };
  const briefSaved = await saveIntakeBrief(supabase, clientId, brief);
  if (!briefSaved.ok) return briefSaved;

  const current = await loadProfileState(supabase, clientId);
  const profileSaved = await saveProfileState(supabase, clientId, {
    answers,
    settings: current.ok && current.value ? current.value.settings : DEFAULT_SETTINGS,
    source: "intake",
    sourceInterviewAt: at,
  });
  if (!profileSaved.ok) return profileSaved;

  await notifyAdmin(supabase, clientId, "intake_completed", { email: false });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Company materials

/** A one-time signed URL for the test deck, uploaded straight from the browser. */
export async function createTestDeckUploadUrl(
  supabase: ServiceClient,
  clientId: string,
  file: { name: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const name = text(file?.name);
  const size = Number(file?.size) || 0;
  if (fileExtension(name) !== "pdf") return { ok: false, error: "Upload the deck as a PDF." };
  if (size <= 0) return { ok: false, error: `${name} is empty.` };
  if (size > MATERIAL_MAX_BYTES) {
    return { ok: false, error: `${name} is over ${formatBytes(MATERIAL_MAX_BYTES)}.` };
  }
  const path = `${clientId}/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  }
  return { ok: true, path: data.path, token: data.token };
}

export async function submitMaterialsWithTestData(
  supabase: ServiceClient,
  client: Record<string, unknown>,
): Promise<StepResult> {
  const clientId = String(client.id);
  const loaded = await loadOrCreateMaterials(supabase, clientId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (row.status === "submitted") return { ok: true };

  const [fields, interviewRow] = await Promise.all([
    loadMaterialFields(supabase),
    supabase
      .from("intake_interviews")
      .select("summary")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);
  const intake = Array.isArray(interviewRow.data?.summary)
    ? (interviewRow.data.summary as { title?: unknown; answer?: unknown }[])
        .map((item) => `${text(item.title)}: ${text(item.answer)}`)
        .join("\n")
    : "";
  const prompt = await loadPrompt(supabase, "test_pilot_materials", { clientId, purpose: "Test Pilot: materials form" });
  if (!prompt.ok) return { ok: false, error: prompt.error };

  const result = await callClaudeTool<Record<string, unknown>>({
    system: promptSystem(prompt.value),
    messages: [
      {
        role: "user",
        content: [
          "## What Rupert knows",
          buildClientContext(client),
          intake ? `## The founder's intake\n${intake}` : "",
          "## Form fields",
          fields.map((field) => `- ${field.id} (${field.label}): ${field.help}`).join("\n"),
          "Fill every field by calling the submit_materials tool.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    tool: {
      name: "submit_materials",
      description: "Deliver the answers to the Company Materials form.",
      input_schema: {
        type: "object",
        properties: Object.fromEntries(
          fields.map((field) => [field.id, { type: "string", description: field.label }]),
        ),
      },
    },
    maxTokens: 3000,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  const website = websiteUrl(text(client.company_website));
  const answers: Record<string, string> = {};
  for (const field of fields) {
    const value = text(result.input[field.id]).slice(0, 20000);
    answers[field.id] = field.type === "url" && !/^https?:\/\//i.test(value) ? website : value;
  }

  const draft = asMaterials(row.draft);
  const payload: MaterialsPayload = { files: draft.files, fields: { ...draft.fields, ...answers } };
  const at = nowIso();
  const version = row.version + 1;
  const { data, error } = await supabase
    .from("setup_steps")
    .update({
      status: "submitted",
      draft: payload,
      published: payload,
      version,
      published_at: at,
      history: [...row.history, { version, published_at: at, response: null }],
      turn_since: at,
      completed_at: at,
      updated_at: at,
    })
    .eq("client_id", clientId)
    .eq("step", "materials")
    .eq("version", row.version)
    .neq("status", "submitted")
    .select("client_id");
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  if (!data || data.length === 0) return { ok: true };

  await advanceStage(supabase, clientId, ["nda", "intake"], "setup");
  await notifyAdmin(supabase, clientId, "materials_submitted", { email: false });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reviews: the client confirms

export async function confirmReviewAsClient(
  supabase: ServiceClient,
  clientId: string,
  step: ReviewStep,
): Promise<StepResult> {
  const loaded = await loadSetupStep(supabase, clientId, step);
  if (!loaded.ok) return loaded;
  const row = loaded.row;
  if (!row || row.status !== "with_client") {
    return { ok: false, error: "Nothing is waiting for the client here." };
  }
  const at = nowIso();
  const response: SetupResponse = {
    decision: "confirmed",
    note: "",
    item_notes: {},
    item_labels: {},
    version: row.version,
    at,
  };
  const { error } = await supabase
    .from("setup_steps")
    .update({
      status: "confirmed",
      response,
      history: row.history.map((entry) =>
        entry.version === row.version ? { ...entry, response } : entry,
      ),
      turn_since: at,
      completed_at: at,
      updated_at: at,
    })
    .eq("client_id", clientId)
    .eq("step", step)
    .eq("status", "with_client")
    .eq("version", row.version);
  if (error) return { ok: false, error: setupTableError(error.message, error.code) };
  await notifyAdmin(supabase, clientId, `${step}_confirmed`, { email: false });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deleting a test client's files

/** Every file under the client's folder in materials storage (two levels down). */
async function listClientFiles(supabase: ServiceClient, clientId: string) {
  const bucket = supabase.storage.from(MATERIALS_BUCKET);
  const paths: string[] = [];
  const walk = async (folder: string, depth: number) => {
    const { data } = await bucket.list(folder, { limit: 1000 });
    for (const entry of data ?? []) {
      const path = `${folder}/${entry.name}`;
      // Folders come back without an id.
      if (entry.id) paths.push(path);
      else if (depth < 3) await walk(path, depth + 1);
    }
  };
  await walk(clientId, 1);
  return paths;
}

/** Removes the client's stored files. Best effort: storage errors are logged. */
export async function removeClientFiles(supabase: ServiceClient, clientId: string) {
  const paths = await listClientFiles(supabase, clientId);
  for (let index = 0; index < paths.length; index += 100) {
    const { error } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .remove(paths.slice(index, index + 100));
    if (error) console.error(`Test client files not removed: ${error.message}`);
  }
}
