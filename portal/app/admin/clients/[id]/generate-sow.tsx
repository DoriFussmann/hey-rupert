"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveSowSend,
  generateStatementOfWork,
  sendStatementOfWork,
  unarchiveSowSend,
} from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDateAtTime } from "@/lib/format";
import type { SowSend } from "@/lib/types";

export function GenerateStatementOfWork({
  clientId,
  sentContent,
  sends,
}: {
  clientId: string;
  sentContent: string;
  sends: SowSend[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"generate" | "send" | string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const hasDraft = Boolean(draft.trim());
  const activeSend = sends.find((send) => !send.archived_at) ?? null;
  const hasActiveSend = Boolean(activeSend);
  const archivedCount = sends.filter((send) => send.archived_at).length;
  const canSend = hasDraft && !hasActiveSend && pending === null;
  const status = hasDraft
    ? "Ready to send"
    : hasActiveSend
      ? "Sent to client"
      : "Not generated";

  const visibleSends = useMemo(
    () =>
      sends.filter((send) =>
        view === "archived" ? Boolean(send.archived_at) : !send.archived_at,
      ),
    [sends, view],
  );

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  async function onGenerate() {
    setPending("generate");
    setError(null);
    setSuccess(null);

    try {
      const result = await generateStatementOfWork(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.content) {
        setError("Unable to generate.");
        return;
      }
      setDraft(result.content);
      setSuccess("Generated from the Statement of Work template.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate.");
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    if (!canSend) return;
    setPending("send");
    setError(null);
    setSuccess(null);

    try {
      const result = await sendStatementOfWork(clientId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess("Sent to the client portal.");
      setDraft("");
      setView("active");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send.");
    } finally {
      setPending(null);
    }
  }

  async function onArchive(sendId: string, archived: boolean) {
    setPending(sendId);
    setError(null);
    setSuccess(null);

    try {
      const result = archived
        ? await unarchiveSowSend(clientId, sendId)
        : await archiveSowSend(clientId, sendId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(archived ? "Restored to the send log." : "Archived.");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to update that record.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <h2 className="text-h4">Statement of Work</h2>
          <p className="mt-xs text-body-sm text-muted">
            Generate from the Forms template, then send it to this client. A
            send can happen once; archive the record to send again.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending !== null}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending === "generate"
            ? "Generating…"
            : "Generate Statement of Work"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Document</th>
              <th className="px-lg py-sm font-medium">Status</th>
              <th className="px-lg py-sm font-medium">Updated</th>
              <th className="px-lg py-sm font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-lg py-md text-heading">Statement of Work</td>
              <td className="px-lg py-md">{status}</td>
              <td className="px-lg py-md text-muted">
                {hasDraft
                  ? "Just now"
                  : activeSend
                    ? formatDateAtTime(activeSend.sent_at)
                    : "—"}
              </td>
              <td className="px-lg py-md text-right">
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!canSend}
                  title={
                    hasActiveSend
                      ? "Already sent. Archive that record to send again."
                      : undefined
                  }
                  className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                >
                  {pending === "send" ? "Sending…" : "Send to Client"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-md border-t border-border px-lg py-md">
        <div>
          <h3 className="text-h4">Send log</h3>
          <p className="mt-xs text-body-sm text-muted">
            One record is written when you send. Archive a row to hide it.
          </p>
        </div>
        <div className="flex gap-sm">
          <button
            type="button"
            className={tabClass(view === "active")}
            onClick={() => setView("active")}
          >
            Active
          </button>
          <button
            type="button"
            className={tabClass(view === "archived")}
            onClick={() => setView("archived")}
          >
            Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        </div>
      </div>

      {visibleSends.length === 0 ? (
        <p className="px-lg py-lg text-body-sm text-muted">
          {view === "archived"
            ? "No archived sends."
            : "No statements of work sent yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-t border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Document</th>
                <th className="px-lg py-sm font-medium">Sent</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {visibleSends.map((send) => (
                <tr
                  key={send.id}
                  className="border-t border-border last:border-b-0"
                >
                  <td className="px-lg py-md text-heading">
                    Statement of Work
                  </td>
                  <td className="px-lg py-md text-muted">
                    {formatDateAtTime(send.sent_at)}
                  </td>
                  <td className="px-lg py-md">
                    {send.archived_at ? "Archived" : "Sent to client"}
                  </td>
                  <td className="px-lg py-md text-right">
                    <button
                      type="button"
                      onClick={() => onArchive(send.id, Boolean(send.archived_at))}
                      disabled={pending !== null}
                      className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
                    >
                      {pending === send.id
                        ? send.archived_at
                          ? "Restoring…"
                          : "Archiving…"
                        : send.archived_at
                          ? "Restore"
                          : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-success">
          {success}
        </p>
      ) : null}

      {hasDraft ? (
        <div className="border-t border-border px-lg py-lg">
          <p className="mb-md text-label uppercase tracking-label text-muted">
            Preview
          </p>
          <MarkdownBody content={draft} emptyLabel="Nothing generated yet." />
        </div>
      ) : sentContent.trim() ? (
        <div className="border-t border-border px-lg py-lg">
          <p className="mb-md text-label uppercase tracking-label text-muted">
            Sent to client
          </p>
          <MarkdownBody
            content={sentContent}
            emptyLabel="Nothing sent yet."
          />
        </div>
      ) : null}
    </section>
  );
}
