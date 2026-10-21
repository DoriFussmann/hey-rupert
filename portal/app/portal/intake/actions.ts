"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  INTAKE_LIMITS,
  intakeProgress,
  mergeTopicStatus,
  type IntakeInterview,
  type IntakeMessage,
} from "@/lib/intake";
import {
  asIntakeInterview,
  loadIntakeSettings,
  loadInterview,
  nextInterviewTurn,
  writeInterviewSummary,
  type SharedDocument,
} from "@/lib/intake-server";
import { loadInterviewGuide } from "@/lib/company-profile/server";
import { attachMaterialFile, safeFileName } from "@/lib/materials-server";
import { MATERIALS_BUCKET, fileExtension, formatBytes } from "@/lib/setup";
import { notifyAdmin } from "@/lib/notify";
import { requirePortalService, type PortalAccess } from "@/lib/portal-access";

export type IntakeActionResult =
  | { ok: true; interview: IntakeInterview }
  | { ok: false; error: string; aiUnavailable?: boolean };

const AI_UNAVAILABLE =
  "Rupert is unavailable right now. Please try again in a few minutes, or use Book a call.";

const TABLE_MISSING =
  "The intake interview is not set up yet. Please use Book a call and we will sort it out.";

function now() {
  return new Date().toISOString();
}

