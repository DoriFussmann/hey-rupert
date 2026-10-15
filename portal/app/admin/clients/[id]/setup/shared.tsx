"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { publishSetupStep, saveSetupDraft } from "@/app/admin/setup-actions";
import { formatDateAtTime } from "@/lib/format";
import type {
  SetupItem,
  SetupResponse,
  SetupStepId,
  SetupStepState,
} from "@/lib/setup";

export const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
export const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
export const inputClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";

/** Why Rupert cannot push a step yet, in Rupert's words. */
export const ADMIN_BLOCKED: Record<SetupStepId, string> = {
  materials: "Waiting for the client's materials",
  deck_review: "Push opens once the client submits their materials",
  framing: "Push opens once the client submits their materials",
  investor_list: "Push opens once the client confirms the outreach narrative",
  email_copy: "Push opens once the client confirms the investor list",
};

/** The step's status from Rupert's side. */
export function adminStatus(item: SetupItem) {
  if (item.status === "done") return { label: "Done", tone: "text-success" };
  if (item.status === "waiting") {
    return { label: "Your turn", tone: "bg-primary-tint text-primary border-primary/30" };
  }
  if (item.status === "your_turn") {
    return { label: "Waiting on client", tone: "text-muted" };
  }
  return { label: "Not open yet", tone: "text-muted" };
}

export function StepFrame({
  item,
  intro,
  children,
}: {
  item: SetupItem;
  intro: string;
  children: React.ReactNode;
}) {
  const status = adminStatus(item);
  return (
    <section
      id={`setup-${item.id}`}
      className={`mt-lg rounded-card border bg-surface ${
        item.status === "waiting" ? "border-primary/30" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-md border-b border-border px-lg py-lg">
        <div className="min-w-0">
          <h3 className="text-h4">{item.title}</h3>
          <p className="mt-xs max-w-prose text-body-sm text-muted">{intro}</p>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full border border-border px-sm py-xs text-label uppercase tracking-label ${status.tone}`}
        >
          {status.label}
        </span>
      </div>
      <div className={item.status === "open" ? "opacity-60" : undefined}>{children}</div>
    </section>
  );
}

/** The client's latest answer on the current version, for Rupert. */
export function ClientAnswer({
  row,
}: {
  row: SetupStepState | null;
}) {
  const response: SetupResponse | null =
    row?.response && row.response.version === row.version ? row.response : null;
  if (!row || row.version === 0) return null;

  if (!response) {
    return row.status === "with_client" ? (
      <p className="px-lg pt-md text-body-sm text-muted">
        Version {row.version} pushed {row.published_at ? formatDateAtTime(row.published_at) : ""}.
        Waiting for the client to confirm or comment.
      </p>
    ) : null;
  }

  const notes = Object.entries(response.item_notes);
  const confirmed = response.decision === "confirmed";
  return (
    <div
      className={`mx-lg mt-md rounded-card border px-md py-md ${
        confirmed ? "border-border bg-background" : "border-warning/40 bg-background"
      }`}
    >
      <p
        className={`text-label uppercase tracking-label ${confirmed ? "text-success" : "text-warning"}`}
      >
        {confirmed ? "Client confirmed" : "Client asked for changes"} · version{" "}
        {response.version} · {formatDateAtTime(response.at)}
      </p>
      {response.note ? (
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{response.note}</p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-sm list-disc space-y-xs pl-md text-body-sm text-body">
          {notes.map(([key, note]) => (
            <li key={key}>
              <span className="text-heading">{response.item_labels[key] ?? key}:</span>{" "}
              <span className="whitespace-pre-wrap">{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EarlierRounds({ row }: { row: SetupStepState | null }) {
  const earlier = (row?.history ?? [])
    .filter((entry) => row && entry.version < row.version)
    .sort((a, b) => b.version - a.version);
  if (earlier.length === 0) return null;
  return (
    <details className="mx-lg mt-md text-body-sm">
      <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
        Earlier rounds ({earlier.length})
      </summary>
      <ol className="mt-sm space-y-sm">
        {earlier.map((entry) => (
          <li key={entry.version}>
            <p className="text-muted">
              Version {entry.version} · pushed {formatDateAtTime(entry.published_at)}
              {entry.response
                ? ` · ${entry.response.decision === "confirmed" ? "confirmed" : "changes requested"} ${formatDateAtTime(entry.response.at)}`
                : ""}
            </p>
            {entry.response?.note ? (
              <p className="whitespace-pre-wrap text-body">{entry.response.note}</p>
            ) : null}
            {entry.response
              ? Object.entries(entry.response.item_notes).map(([key, note]) => (
                  <p key={key} className="text-body">
                    <span className="text-heading">
                      {entry.response!.item_labels[key] ?? key}:
                    </span>{" "}
                    {note}
                  </p>
                ))
              : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Save draft / push controls shared by every step Rupert writes. The draft
 * is owned by the panel; this handles the calls and the messages.
 */
export function PublishBar({
  clientId,
  step,
  item,
  row,
  draft,
  dirty,
  onSaved,
  pushLabel,
  problem,
}: {
  clientId: string;
  step: SetupStepId;
  item: SetupItem;
  row: SetupStepState | null;
  draft: unknown;
  dirty: boolean;
  onSaved: () => void;
  pushLabel: string;
  /** A reason the draft cannot be pushed yet, shown next to the button. */
  problem?: string | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<null | "save" | "push">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null,
  );

  const reachable = item.status !== "open";
  const withClient = row?.status === "with_client";

  async function onSave() {
    setPending("save");
    setMessage(null);
    try {
      const result = await saveSetupDraft(clientId, step, draft);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      onSaved();
      setMessage({ kind: "ok", text: "Draft saved. The client does not see drafts." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(null);
    }
  }

  async function onPush() {
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    const question = row?.status === "confirmed"
      ? "The client already confirmed this. Pushing a new version asks them to confirm again. Continue?"
      : withClient
        ? "The client has the current version. Replace it with this one and email them?"
        : "Push to the client's portal and email them?";
    if (!window.confirm(question)) return;

    setPending("push");
    setMessage(null);
    try {
      const result = await publishSetupStep(clientId, step, draft, note);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      onSaved();
      setNote("");
      setMessage(
        result.clientEmail.ok
          ? { kind: "ok", text: "Pushed to the portal, and the client was emailed." }
          : {
              kind: "error",
              text: `Pushed to the portal, but the client was not emailed. ${result.clientEmail.reason}`,
            },
      );
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to push." });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="border-t border-border px-lg py-md">
      <label className="block text-label uppercase tracking-label text-muted">
        Note to the client (optional, included in the email)
        <input
          className={`${inputClass} mt-sm normal-case tracking-normal`}
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            row && row.version > 0
              ? "What changed in this version"
              : "A line of context for the client"
          }
        />
      </label>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className={primaryButton}
          disabled={pending !== null || !reachable}
          onClick={onPush}
          title={!reachable ? ADMIN_BLOCKED[step] : undefined}
        >
          {pending === "push"
            ? "Pushing…"
            : row && row.version > 0
              ? `${pushLabel} (v${row.version + 1})`
              : pushLabel}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={pending !== null}
          onClick={onSave}
        >
          {pending === "save" ? "Saving…" : "Save draft"}
        </button>
        {dirty ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
        {!reachable ? (
          <p className="text-body-sm text-muted">
            {ADMIN_BLOCKED[step]}. You can draft now.
          </p>
        ) : null}
      </div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
