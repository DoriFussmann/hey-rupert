"use client";

import { useEffect, useRef, useState } from "react";
import { createFramingUploadAction, pinProposalAction, sendFramingMessageAction } from "@/app/admin/brief-actions";
import { AutoTextarea } from "@/components/email-body-field";
import { MarkdownBody } from "@/components/markdown-body";
import { sectionTitle, type BriefTopic, type CompanyBrief, type FramingMessage } from "@/lib/brief";
import { INTAKE_FILE_EXTENSIONS, intakeFileProblem } from "@/lib/intake";
import { MATERIALS_BUCKET } from "@/lib/setup";
import { createClient } from "@/lib/supabase/client";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";

const ACCEPT = INTAKE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

type Attachment = { path: string; name: string; size: number; type: string };

/** The chat: Dori asks and decides; Rupert answers, researches and proposes changes she pins. */
export function FramingChat({
  clientId,
  company,
  messages,
  onMessages,
  onBrief,
  disabled,
  topics,
}: {
  clientId: string;
  company: string;
  messages: FramingMessage[];
  onMessages: (messages: FramingMessage[]) => void;
  onBrief: (brief: CompanyBrief) => void;
  disabled: boolean;
  topics: BriefTopic[];
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState<null | "send" | "upload" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(text: string) {
    if (!text.trim() && attachments.length === 0) return;
    setBusy("send");
    setError(null);
    try {
      const result = await sendFramingMessageAction(clientId, text, attachments);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onMessages(result.messages);
      setDraft("");
      setAttachments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function attach(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (files.length === 0) return;
    setBusy("upload");
    setError(null);
    try {
      for (const file of files.slice(0, 5)) {
        const problem = intakeFileProblem({ name: file.name, size: file.size });
        if (problem) throw new Error(problem);
        const ticket = await createFramingUploadAction(clientId, { name: file.name, size: file.size });
        if (!ticket.ok) throw new Error(ticket.error);
        const { error: uploadError } = await createClient()
          .storage.from(MATERIALS_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
        if (uploadError) throw new Error(`${file.name}: upload failed (${uploadError.message}).`);
        setAttachments((current) => [...current, { path: ticket.path, name: file.name, size: file.size, type: file.type }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function pin(messageId: string, proposalId: string) {
    setBusy(proposalId);
    setError(null);
    try {
      const result = await pinProposalAction(clientId, messageId, proposalId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onBrief(result.brief);
      onMessages(
        messages.map((message) => (message.id === messageId ? { ...message, pinned: [...message.pinned, proposalId] } : message)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't pin.");
    } finally {
      setBusy(null);
    }
  }

  const locked = disabled || busy !== null;

  return (
    <section className="flex flex-col rounded-card border border-border bg-surface lg:sticky lg:top-md lg:max-h-[calc(100vh-2rem)]">
      <div className="border-b border-border px-lg py-md">
        <h2 className="text-h4">Chat with Rupert</h2>
        <p className="mt-xs text-body-sm text-muted">
          Ask, push back, decide. Rupert has read everything and can look things up on the web. Pin the changes you want in the brief.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-lg py-md">
        {messages.length === 0 ? (
          <p className="text-body-sm text-muted">
            Start with what you want to decide, for example &quot;What&apos;s the strongest angle for {company}?&quot;, or attach the founder&apos;s LinkedIn as a PDF.
          </p>
        ) : (
          <ul className="grid gap-md">
            {messages.map((message) => (
              <li key={message.id} className={message.role === "user" ? "ml-xl rounded-md bg-primary-tint px-md py-sm" : "mr-md"}>
                <p className="text-label uppercase tracking-label text-muted">{message.role === "user" ? "You" : "Rupert"}</p>
                {message.content ? <MarkdownBody content={message.content} emptyLabel="" className="sow-markdown mt-xs text-body-sm" /> : null}
                {message.attachments.length > 0 ? (
                  <p className="mt-xs text-body-sm text-muted">Attached: {message.attachments.map((file) => file.name).join(", ")}</p>
                ) : null}
                {message.proposals.length > 0 ? (
                  <ul className="mt-sm grid gap-sm">
                    {message.proposals.map((proposal) => {
                      const pinned = message.pinned.includes(proposal.id);
                      return (
                        <li key={proposal.id} className="rounded-md border border-border bg-background px-md py-sm">
                          <div className="flex flex-wrap items-center justify-between gap-sm">
                            <p className="text-body-sm text-heading">
                              {proposal.mode === "append" ? "Add to" : "Replace"} {sectionTitle(proposal.section, topics)}
                            </p>
                            {pinned ? (
                              <span className="text-body-sm text-success">Pinned ✓</span>
                            ) : (
                              <button
                                type="button"
                                className={secondaryButton}
                                disabled={locked}
                                onClick={() => void pin(message.id, proposal.id)}
                              >
                                {busy === proposal.id ? "Pinning…" : "Pin"}
                              </button>
                            )}
                          </div>
                          {proposal.why ? <p className="mt-xs text-body-sm text-muted">{proposal.why}</p> : null}
                          <details className="mt-xs text-body-sm">
                            <summary className="cursor-pointer text-primary">Show the text</summary>
                            <MarkdownBody content={proposal.content} emptyLabel="" className="sow-markdown mt-xs" />
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {busy === "send" ? <p className="mt-md text-body-sm text-muted">Rupert is thinking (and may be searching the web)… usually under a minute.</p> : null}
        <div ref={end} />
      </div>

      <div className="border-t border-border px-lg py-md">
        <div className="mb-sm flex flex-wrap gap-xs">
          {[
            "Research the founder: prior companies, roles, exits and acquirers. Add what we can use.",
            "Who are the main competitors, and how should we answer that objection?",
            "What's the strongest angle, and what's the case against it?",
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="rounded-full border border-border px-sm py-px text-body-sm text-secondary hover:text-heading disabled:opacity-40"
              disabled={locked}
              onClick={() => void send(prompt)}
            >
              {prompt.split(":")[0].split(",")[0].replace(/\?$/, "")}
            </button>
          ))}
        </div>
        <AutoTextarea
          className={inputClass}
          value={draft}
          placeholder="Ask Rupert, or tell him what you've decided…"
          aria-label="Message to Rupert"
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(draft);
          }}
        />
        {attachments.length > 0 ? (
          <p className="mt-xs text-body-sm text-muted">
            Attached: {attachments.map((file) => file.name).join(", ")}{" "}
            <button type="button" className="text-primary" onClick={() => setAttachments([])}>
              Remove
            </button>
          </p>
        ) : null}
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          <button type="button" className={primaryButton} disabled={locked || (!draft.trim() && attachments.length === 0)} onClick={() => void send(draft)}>
            {busy === "send" ? "Sending…" : "Send"}
          </button>
          <button type="button" className={secondaryButton} disabled={locked} onClick={() => fileInput.current?.click()}>
            {busy === "upload" ? "Uploading…" : "Attach file"}
          </button>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple className="hidden" onChange={(event) => void attach(event.target.files)} />
          <span className="text-body-sm text-muted">⌘↵ to send</span>
        </div>
        {error ? <p role="alert" className="mt-sm text-body-sm text-error">{error}</p> : null}
      </div>
    </section>
  );
}