function revalidateIntake(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/portal/intake");
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${clientId}`);
}

/** Loads the client's row and checks the interview is open to them. */
async function loadOpenClient({ user, supabase }: PortalAccess) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "Client record not found." };

  const client = data as Record<string, unknown>;
  if (!client.nda_signed_at) {
    return {
      ok: false as const,
      error: "The intake opens once your NDA is signed.",
    };
  }
  return { ok: true as const, client };
}

const CONFIRMED_ERROR = "Your intake is complete and confirmed.";

function topicNotes(
  topics: { id: string; title: string }[],
  topicStatus: IntakeInterview["topic_status"],
) {
  const lines = topics
    .map((topic) => {
      const note = topicStatus[topic.id]?.note?.trim();
      return note ? `- ${topic.title}: ${note}` : null;
    })
    .filter(Boolean);
  return lines.length > 0
    ? `What Rupert gathered:\n${lines.join("\n")}`
    : undefined;
}

/**
 * Completes the intake the first time every required topic is covered:
 * marks it done and emails the admin. The stage stays on intake until the
 * client submits Company Materials. The client can keep chatting to add the
 * optional extras.
 */
async function completeIfEssentialsCovered(
  { supabase, user }: PortalAccess,
  client: Record<string, unknown>,
  topics: Parameters<typeof intakeProgress>[0],
  topicStatus: IntakeInterview["topic_status"],
) {
  if (client.intake_completed_at) return;
  if (!intakeProgress(topics, topicStatus).ready) return;

  const { data, error } = await supabase
    .from("clients")
    .update({ intake_completed_at: now() })
    .eq("id", user.id)
    .is("intake_completed_at", null)
    .select("id");

  if (error || !data || data.length === 0) return;

  await notifyAdmin(supabase, user.id, "intake_completed", {
    email: true,
    details: topicNotes(topics, topicStatus),
  });
  revalidateIntake(user.id);
}

/** Creates the interview with Rupert's opening message, if not started yet. */
export async function startIntake(): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const { supabase, user } = access;
  const existing = await loadInterview(supabase, user.id);
  if (!existing.ok) return { ok: false, error: TABLE_MISSING };
  if (existing.interview && existing.interview.messages.length > 0) {
    return { ok: true, interview: existing.interview };
  }
  if (opened.client.intake_completed_at) {
    return { ok: false, error: "Your intake is already complete." };
  }

  const settings = await loadIntakeSettings(supabase);
  // A new interview uses the classification guide (the column defaults to it).
  const guide = await loadInterviewGuide(supabase);
  const turn = await nextInterviewTurn(settings, opened.client, [], {}, undefined, guide);
  if (!turn.ok) return { ok: false, error: AI_UNAVAILABLE, aiUnavailable: true };

  const messages: IntakeMessage[] = [
    { role: "assistant", content: turn.turn.reply, at: now() },
  ];
  const topicStatus = mergeTopicStatus({}, turn.turn.topics, settings.topics);

  const { data, error } = await supabase
    .from("intake_interviews")
    .upsert(
      {
        client_id: user.id,
        messages,
        topic_status: topicStatus,
        status: "in_progress",
        updated_at: now(),
      },
      { onConflict: "client_id" },
    )
    .select("*")
    .single();

  if (error || !data) return { ok: false, error: TABLE_MISSING };
  await completeIfEssentialsCovered(
    access,
    opened.client,
    settings.topics,
    topicStatus,
  );
  return { ok: true, interview: asIntakeInterview(data) };
}

/** The interview, if the client can add to it right now. */
async function loadOpenInterview(access: PortalAccess) {
  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const loaded = await loadInterview(access.supabase, access.user.id);
  if (!loaded.ok) return { ok: false as const, error: TABLE_MISSING };
  const interview = loaded.interview;
  if (!interview) return { ok: false as const, error: "The interview has not started yet." };
  if (interview.status === "completed") {
    return { ok: false as const, error: CONFIRMED_ERROR };
  }
  if (interview.status !== "in_progress") {
    return { ok: false as const, error: "Go back to the conversation to add more." };
  }
  if (interview.client_message_count >= INTAKE_LIMITS.clientMessagesMax) {
    return {
      ok: false as const,
      error:
        "We've reached the message limit for this interview. Review the summary, or use Book a call to finish with Dori.",
    };
  }
  return { ok: true as const, client: opened.client, interview };
}

/** Adds the client's message, gets Rupert's reply and saves both. */
async function takeTurn(
  access: PortalAccess,
  client: Record<string, unknown>,
  interview: IntakeInterview,
  message: IntakeMessage,
  document?: SharedDocument,
): Promise<IntakeActionResult> {
  const { supabase, user } = access;
  const settings = await loadIntakeSettings(supabase);
  const withUser: IntakeMessage[] = [...interview.messages, message];

  const turn = await nextInterviewTurn(
    settings,
    client,
    withUser,
    interview.topic_status,
    document,
    interview.classification_guide ? await loadInterviewGuide(supabase) : null,
  );
  if (!turn.ok) return { ok: false, error: AI_UNAVAILABLE, aiUnavailable: true };

  // What Rupert took from a shared file stays with the message, so later
  // turns (and the summary) still know what it said.
  const saved: IntakeMessage[] = message.attachment
    ? [
        ...interview.messages,
        { ...message, attachment: { ...message.attachment, facts: turn.turn.documentFacts } },
      ]
    : withUser;
  const messages: IntakeMessage[] = [
    ...saved,
    { role: "assistant", content: turn.turn.reply, at: now() },
  ];
  const topicStatus = mergeTopicStatus(
    interview.topic_status,
    turn.turn.topics,
    settings.topics,
  );

  // Guard against a second tab writing at the same time: only update if the
  // message count is still the one this turn was based on.
  const { data, error } = await supabase
    .from("intake_interviews")
    .update({
      messages,
      topic_status: topicStatus,
      client_message_count: interview.client_message_count + 1,
      updated_at: now(),
    })
    .eq("client_id", user.id)
    .eq("client_message_count", interview.client_message_count)
    .select("*");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "The conversation changed in another window. Refresh to continue.",
    };
  }

  await completeIfEssentialsCovered(access, client, settings.topics, topicStatus);

  revalidatePath(`/admin/clients/${user.id}`);
  return { ok: true, interview: asIntakeInterview(data[0]) };
}

export async function sendIntakeMessage(
  text: string,
): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const content = String(text ?? "").trim();
  if (!content) return { ok: false, error: "Write a message first." };
  if (content.length > INTAKE_LIMITS.messageMaxChars) {
    return {
      ok: false,
      error: `Please keep messages under ${INTAKE_LIMITS.messageMaxChars} characters.`,
    };
  }

  const open = await loadOpenInterview(access);
  if (!open.ok) return open;

  return takeTurn(access, open.client, open.interview, {
    role: "user",
    content,
    at: now(),
  });
}

/**
 * Step 1 of sharing a PDF in the chat: checks it and returns a one-time
 * signed URL the browser uploads to directly.
 */
export async function createIntakeUpload(file: {
  name: string;
  size: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const access = await requirePortalService();
  if (!access.ok) return access;
  const open = await loadOpenInterview(access);
  if (!open.ok) return open;

  const name = String(file?.name ?? "").trim();
  const size = Number(file?.size) || 0;
  if (fileExtension(name) !== "pdf") {
    return { ok: false, error: "Share a PDF here. Other files can be added in Setup." };
  }
  if (size <= 0) return { ok: false, error: `${name} is empty.` };
  if (size > INTAKE_LIMITS.fileMaxBytes) {
    return {
      ok: false,
      error: `${name} is ${formatBytes(size)}. PDFs up to ${formatBytes(INTAKE_LIMITS.fileMaxBytes)} can be shared here; add larger files in Setup.`,
    };
  }

  const path = `${access.user.id}/${randomUUID()}/${safeFileName(name)}`;
  const { data, error } = await access.supabase.storage
    .from(MATERIALS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return { ok: false, error: `Upload could not start: ${error?.message ?? "unknown error"}.` };
  }
  return { ok: true, path: data.path, token: data.token };
}

/**
 * Step 2: Rupert reads the uploaded PDF in this turn. The file is also added
 * to the client's company materials, so they do not upload it again in Setup.
 */
export async function sendIntakeFile(input: {
  path: string;
  name: string;
  size: number;
  type: string;
  note: string;
}): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const path = String(input?.path ?? "");
  if (!path.startsWith(`${access.user.id}/`) || path.includes("..")) {
    return { ok: false, error: "That upload does not belong to you." };
  }
  const note = String(input?.note ?? "").trim().slice(0, INTAKE_LIMITS.messageMaxChars);
  const name = String(input?.name ?? "file").slice(0, 255);

  const open = await loadOpenInterview(access);
  if (!open.ok) return open;

  const { data: blob, error: downloadError } = await access.supabase.storage
    .from(MATERIALS_BUCKET)
    .download(path);
  if (downloadError || !blob) {
    return { ok: false, error: "The file could not be read. Please try uploading it again." };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length > INTAKE_LIMITS.fileMaxBytes) {
    return { ok: false, error: "That file is too large to read here. Add it in Setup instead." };
  }

  const result = await takeTurn(
    access,
    open.client,
    open.interview,
    {
      role: "user",
      content: note,
      at: now(),
      attachment: { name, path, facts: "" },
    },
    { name, base64: bytes.toString("base64") },
  );

  // Best effort: the chat goes on even if the file cannot be added to Setup.
  if (result.ok) {
    const attached = await attachMaterialFile(access.supabase, access.user.id, {
      path,
      name,
      size: Number(input?.size) || bytes.length,
      type: String(input?.type ?? "application/pdf"),
    });
    if (!attached.ok) console.error(`Intake file not added to materials: ${attached.error}`);
  }
  return result;
}

/** Writes the per-topic summary once every required topic is covered. */
export async function requestIntakeSummary(): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const { supabase, user } = access;
  const loaded = await loadInterview(supabase, user.id);
  if (!loaded.ok) return { ok: false, error: TABLE_MISSING };
  const interview = loaded.interview;
  if (!interview) return { ok: false, error: "The interview has not started yet." };
  if (interview.status === "completed") {
    return { ok: false, error: CONFIRMED_ERROR };
  }
  if (interview.status === "review" && interview.summary) {
    return { ok: true, interview };
  }

  const settings = await loadIntakeSettings(supabase);
  if (!intakeProgress(settings.topics, interview.topic_status).ready) {
    return {
      ok: false,
      error: "A few required topics are still open. Keep chatting with Rupert.",
    };
  }

  const summary = await writeInterviewSummary(
    settings,
    opened.client,
    interview.messages,
    interview.topic_status,
  );
  if (!summary.ok) {
    return { ok: false, error: AI_UNAVAILABLE, aiUnavailable: true };
  }

  const { data, error } = await supabase
    .from("intake_interviews")
    .update({ summary: summary.items, status: "review", updated_at: now() })
    .eq("client_id", user.id)
    .select("*")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? TABLE_MISSING };
  return { ok: true, interview: asIntakeInterview(data) };
}

/** Leaves the summary and goes back to the conversation. */
export async function resumeIntakeConversation(): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const { data, error } = await access.supabase
    .from("intake_interviews")
    .update({ status: "in_progress", summary: null, updated_at: now() })
    .eq("client_id", access.user.id)
    .eq("status", "review")
    .select("*");

  if (error) return { ok: false, error: error.message };
  if (data && data.length > 0) {
    return { ok: true, interview: asIntakeInterview(data[0]) };
  }

  const loaded = await loadInterview(access.supabase, access.user.id);
  if (!loaded.ok || !loaded.interview) return { ok: false, error: TABLE_MISSING };
  return { ok: true, interview: loaded.interview };
}

/** Saves the client's edited summary and completes the intake. */
export async function confirmIntake(
  answers: { topic_id: string; answer: string }[],
): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const { supabase, user } = access;
  const loaded = await loadInterview(supabase, user.id);
  if (!loaded.ok) return { ok: false, error: TABLE_MISSING };
  const interview = loaded.interview;
  if (!interview || interview.status !== "review" || !interview.summary) {
    return { ok: false, error: "Review the summary before confirming." };
  }

  const edited = new Map(
    (Array.isArray(answers) ? answers : []).map((item) => [
      String(item?.topic_id ?? ""),
      String(item?.answer ?? "").trim().slice(0, INTAKE_LIMITS.messageMaxChars),
    ]),
  );
  const summary = interview.summary.map((item) => ({
    ...item,
    answer: edited.get(item.topic_id) || item.answer,
  }));

  const completedAt = now();
  const { error } = await supabase
    .from("intake_interviews")
    .update({
      summary,
      status: "completed",
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq("client_id", user.id)
    .eq("status", "review");

  if (error) return { ok: false, error: error.message };

  // Normally the intake was already completed when the essentials were
  // covered; confirming the summary then only records the client's edits.
  if (!opened.client.intake_completed_at) {
    const { error: clientError } = await supabase
      .from("clients")
      .update({ intake_completed_at: completedAt })
      .eq("id", user.id);

    if (clientError) return { ok: false, error: clientError.message };

    await notifyAdmin(supabase, user.id, "intake_completed", { email: true });
  }

  revalidateIntake(user.id);
  return {
    ok: true,
    interview: {
      ...interview,
      summary,
      status: "completed",
      completed_at: completedAt,
      updated_at: completedAt,
    },
  };
}
