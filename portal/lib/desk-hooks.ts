import "server-only";
import type { createServiceClient } from "@/lib/supabase/admin";
import {
  STEP_HREF,
  STEP_LABEL,
  dayToIso,
  deskItemPath,
  deskRef,
  adminDeskPath,
  publishTitle,
  stepResponseBody,
  titleFrom,
  type DeskAttachment,
  type DeskStep,
  type OutsideSource,
} from "@/lib/desk";
import { DESK_MIGRATION_MISSING, findFlowItem, findItemByRef, isDeskMissing, isRecorded, openDeskItem, postDeskMessage } from "@/lib/desk-server";
import { loadEmailSettings } from "@/lib/email-settings";
import { clientDisplayName } from "@/lib/format";
import { adminFirstName } from "@/lib/investor-list-email";
import { PORTAL_URL } from "@/lib/portal-url";
import { asMaterials, formatBytes, type MaterialFile, type SetupResponse } from "@/lib/setup";
import { loadSetupStep } from "@/lib/setup-server";

// The existing flows keep working exactly as they do; each one also writes to
// the client's Desk here, so the record is complete. Every function is best
// effort: the flow has already saved its own change, so a failure here is
// logged and never blocks it. Each returns the Desk item it wrote to (or
// null), so the flow's email can link to it.

type ServiceClient = ReturnType<typeof createServiceClient>;
type ReviewStep = "framing" | "investor_list" | "email_copy";

/** The Desk item an event was recorded on, with the links emails use. */
export type DeskRecord = { itemId: string; portalLink: string; adminLink: string };

function recorded(clientId: string, itemId: string): DeskRecord {
  return {
    itemId,
    portalLink: `${PORTAL_URL}${deskItemPath(itemId)}`,
    adminLink: `${PORTAL_URL}${adminDeskPath(clientId, itemId)}`,
  };
}

/** Runs a hook, never throwing. Before desk.sql is run, hooks do nothing, quietly. */
async function quietly(what: string, run: () => Promise<DeskRecord | null>): Promise<DeskRecord | null> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== DESK_MIGRATION_MISSING && !isDeskMissing(message)) {
      console.error(`Desk: ${what} not recorded: ${message}`);
    }
    return null;
  }
}

/** Unwraps a Desk write; a failure becomes a thrown error for `quietly` to log. */
function must<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

async function clientName(supabase: ServiceClient, clientId: string) {
  const { data } = await supabase
    .from("clients")
    .select("first_name, last_name, founder_name, company_name, email")
    .eq("id", clientId)
    .maybeSingle();
  return clientDisplayName((data ?? {}) as Record<string, unknown>);
}

/** The name Rupert's Desk messages carry: the first name on the email signature. */
export async function deskAdminName(supabase: ServiceClient) {
  try {
    return adminFirstName((await loadEmailSettings(supabase)).signature);
  } catch {
    return "Rupert";
  }
}

function fileAttachments(clientId: string, files: Pick<MaterialFile, "path" | "name" | "size" | "type">[]): DeskAttachment[] {
  return files
    .filter((file) => file.path.startsWith(`${clientId}/`) && !file.path.includes(".."))
    .slice(0, 10)
    .map((file) => ({ kind: "file", path: file.path, name: file.name, size: file.size, type: file.type }));
}

// ---------------------------------------------------------------------------
// Review steps: the narrative, the investor list, the email copy

/**
 * Rupert published a version of a step. It answers the open item on that
 * step when there is one (the client's change request); otherwise it is an
 * Update of its own, a record that starts closed.
 */
