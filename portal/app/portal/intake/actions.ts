"use server";

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
} from "@/lib/intake-server";
import { advanceStage } from "@/lib/kickoff";
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
  if (client.intake_completed_at) {
    return { ok: false as const, error: "Your intake is already complete." };
  }
  return { ok: true as const, client };
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

  const settings = await loadIntakeSettings(supabase);
  const turn = await nextInterviewTurn(settings, opened.client, [], {});
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
  return { ok: true, interview: asIntakeInterview(data) };
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

  const opened = await loadOpenClient(access);
  if (!opened.ok) return opened;

  const { supabase, user } = access;
  const loaded = await loadInterview(supabase, user.id);
  if (!loaded.ok) return { ok: false, error: TABLE_MISSING };
  const interview = loaded.interview;
  if (!interview) return { ok: false, error: "The interview has not started yet." };
  if (interview.status !== "in_progress") {
    return { ok: false, error: "Go back to the conversation to add more." };
  }
  if (interview.client_message_count >= INTAKE_LIMITS.clientMessagesMax) {
    return {
      ok: false,
      error:
        "We've reached the message limit for this interview. Review the summary, or use Book a call to finish with Dori.",
    };
  }

  const settings = await loadIntakeSettings(supabase);
  const withUser: IntakeMessage[] = [
    ...interview.messages,
    { role: "user", content, at: now() },
  ];

  const turn = await nextInterviewTurn(
    settings,
    opened.client,
    withUser,
    interview.topic_status,
  );
  if (!turn.ok) return { ok: false, error: AI_UNAVAILABLE, aiUnavailable: true };

  const messages: IntakeMessage[] = [
    ...withUser,
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

  revalidatePath(`/admin/clients/${user.id}`);
  return { ok: true, interview: asIntakeInterview(data[0]) };
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

  const { error: clientError } = await supabase
    .from("clients")
    .update({ intake_completed_at: completedAt })
    .eq("id", user.id);

  if (clientError) return { ok: false, error: clientError.message };

  // Stage first, so the admin email reports the up-to-date next step.
  await advanceStage(supabase, user.id, ["nda", "intake"], "setup");
  await notifyAdmin(supabase, user.id, "intake_completed", { email: true });

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
