"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  addInternalNote,
  createAdminDeskUpload,
  logOutsideMessage,
  openDeskItemForClient,
  replyToDeskItem,
  setDeskItemStatus,
} from "@/app/admin/desk-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { AttachmentsEditor, type PortalOutput } from "@/components/desk/attachments-editor";
import {
  ADMIN_OPEN_TYPES,
  BODY_MAX,
  DESK_STEPS,
  LOGGED_TYPES,
  NOTE_MAX,
  OUTSIDE_SOURCES,
  STEP_LABEL,
  TYPE_LABEL,
  adminDeskPath,
  type AdminOpenType,
  type DeskAttachment,
  type DeskNote,
  type DeskStatus,
  type DeskStep,
  type LoggedType,
  type OutsideSource,
} from "@/lib/desk";
import type { EmailResult } from "@/lib/email";
import { formatDateAtTime } from "@/lib/format";

const labelClass = "block text-label uppercase tracking-label text-muted";
const field = `${inputClass} mt-xs w-auto normal-case tracking-normal`;

const OUTSIDE_LABEL: Record<OutsideSource, string> = { email: "Email", call: "Call", message: "Message", meeting: "Meeting" };

const OPEN_HELP: Record<AdminOpenType, string> = {
  question: "A question for the client. It waits on them until they answer.",
  update: "Something they should know. It's a record: it stays off the inbox unless they reply.",
  shared_asset: "A document for their asset shelf. Attach the file, a link, or a page of their portal.",
};

type Message = { kind: "ok" | "error"; text: string } | null;

function emailNote(email: EmailResult | null) {
  if (!email) return "Saved. No email sent.";
  return email.ok ? "Saved, and the client was emailed a link to it." : `Saved, but the email did not go out: ${email.reason}`;
}