export function recordStepPublished(supabase: ServiceClient, clientId: string, step: ReviewStep, version: number) {
  return quietly(`${step} v${version}`, async () => {
    const adminName = await deskAdminName(supabase);
    const href = STEP_HREF[step]!;
    const attachments: DeskAttachment[] = [
      { kind: "link", url: href, label: STEP_LABEL[step], asset: { title: STEP_LABEL[step], version } },
    ];
    const ref = deskRef.published(step, version);
    const already = await isRecorded(supabase, clientId, ref);
    if (already) return recorded(clientId, already);
    const open = await findFlowItem(supabase, clientId, step, "step");
    if (open) {
      must(
        await postDeskMessage(supabase, {
          itemId: open.id,
          author: "admin",
          authorName: adminName,
          body: `Version ${version} is in your portal, updated from your feedback. Review it and confirm, or tell us what to change.`,
          attachments,
          status: "waiting_client",
          sourceRef: ref,
        }),
      );
      return recorded(clientId, open.id);
    }
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "update",
        step,
        source: "step",
        sourceHref: href,
        sourceRef: ref,
        openedBy: "admin",
        title: publishTitle(step, version),
        message: {
          author: "admin",
          authorName: adminName,
          body: `Version ${version} is in your portal. Review it and confirm, or tell us what to change.`,
          attachments,
        },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/**
 * The client confirmed a version or asked for changes. A change request is a
 * Feedback item (or joins the one already open on the step). A confirmation
 * closes the open item, or is added to the record of that version.
 */
export function recordStepResponse(
  supabase: ServiceClient,
  clientId: string,
  step: ReviewStep,
  response: SetupResponse,
) {
  return quietly(`${step} response`, async () => {
    const name = await clientName(supabase, clientId);
    const body = stepResponseBody({
      decision: response.decision,
      version: response.version,
      note: response.note,
      itemNotes: Object.entries(response.item_notes).map(([key, note]) => ({
        label: response.item_labels[key] ?? key,
        note,
      })),
    });
    const ref = deskRef.response(step, response.version);
    const already = await isRecorded(supabase, clientId, ref);
    if (already) return recorded(clientId, already);
    const confirmed = response.decision === "confirmed";
    const open = await findFlowItem(supabase, clientId, step, "step");
    const target = open ?? (confirmed ? await findFlowItem(supabase, clientId, step, "step", { anyStatus: true }) : null);

    if (target) {
      must(
        await postDeskMessage(supabase, {
          itemId: target.id,
          author: "client",
          authorName: name,
          body,
          status: confirmed ? "closed" : "waiting_us",
          event: confirmed && target.status !== "closed" ? "closed" : !confirmed && target.status === "closed" ? "reopened" : null,
          sourceRef: ref,
        }),
      );
      return recorded(clientId, target.id);
    }
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "feedback",
        step,
        source: "step",
        sourceHref: STEP_HREF[step],
        sourceRef: ref,
        openedBy: "client",
        status: confirmed ? "closed" : "waiting_us",
        title: confirmed
          ? `Confirmed: ${STEP_LABEL[step]} (version ${response.version})`
          : `Changes requested: ${STEP_LABEL[step]} (version ${response.version})`,
        message: { author: "client", authorName: name, body },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** More feedback from the client while Rupert works on their change request. */
export function recordStepFeedbackAdded(
  supabase: ServiceClient,
  clientId: string,
  step: ReviewStep,
  version: number,
  body: string,
) {
  return quietly(`${step} added feedback`, async () => {
    const name = await clientName(supabase, clientId);
    const open = await findFlowItem(supabase, clientId, step, "step");
    if (open) {
      must(await postDeskMessage(supabase, { itemId: open.id, author: "client", authorName: name, body, status: "waiting_us" }));
      return recorded(clientId, open.id);
    }
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "feedback",
        step,
        source: "step",
        sourceHref: STEP_HREF[step],
        openedBy: "client",
        title: `More feedback: ${STEP_LABEL[step]} (version ${version})`,
        message: { author: "client", authorName: name, body },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** Rupert made the client's narrative changes and recorded the version as confirmed. */
export function recordNarrativeApplied(supabase: ServiceClient, clientId: string, version: number, askedIn: number) {
  return quietly("narrative applied", async () => {
    const item =
      (await findFlowItem(supabase, clientId, "framing", "step")) ??
      (await findFlowItem(supabase, clientId, "framing", "step", { anyStatus: true }));
    if (!item) return null;
    must(
      await postDeskMessage(supabase, {
        itemId: item.id,
        author: "admin",
        authorName: await deskAdminName(supabase),
        body: `Made the changes you asked for in version ${askedIn}. Version ${version} is recorded as confirmed; there is nothing more to confirm.`,
        status: "closed",
        event: item.status === "closed" ? null : "closed",
        sourceRef: `${deskRef.published("framing", version)}:applied`,
      }),
    );
    return recorded(clientId, item.id);
  });
}

// ---------------------------------------------------------------------------
// Questions on a step, and what the client said outside the portal

/** The client asked a question from a step's review panel. */
export function recordStepQuestion(
  supabase: ServiceClient,
  clientId: string,
  step: ReviewStep,
  questionId: string,
  question: string,
) {
  return quietly(`${step} question`, async () => {
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "question",
        step,
        source: "step",
        sourceHref: STEP_HREF[step],
        sourceRef: deskRef.question(questionId),
        openedBy: "client",
        title: titleFrom(question, `Question on ${STEP_LABEL[step]}`),
        message: { author: "client", authorName: await clientName(supabase, clientId), body: question },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** Rupert answered a step question (or resolved it without a written answer). It closes the item. */
export function recordQuestionSettled(supabase: ServiceClient, clientId: string, questionId: string, answer: string) {
  return quietly("question answer", async () => {
    const item = await findItemByRef(supabase, clientId, deskRef.question(questionId));
    if (!item) return null;
    must(
      await postDeskMessage(supabase, {
        itemId: item.id,
        author: "admin",
        authorName: await deskAdminName(supabase),
        body: answer.trim() || "Followed up with you on this directly.",
        status: "closed",
        event: item.status === "closed" ? null : "closed",
        sourceRef: deskRef.answer(questionId),
      }),
    );
    return recorded(clientId, item.id);
  });
}

/**
 * Rupert logged something the client said outside the portal (Log Client
 * Feedback). It joins the Desk with its real date. Shares the question's key
 * when it is also in a step's thread, so answering it there closes it here.
 */
export function recordLoggedFeedback(
  supabase: ServiceClient,
  clientId: string,
  input: { id: string; step: DeskStep; channel: OutsideSource; on: string; text: string; by: string | null },
) {
  return quietly("logged feedback", async () => {
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "feedback",
        step: input.step,
        source: input.channel,
        sourceHref: STEP_HREF[input.step],
        sourceRef: deskRef.question(input.id),
        openedBy: "client",
        title: titleFrom(input.text, "Feedback"),
        occurredAt: dayToIso(input.on),
        message: {
          author: "client",
          authorName: await clientName(supabase, clientId),
          body: input.text,
          loggedBy: input.by,
        },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** Logged feedback was removed as a mistake. The record stands; the item is closed with a note saying so. */
export function recordLoggedFeedbackRemoved(supabase: ServiceClient, clientId: string, feedbackId: string) {
  return quietly("logged feedback removal", async () => {
    const item = await findItemByRef(supabase, clientId, deskRef.question(feedbackId));
    if (!item || item.status === "closed") return null;
    must(
      await postDeskMessage(supabase, {
        itemId: item.id,
        author: "system",
        authorName: "",
        body: "Logged by mistake. Closed.",
        status: "closed",
        event: "closed",
        sourceRef: `${deskRef.question(feedbackId)}:removed`,
      }),
    );
    return recorded(clientId, item.id);
  });
}

// ---------------------------------------------------------------------------
// Company materials

/** The client submitted their company materials (or resubmitted after Rupert asked for more). */
export function recordMaterialsSubmitted(
  supabase: ServiceClient,
  clientId: string,
  version: number,
  files: MaterialFile[],
  details: string,
) {
  return quietly("materials submitted", async () => {
    const name = await clientName(supabase, clientId);
    const attachments = fileAttachments(clientId, files);
    const ref = deskRef.materials(version);
    const already = await isRecorded(supabase, clientId, ref);
    if (already) return recorded(clientId, already);
    // Rupert asked for more: the resubmission answers that item.
    const asked = await findFlowItem(supabase, clientId, "materials", "materials", { openedBy: "admin" });
    if (asked) {
      must(
        await postDeskMessage(supabase, {
          itemId: asked.id,
          author: "client",
          authorName: name,
          body: details,
          attachments,
          status: "waiting_us",
          sourceRef: ref,
        }),
      );
      return recorded(clientId, asked.id);
    }
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "materials",
        step: "materials",
        source: "materials",
        sourceHref: STEP_HREF.materials,
        sourceRef: ref,
        openedBy: "client",
        title: version > 1 ? "Company materials resubmitted" : "Company materials submitted",
        message: { author: "client", authorName: name, body: details, attachments },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** The intake completed, which submits the company materials shared in it. */
export async function recordIntakeMaterials(supabase: ServiceClient, clientId: string) {
  try {
    const loaded = await loadSetupStep(supabase, clientId, "materials");
    if (!loaded.ok || !loaded.row || loaded.row.status !== "submitted") return null;
    const materials = asMaterials(loaded.row.published);
    return await recordMaterialsSubmitted(
      supabase,
      clientId,
      loaded.row.version,
      materials.files,
      materials.files.length > 0
        ? "Shared with the intake."
        : `No files shared with the intake.${materials.no_deck ? ` No deck yet: ${materials.no_deck}` : ""}`,
    );
  } catch (err) {
    console.error(`Desk: intake materials not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * A file joined the company materials after they were submitted: added by
 * the client, or by Rupert for them. Files added in one sitting share an item.
 */
export function recordMaterialFile(
  supabase: ServiceClient,
  clientId: string,
  file: MaterialFile,
  by: "client" | "admin",
) {
  return quietly("materials file", async () => {
    const authorName = by === "client" ? await clientName(supabase, clientId) : await deskAdminName(supabase);
    const attachments = fileAttachments(clientId, [file]);
    const body = `${file.name} (${formatBytes(file.size)})`;
    const ref = `materials:file:${file.path}`;

    const recent = await findFlowItem(supabase, clientId, "materials", "materials", { anyStatus: by === "admin", openedBy: by });
    const sameSitting =
      recent && Date.now() - new Date(recent.lastMessageAt).getTime() < 60 * 60 * 1000 && recent.type === "materials";
    if (recent && sameSitting) {
      must(
        await postDeskMessage(supabase, {
          itemId: recent.id,
          author: by,
          authorName,
          body,
          attachments,
          sourceRef: ref,
        }),
      );
      return recorded(clientId, recent.id);
    }
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "materials",
        step: "materials",
        source: "materials",
        sourceHref: STEP_HREF.materials,
        sourceRef: ref,
        openedBy: by,
        title: by === "client" ? "New company files" : "Files added to your company materials",
        message: { author: by, authorName, body, attachments },
      }),
    );
    return recorded(clientId, opened.id);
  });
}

/** Rupert sent the materials back, asking for more. It waits on the client. */
export function recordMaterialsReopened(supabase: ServiceClient, clientId: string, note: string) {
  return quietly("materials reopened", async () => {
    const opened = must(
      await openDeskItem(supabase, {
        clientId,
        type: "question",
        step: "materials",
        source: "materials",
        sourceHref: "/portal/materials",
        openedBy: "admin",
        title: titleFrom(note, "A few more things needed on your materials"),
        message: { author: "admin", authorName: await deskAdminName(supabase), body: note },
      }),
    );
    return recorded(clientId, opened.id);
  });
}
