"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  INTAKE_LIMITS,
  conflictLine,
  intakeFileProblem,
  intakeProgress,
  intakeReady,
  mergeConflicts,
  mergeTopicStatus,
  type IntakeConflict,
  type IntakeInterview,
  type IntakeMessage,
  type IntakeTopic,
} from "@/lib/intake";
import {
  asIntakeInterview,
  loadIntakeSettings,
  loadInterview,
  nextInterviewTurn,
  writeInterviewSummary,
  type InterviewMaterials,
} from "@/lib/intake-server";
import { loadInterviewGuide } from "@/lib/company-profile/server";
import { prepareFiles, type PreparedFiles } from "@/lib/material-files-server";
import {
  attachMaterialFile,
  completeIntakeWithMaterials,
  loadMaterialsView,
  safeFileName,
  saveNoDeckNote,
} from "@/lib/materials-server";
import {
  MATERIALS_BUCKET,
  MATERIAL_MAX_FILES,
  NO_DECK_MAX,
  formatBytes,
  type MaterialFile,
  type MaterialsView,
} from "@/lib/setup";
import { notifyAdmin, notifyAdminOnce } from "@/lib/notify";
import { requirePortalService, type PortalAccess } from "@/lib/portal-access";

export type IntakeActionResult =
  | { ok: true; interview: IntakeInterview; materials: MaterialsView }
  | { ok: false; error: string; aiUnavailable?: boolean };

const AI_UNAVAILABLE =
  "Rupert is unavailable right now. Please try again in a few minutes, or use Book a call.";

const FILES_NOT_READ =
  "Your files are saved, but Rupert couldn't read them just now. Please try again in a minute.";

const TABLE_MISSING =
  "The intake interview is not set up yet. Please use Book a call and we will sort it out.";

const MATERIALS_NEEDED =
  "Share your deck in the panel, or tell Rupert you don't have one yet.";

const EMPTY_MATERIALS: MaterialsView = { files: [], noDeck: "", submitted: false };

function now() {
  return new Date().toISOString();
}