function StepSelect({ value, onChange }: { value: DeskStep; onChange: (step: DeskStep) => void }) {
  return (
    <label className={labelClass}>
      Step
      <select className={field} value={value} onChange={(event) => onChange(event.target.value as DeskStep)}>
        {DESK_STEPS.map((step) => (
          <option key={step} value={step}>
            {STEP_LABEL[step]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rupert opens an item: a question, an update, or a shared asset. */
export function NewItemForm({ clientId, outputs }: { clientId: string; outputs: PortalOutput[] }) {
  const router = useRouter();
  const [type, setType] = useState<AdminOpenType>("question");
  const [step, setStep] = useState<DeskStep>("general");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DeskAttachment[]>([]);
  const [email, setEmail] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const result = await openDeskItemForClient({ clientId, type, step, title, body, attachments, emailClient: email });
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      router.push(adminDeskPath(clientId, result.itemId));
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-lg py-md">
      <div className="flex flex-wrap items-end gap-sm">
        <label className={labelClass}>
          Post
          <select className={field} value={type} onChange={(event) => setType(event.target.value as AdminOpenType)}>
            {ADMIN_OPEN_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <StepSelect value={step} onChange={setStep} />
      </div>
      <p className="mt-xs text-body-sm text-muted">{OPEN_HELP[type]}</p>
      <input
        className={`${inputClass} mt-sm`}
        value={title}
        maxLength={200}
        aria-label="Title"
        placeholder={type === "shared_asset" ? "Asset title, e.g. Competitive Landscape & Deals" : "Title (optional: the first line is used)"}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className={`${inputClass} mt-sm min-h-[120px] resize-y`}
        value={body}
        maxLength={BODY_MAX}
        aria-label="Message"
        placeholder={type === "shared_asset" ? "A line about what it is (optional)" : "What the client will read"}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="mt-sm">
        <AttachmentsEditor
          value={attachments}
          onChange={setAttachments}
          upload={(file) => createAdminDeskUpload(clientId, file)}
          disabled={pending}
          admin
          outputs={outputs}
          onBusy={setUploading}
        />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-md">
        <button type="button" className={primaryButton} disabled={pending || uploading} onClick={() => void save()}>
          {pending ? "Posting…" : "Post to Their Desk"}
        </button>
        <label className="flex items-center gap-xs text-body-sm text-secondary">
          <input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />
          Email the client a link
        </label>
      </div>
      {message ? <p className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}>{message.text}</p> : null}
    </div>
  );
}

/**
 * Log an outside message: paste an email or a note, set its date and how it
 * came. On the client's Desk it opens a new item; on an item it joins it.
 */
export function LogOutsideForm({ clientId, itemId }: { clientId: string; itemId?: string }) {
  const router = useRouter();
  const [type, setType] = useState<LoggedType>("feedback");
  const [step, setStep] = useState<DeskStep>("general");
  const [source, setSource] = useState<OutsideSource>("email");
  const [from, setFrom] = useState<"client" | "admin">("client");
  const [on, setOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const result = await logOutsideMessage({ clientId, itemId, type, step, source, on, title, body, from });
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      setBody("");
      setTitle("");
      if (itemId) {
        setMessage({ kind: "ok", text: "Logged on this item, with its date." });
        router.refresh();
      } else {
        router.push(adminDeskPath(clientId, result.itemId));
        router.refresh();
      }
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-lg py-md">
      <div className="flex flex-wrap items-end gap-sm">
        <label className={labelClass}>
          How
          <select className={field} value={source} onChange={(event) => setSource(event.target.value as OutsideSource)}>
            {OUTSIDE_SOURCES.map((value) => (
              <option key={value} value={value}>
                {OUTSIDE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          When
          <input type="date" className={field} value={on} onChange={(event) => setOn(event.target.value)} />
        </label>
        {itemId ? (
          <label className={labelClass}>
            From
            <select className={field} value={from} onChange={(event) => setFrom(event.target.value as "client" | "admin")}>
              <option value="client">The client</option>
              <option value="admin">Us</option>
            </select>
          </label>
        ) : (
          <>
            <label className={labelClass}>
              It was
              <select className={field} value={type} onChange={(event) => setType(event.target.value as LoggedType)}>
                {LOGGED_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <StepSelect value={step} onChange={setStep} />
          </>
        )}
      </div>
      {itemId ? null : (
        <input
          className={`${inputClass} mt-sm`}
          value={title}
          maxLength={200}
          aria-label="Title"
          placeholder="Title (optional: the first line is used)"
          onChange={(event) => setTitle(event.target.value)}
        />
      )}
      <textarea
        className={`${inputClass} mt-sm min-h-[120px] resize-y`}
        value={body}
        maxLength={BODY_MAX}
        aria-label="The message"
        placeholder="Paste the email, or write what was said."
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="mt-md flex flex-wrap items-center gap-md">
        <button type="button" className={primaryButton} disabled={pending || !body.trim()} onClick={() => void save()}>
          {pending ? "Logging…" : "Log It"}
        </button>
        <span className="text-body-sm text-muted">The client sees it on their Desk, dated as you set it. Nobody is emailed. It can&apos;t be edited afterwards.</span>
      </div>
      {message ? <p className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}>{message.text}</p> : null}
    </div>
  );
}

/** Rupert's reply on an item: text, files, links, a shared asset. Then it waits on the client, or closes. */
export function AdminReplyForm({
  clientId,
  itemId,
  status,
  outputs,
}: {
  clientId: string;
  itemId: string;
  status: DeskStatus;
  outputs: PortalOutput[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DeskAttachment[]>([]);
  const [email, setEmail] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const closed = status === "closed";

  async function reply(close: boolean) {
    setPending(true);
    setMessage(null);
    try {
      const result = await replyToDeskItem({ clientId, itemId, body, attachments, close, emailClient: email });
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      setBody("");
      setAttachments([]);
      setMessage({ kind: result.clientEmail && !result.clientEmail.ok ? "error" : "ok", text: emailNote(result.clientEmail) });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  async function setStatus(action: "close" | "reopen") {
    setPending(true);
    setMessage(null);
    try {
      const result = await setDeskItemStatus({ clientId, itemId, action, note: body });
      if (!result.ok) return setMessage({ kind: "error", text: result.error });
      setBody("");
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  const empty = !body.trim() && attachments.length === 0;

  return (
    <div className="px-lg py-md">
      <textarea
        className={`${inputClass} min-h-[130px] resize-y`}
        value={body}
        maxLength={BODY_MAX}
        aria-label="Reply"
        placeholder={closed ? "Add to this record. It stays closed unless the client replies." : "Your answer. The client reads it on their Desk."}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="mt-sm">
        <AttachmentsEditor
          value={attachments}
          onChange={setAttachments}
          upload={(file) => createAdminDeskUpload(clientId, file)}
          disabled={pending}
          admin
          outputs={outputs}
          onBusy={setUploading}
        />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={pending || uploading || empty} onClick={() => void reply(false)}>
          {pending ? "Saving…" : closed ? "Add to the Record" : "Reply"}
        </button>
        {!closed ? (
          <button type="button" className={secondaryButton} disabled={pending || uploading || empty} onClick={() => void reply(true)}>
            Reply &amp; Close
          </button>
        ) : null}
        <label className="flex items-center gap-xs text-body-sm text-secondary">
          <input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />
          Email the client a link
        </label>
        <span className="ml-auto">
          {closed ? (
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => void setStatus("reopen")}>
              Reopen
            </button>
          ) : (
            <button
              type="button"
              className={secondaryButton}
              disabled={pending || attachments.length > 0}
              title="Closes without emailing. Anything written above is saved as the closing note, which the client sees."
              onClick={() => void setStatus("close")}
            >
              {body.trim() ? "Close With This Note, No Email" : "Close, No Reply"}
            </button>
          )}
        </span>
      </div>
      {message ? <p className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}>{message.text}</p> : null}
    </div>
  );
}

/** Internal notes on an item. Stored apart from the messages; the client never sees them. */
export function InternalNotes({ clientId, itemId, notes }: { clientId: string; itemId: string; notes: DeskNote[] }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await addInternalNote({ clientId, itemId, body });
      if (!result.ok) return setError(result.error);
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      {notes.length > 0 ? (
        <ul className="divide-y divide-border">
          {notes.map((note) => (
            <li key={note.id} className="px-lg py-md">
              <p className="text-label uppercase tracking-label text-muted">
                {note.author ?? "Admin"} · {formatDateAtTime(note.createdAt)}
              </p>
              <p className="mt-xs max-w-prose whitespace-pre-wrap text-body-sm text-heading">{note.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="px-lg py-md">
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={body}
          maxLength={NOTE_MAX}
          aria-label="Internal note"
          placeholder="A note to yourself. Never shown to the client."
          onChange={(event) => setBody(event.target.value)}
        />
        <button type="button" className={`${secondaryButton} mt-sm`} disabled={pending || !body.trim()} onClick={() => void save()}>
          {pending ? "Saving…" : "Add Note"}
        </button>
        {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
      </div>
    </div>
  );
}
