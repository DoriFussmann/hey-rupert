"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logClientFeedback, removeClientFeedback, saveFeedbackSummary } from "@/app/admin/setup-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { formatDate } from "@/lib/format";
import { FEEDBACK_ABOUT, FEEDBACK_ABOUT_LABEL, feedbackMeta, type ClientFeedback, type FeedbackAbout } from "@/lib/client-feedback";
import { FEEDBACK_CHANNELS, FEEDBACK_CHANNEL_LABEL, NOTE_MAX, type FeedbackChannel } from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

function Entry({ clientId, f }: { clientId: string; f: ClientFeedback }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.summary ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setPending(true);
    setError(null);
    const r = await saveFeedbackSummary(clientId, f.id, value);
    setPending(false);
    if (!r.ok) return setError(r.error);
    setEditing(false);
    router.refresh();
  }
  async function remove() {
    if (!window.confirm("Remove this feedback? It leaves the client's page, and the step's thread if it wasn't answered.")) return;
    setPending(true);
    const r = await removeClientFeedback(clientId, f.id);
    setPending(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }
  return (
    <li className="px-lg py-md">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="text-label uppercase tracking-label text-muted">
          {feedbackMeta(f, formatDate)}
          {f.loggedBy ? ` · logged by ${f.loggedBy}` : ""}
        </p>
        {!editing ? (
          <span className="flex gap-sm">
            <button type="button" className="text-body-sm text-primary underline" onClick={() => setEditing(true)}>
              Edit summary
            </button>
            <button type="button" className="text-body-sm text-muted underline" disabled={pending} onClick={() => void remove()}>
              Remove
            </button>
          </span>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-xs">
          <textarea
            className={`${inputClass} min-h-[120px] resize-y normal-case tracking-normal`}
            value={value}
            maxLength={NOTE_MAX}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="mt-xs flex gap-sm">
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void save()}>
              {pending ? "Saving…" : "Save summary"}
            </button>
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-heading">{f.summary || "No summary: drafting uses the original. Edit to write one."}</p>
      )}
      <details className="mt-xs">
        <summary className="cursor-pointer text-body-sm text-primary">What they sent</summary>
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-secondary">{f.original}</p>
      </details>
      {error ? <p className="mt-xs text-body-sm text-error">{error}</p> : null}
    </li>
  );
}

/**
 * Client feedback: what the client told Rupert outside the portal. Logged with
 * the AI's summary, shown to the client under What Rupert Knows (summary only),
 * and used by drafting and the Step 3 search.
 */
export function ClientFeedbackPanel({ clientId, items }: { clientId: string; items: ClientFeedback[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<FeedbackChannel>("email");
  const [about, setAbout] = useState<FeedbackAbout>("general");
  const [on, setOn] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const r = await logClientFeedback(clientId, { text, channel, on, about });
      if (!r.ok) return setMessage({ kind: "error", text: r.error });
      setText("");
      setOpen(false);
      setMessage({ kind: "ok", text: "Logged and summarized. Check the summary: drafting and Step 3 use it, and the client sees it under What Rupert Knows." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="client-feedback" className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-md border-b border-border px-lg py-md">
        <div>
          <h2 id="client-feedback" className="text-h4 text-heading">
            Client feedback
          </h2>
          <p className="text-body-sm text-muted">What they told you outside the portal. They see the summaries under What Rupert Knows.</p>
        </div>
        {!open ? (
          <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>
            Log client feedback
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="border-b border-border px-lg py-md">
          <textarea
            className={`${inputClass} min-h-[140px] resize-y normal-case tracking-normal`}
            value={text}
            maxLength={12000}
            placeholder="Paste their email, or summarize the call."
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-sm flex flex-wrap items-end gap-sm">
            <label className={labelClass}>
              About
              <select className={`${inputClass} mt-xs w-auto normal-case tracking-normal`} value={about} onChange={(e) => setAbout(e.target.value as FeedbackAbout)}>
                {FEEDBACK_ABOUT.map((a) => (
                  <option key={a} value={a}>
                    {FEEDBACK_ABOUT_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              How
              <select className={`${inputClass} mt-xs w-auto normal-case tracking-normal`} value={channel} onChange={(e) => setChannel(e.target.value as FeedbackChannel)}>
                {FEEDBACK_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {FEEDBACK_CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              When
              <input type="date" className={`${inputClass} mt-xs w-auto normal-case tracking-normal`} value={on} onChange={(e) => setOn(e.target.value)} />
            </label>
            <button type="button" className={primaryButton} disabled={pending || !text.trim()} onClick={() => void save()}>
              {pending ? "Summarizing…" : "Log it"}
            </button>
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="mt-xs text-body-sm text-muted">About a step they have open: it also shows in that step&apos;s thread, so you can answer it there.</p>
        </div>
      ) : null}
      {message ? <p className={`px-lg pt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}>{message.text}</p> : null}
      {items.length ? (
        <ul className="divide-y divide-border">
          {items.map((f) => (
            <Entry key={f.id} clientId={clientId} f={f} />
          ))}
        </ul>
      ) : (
        <p className="px-lg py-md text-body-sm text-muted">None logged yet.</p>
      )}
    </section>
  );
}
