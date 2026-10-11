"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { archiveNda, generateNda, sendNda } from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDate, formatDateAtTime } from "@/lib/format";
import { mergeServiceOrder } from "@/lib/service-order";
import type { SignedDocumentSend } from "@/lib/types";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

function sendStatus(send: SignedDocumentSend) {
  if (send.archived_at) return send.signature ? "Void (was signed)" : "Archived";
  if (send.signature) return `Signed ${formatDate(send.signature.signed_at)}`;
  return "Awaiting signature";
}

export function GenerateNda({
  clientId,
  sends,
  available,
}: {
  clientId: string;
  sends: SignedDocumentSend[];
  /** True once kick-off is ready (Service Order signed + Setup Fee paid). */
  available: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [view, setView] = useState<"active" | "archived">("active");

  const activeSend = sends.find((send) => !send.archived_at) ?? null;
  const hasDraft = Boolean(draft.trim());
  const archivedCount = sends.filter((send) => send.archived_at).length;
  const status = hasDraft
    ? "Ready to send"
    : activeSend
      ? sendStatus(activeSend)
      : available
        ? "Not generated"
        : "Available after kick-off";

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
      const result = await generateNda(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (!result.content) {
        setError("Unable to generate.");
        return;
      }
      setDraft(result.content);
      setSuccess("Generated from the NDA template. Review it, then push.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate.");
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    if (!hasDraft || activeSend || pending !== null) return;
    setPending("send");
    setError(null);
    setSuccess(null);

    try {
      const result = await sendNda(clientId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.clientEmail.ok) {
        setSuccess("NDA pushed to the client portal, and the client was emailed.");
      } else {
        setSuccess("NDA pushed to the client portal.");
        setError(`The client was not emailed. ${result.clientEmail.reason}`);
      }
      setDraft("");
      setView("active");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send.");
    } finally {
      setPending(null);
    }
  }

  async function onArchive(send: SignedDocumentSend) {
    const message = send.signature
      ? "This NDA is signed. Archiving voids it: the signature is removed from the client's portal and they will need to sign a new one. Continue?"
      : "Archive this NDA? It will be removed from the client's portal so you can issue a new one.";
    if (!window.confirm(message)) return;

    setPending(send.id);
    setError(null);
    setSuccess(null);

    try {
      const result = await archiveNda(clientId, send.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(send.signature ? "NDA voided." : "Archived.");
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
          <h2 className="text-h4">NDA</h2>
          <p className="mt-xs text-body-sm text-muted">
            Generate from the Forms template and push it to the client after
            kick-off. One active NDA at a time; archive it to issue a new one.
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={pending !== null || Boolean(activeSend) || !available}
          title={
            !available
              ? "Available once the Service Order is signed and the Setup Fee is received."
              : activeSend
                ? "Archive the current NDA to generate a new one."
                : undefined
          }
          className={primaryButton}
        >
          {pending === "generate" ? "Generating…" : "Generate NDA"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Document</th>
              <th className="px-lg py-sm font-medium">Status</th>
              <th className="px-lg py-sm font-medium">Updated</th>
              <th className="px-lg py-sm font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-lg py-md text-heading">NDA</td>
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
                  disabled={!hasDraft || Boolean(activeSend) || pending !== null}
                  className={primaryButton}
                >
                  {pending === "send" ? "Pushing…" : "Push to Client Portal"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {activeSend?.signature ? (
        <dl className="grid gap-x-lg gap-y-sm border-t border-border px-lg py-md text-body-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Signed by</dt>
          <dd className="text-heading">
            {activeSend.signature.signer_name},{" "}
            {activeSend.signature.signer_title} ·{" "}
            {activeSend.signature.company_name}
          </dd>
          <dt className="text-muted">Signer email</dt>
          <dd className="text-heading">{activeSend.signature.signer_email}</dd>
          <dt className="text-muted">Signed at</dt>
          <dd className="text-heading">
            {formatDateAtTime(activeSend.signature.signed_at)}
            {activeSend.signed_ip ? (
              <span className="text-muted"> · IP {activeSend.signed_ip}</span>
            ) : null}
          </dd>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-md border-t border-border px-lg py-md">
        <div>
          <h3 className="text-h4">Send log</h3>
          <p className="mt-xs text-body-sm text-muted">
            Archiving the active NDA removes it from the portal.
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
          {view === "archived" ? "No archived NDAs." : "No NDA sent yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-t border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Sent</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleSends.map((send) => (
                <tr key={send.id} className="border-t border-border">
                  <td className="px-lg py-md text-muted">
                    {formatDateAtTime(send.sent_at)}
                  </td>
                  <td className="px-lg py-md">{sendStatus(send)}</td>
                  <td className="px-lg py-md text-right">
                    {send.archived_at ? null : (
                      <button
                        type="button"
                        onClick={() => onArchive(send)}
                        disabled={pending !== null}
                        className={secondaryButton}
                      >
                        {pending === send.id ? "Archiving…" : "Archive"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="border-t border-border px-lg py-md text-body-sm text-error"
        >
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
            Preview · client fields are filled in when they sign
          </p>
          <MarkdownBody
            content={mergeServiceOrder(draft, {})}
            emptyLabel="Nothing generated yet."
          />
        </div>
      ) : activeSend ? (
        <details className="border-t border-border px-lg py-lg">
          <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
            {activeSend.signature ? "Signed copy" : "Sent to client"}
          </summary>
          <div className="mt-md">
            <MarkdownBody
              content={
                activeSend.signed_content ??
                mergeServiceOrder(activeSend.content, {})
              }
              emptyLabel="Nothing sent yet."
            />
          </div>
        </details>
      ) : null}
    </section>
  );
}
