"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  generateStatementOfWork,
  sendStatementOfWork,
} from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";

export function GenerateStatementOfWork({
  clientId,
  sentContent,
}: {
  clientId: string;
  sentContent: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"generate" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasDraft = Boolean(draft.trim());
  const hasSent = Boolean(sentContent.trim());
  const status = hasDraft ? "Ready to send" : hasSent ? "Sent to client" : "Not generated";

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
    if (!draft.trim()) return;
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send.");
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
            Generate from the Forms template, then send it to this client.
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
                {hasDraft ? "Just now" : "—"}
              </td>
              <td className="px-lg py-md text-right">
                <button
                  type="button"
                  onClick={onSend}
                  disabled={!hasDraft || pending !== null}
                  className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                >
                  {pending === "send" ? "Sending…" : "Send to Client"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
      ) : hasSent ? (
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