function revalidateIntake(clientId: string) {
  revalidatePath("/portal", "layout");
  revalidatePath("/portal/onboarding");
  revalidatePath("/portal/intake");
  revalidatePath("/portal/materials");
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

/** The client's materials now. Unreadable materials count as none shared yet. */
async function currentMaterials({ supabase, user }: PortalAccess) {
  const loaded = await loadMaterialsView(supabase, user.id);
  return loaded.ok ? loaded.view : EMPTY_MATERIALS;
}

function interviewMaterials(view: MaterialsView): InterviewMaterials {
  return { files: view.files.map((file) => file.name), noDeck: view.noDeck };
}

function readiness(view: MaterialsView) {
  return { fileCount: view.files.length, noDeck: view.noDeck };
}

async function success(
  access: PortalAccess,
  interview: IntakeInterview,
): Promise<IntakeActionResult> {
  return { ok: true, interview, materials: await currentMaterials(access) };
}

/** What Rupert gathered, the materials and any disagreements, for the admin email. */
function completionDetails(
  topics: IntakeTopic[],
  topicStatus: IntakeInterview["topic_status"],
  view: MaterialsView,
  conflicts: IntakeConflict[],
) {
  const notes = topics
    .map((topic) => {
      const note = topicStatus[topic.id]?.note?.trim();
      return note ? `- ${topic.title}: ${note}` : null;
    })
    .filter(Boolean);
  return [
    notes.length > 0 ? `What Rupert gathered:\n${notes.join("\n")}` : "",
    view.files.length > 0
      ? `Files:\n${view.files.map((file) => `- ${file.name} (${formatBytes(file.size)})`).join("\n")}`
      : "No files shared.",
    view.noDeck ? `No deck yet: ${view.noDeck}` : "",
    conflicts.length > 0
      ? `Where the files and the founder's answers disagreed:\n${conflicts.map((conflict) => `- ${conflictLine(conflict)}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Completes the intake the first time every required topic is covered and
 * the materials are shared (or the founder has no deck yet): the materials
 * are submitted with it, Setup opens and the admin is emailed. The client
 * can keep chatting to add the optional extras.
 */
async function completeIfReady(
  access: PortalAccess,
  client: Record<string, unknown>,
  topics: IntakeTopic[],
  topicStatus: IntakeInterview["topic_status"],
  conflicts: IntakeConflict[],
) {
  if (client.intake_completed_at) return;
  const view = await currentMaterials(access);
  if (!intakeReady(topics, topicStatus, readiness(view))) return;

  const { supabase, user } = access;
  const completed = await completeIntakeWithMaterials(supabase, user.id, now());
  if (!completed.ok) {
    console.error(`Intake completion failed: ${completed.error}`);
    return;
  }
  if (!completed.completed) return;

  await notifyAdmin(supabase, user.id, "intake_completed", {
    email: true,
    details: completionDetails(topics, topicStatus, view, conflicts),
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
    return success(access, existing.interview);
  }
  if (opened.client.intake_completed_at) {
    return { ok: false, error: "Your intake is already complete." };
  }

  const settings = await loadIntakeSettings(supabase);
  // A new interview uses the classification guide (the column defaults to it).
  const guide = await loadInterviewGuide(supabase);
  const view = await currentMaterials(access);
  const turn = await nextInterviewTurn(supabase, settings, opened.client, [], {}, {
    materials: interviewMaterials(view),
    conflicts: [],
    guide,
  });
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
  await completeIfReady(access, opened.client, settings.topics, topicStatus, []);
  return success(access, asIntakeInterview(data));
}

/** The interview, if the client can add to it right now. */
async function loadOpenInterview(access: PortalAccess) {
  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const loaded = await loadInterview(access.supabase, access.user.id);
  if (!loaded.ok) return { ok: false as const, error: TABLE_MISSING };
  const interview = loaded.interview;
  if (!interview) return { ok: false as const, error: "The interview has not started yet." };
  // A confirmed intake stays open: the founder can come back to add more.
  if (interview.status === "review") {
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
  files?: PreparedFiles,
): Promise<IntakeActionResult> {
  const { supabase, user } = access;
  const settings = await loadIntakeSettings(supabase);
  const view = await currentMaterials(access);
  const withUser: IntakeMessage[] = [...interview.messages, message];
  // The intake was already complete before this message: the founder is adding more.
  const followUp = Boolean(client.intake_completed_at) || interview.status === "completed";

  const turn = await nextInterviewTurn(
    supabase,
    settings,
    client,
    withUser,
    interview.topic_status,
    {
      materials: interviewMaterials(view),
      conflicts: interview.conflicts,
      files,
      guide: interview.classification_guide ? await loadInterviewGuide(supabase) : null,
      followUp,
    },
  );
  if (!turn.ok) return { ok: false, error: AI_UNAVAILABLE, aiUnavailable: true };

  // What Rupert took from each shared file stays with the message, so later
  // turns (and the summary) still know what it said.
  const saved: IntakeMessage = message.attachments
    ? {
        ...message,
        attachments: message.attachments.map((file) => ({
          ...file,
          facts: turn.turn.fileFacts.get(file.name) ?? "",
        })),
      }
    : message;
  const at = now();
  const messages: IntakeMessage[] = [
    ...interview.messages,
    saved,
    { role: "assistant", content: turn.turn.reply, at },
  ];
  const topicStatus = mergeTopicStatus(
    interview.topic_status,
    turn.turn.topics,
    settings.topics,
  );
  const conflicts = mergeConflicts(interview.conflicts, turn.turn.conflicts, at);

  // Guard against a second tab writing at the same time: only update if the
  // message count is still the one this turn was based on.
  const { data, error } = await supabase
    .from("intake_interviews")
    .update({
      messages,
      topic_status: topicStatus,
      material_conflicts: conflicts,
      client_message_count: interview.client_message_count + 1,
      updated_at: at,
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

  await completeIfReady(access, client, settings.topics, topicStatus, conflicts);
  // Files added after the intake already notify as materials_added.
  if (followUp && !message.attachments?.length) {
    await notifyAdminOnce(supabase, user.id, "intake_updated");
  }

  revalidatePath(`/admin/clients/${user.id}`);
  return success(access, asIntakeInterview(data[0]));
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
 * Step 1 of sharing a file in the intake: checks it and returns a one-time
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
  const problem = intakeFileProblem({ name, size });
  if (problem) return { ok: false, error: problem };
  const view = await currentMaterials(access);
  if (view.files.length >= MATERIAL_MAX_FILES) {
    return { ok: false, error: `Up to ${MATERIAL_MAX_FILES} files can be shared.` };
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

type UploadedFile = { path: string; name: string; size: number; type: string };

/**
 * Step 2: the uploaded files join the client's company materials, then
 * Rupert reads them all in one turn. Safe to retry: a file already added is
 * not added twice.
 */
export async function sendIntakeFiles(input: {
  files: UploadedFile[];
  note: string;
}): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const uploads = Array.isArray(input?.files) ? input.files.slice(0, MATERIAL_MAX_FILES) : [];
  if (uploads.length === 0) return { ok: false, error: "Choose a file first." };
  for (const upload of uploads) {
    const path = String(upload?.path ?? "");
    if (!path.startsWith(`${access.user.id}/`) || path.includes("..")) {
      return { ok: false, error: "That upload does not belong to you." };
    }
    const problem = intakeFileProblem({
      name: String(upload?.name ?? ""),
      size: Number(upload?.size) || 0,
    });
    if (problem) return { ok: false, error: problem };
  }
  const note = String(input?.note ?? "").trim().slice(0, INTAKE_LIMITS.messageMaxChars);

  const open = await loadOpenInterview(access);
  if (!open.ok) return open;

  const attached: MaterialFile[] = [];
  let late = false;
  for (const upload of uploads) {
    const result = await attachMaterialFile(access.supabase, access.user.id, {
      path: String(upload.path),
      name: String(upload.name ?? "file"),
      size: Number(upload.size) || 0,
      type: String(upload.type ?? ""),
    });
    if (!result.ok) return { ok: false, error: result.error };
    attached.push(result.file);
    late = late || result.late;
  }
  if (late) {
    await notifyAdmin(access.supabase, access.user.id, "materials_added", { email: false });
  }
  revalidateIntake(access.user.id);

  const prepared = await prepareFiles(access.supabase, attached);
  const result = await takeTurn(
    access,
    open.client,
    open.interview,
    {
      role: "user",
      content: note,
      at: now(),
      attachments: attached.map((file) => ({ name: file.name, path: file.path, facts: "" })),
    },
    prepared,
  );
  if (!result.ok && result.aiUnavailable) {
    return { ok: false, error: FILES_NOT_READ, aiUnavailable: true };
  }
  return result;
}

/** The founder has no deck yet: records why, and tells Rupert in the chat. */
export async function declareNoDeck(reason: string): Promise<IntakeActionResult> {
  const access = await requirePortalService();
  if (!access.ok) return access;

  const note = String(reason ?? "").trim();
  if (!note) return { ok: false, error: "Add a short reason first." };
  if (note.length > NO_DECK_MAX) {
    return { ok: false, error: `Please keep it under ${NO_DECK_MAX} characters.` };
  }

  const open = await loadOpenInterview(access);
  if (!open.ok) return open;
  const view = await currentMaterials(access);
  if (view.files.length > 0) {
    return { ok: false, error: "You've already shared files, so there's no need." };
  }

  const saved = await saveNoDeckNote(access.supabase, access.user.id, note);
  if (!saved.ok) return saved;

  return takeTurn(access, open.client, open.interview, {
    role: "user",
    content: `I don't have a pitch deck yet. ${note}`,
    at: now(),
  });
}

/** Writes the per-topic summary once the intake is ready. */
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
    return success(access, interview);
  }

  const settings = await loadIntakeSettings(supabase);
  if (!intakeProgress(settings.topics, interview.topic_status).ready) {
    return {
      ok: false,
      error: "A few required topics are still open. Keep chatting with Rupert.",
    };
  }
  const view = await currentMaterials(access);
  if (
    !opened.client.intake_completed_at &&
    !intakeReady(settings.topics, interview.topic_status, readiness(view))
  ) {
    return { ok: false, error: MATERIALS_NEEDED };
  }

  const summary = await writeInterviewSummary(
    supabase,
    settings,
    opened.client,
    interview.messages,
    interview.topic_status,
    interview.conflicts,
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
  return success(access, asIntakeInterview(data));
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
    return success(access, asIntakeInterview(data[0]));
  }

  const loaded = await loadInterview(access.supabase, access.user.id);
  if (!loaded.ok || !loaded.interview) return { ok: false, error: TABLE_MISSING };
  return success(access, loaded.interview);
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

  // Normally the intake was already completed when the essentials and the
  // materials were in; confirming the summary then only records the edits.
  const completedAt = now();
  if (!opened.client.intake_completed_at) {
    const settings = await loadIntakeSettings(supabase);
    const view = await currentMaterials(access);
    if (!intakeReady(settings.topics, interview.topic_status, readiness(view))) {
      return { ok: false, error: MATERIALS_NEEDED };
    }
    const completed = await completeIntakeWithMaterials(supabase, user.id, completedAt);
    if (!completed.ok) return completed;
    if (completed.completed) {
      await notifyAdmin(supabase, user.id, "intake_completed", {
        email: true,
        details: completionDetails(settings.topics, interview.topic_status, view, interview.conflicts),
      });
    }
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

  revalidateIntake(user.id);
  return success(access, {
    ...interview,
    summary,
    status: "completed",
    completed_at: completedAt,
    updated_at: completedAt,
  });
}
