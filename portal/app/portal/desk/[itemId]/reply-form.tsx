"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeDeskItem, createDeskUpload, replyOnDesk } from "@/app/portal/desk/actions";
import { AttachmentsEditor } from "@/components/desk/attachments-editor";
import { BODY_MAX, type DeskAttachment, type DeskStatus } from "@/lib/desk";

const input =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/** The client's reply on an item, and closing it. A reply on a closed item reopens it. */
export function ReplyForm({ itemId, status, readOnly }: { itemId: string; status: DeskStatus; readOnly: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<DeskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = status === "closed";

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) return setError(result.error);
      setBody("");
      setAttachments([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "It could not be saved. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (readOnly) {
    return <p className="px-lg py-md text-body-sm text-muted">This portal is view-only for you, so replies are switched off.</p>;
  }

  return (
    <div className="px-lg py-md">
      <textarea
        className={`${input} min-h-[110px] resize-y`}
        value={body}
        maxLength={BODY_MAX}
        aria-label="Your reply"
        placeholder={closed ? "This item is closed. Replying reopens it." : "Write a reply"}
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="mt-sm">
        <AttachmentsEditor value={attachments} onChange={setAttachments} upload={createDeskUpload} disabled={pending} onBusy={setUploading} />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className={primary}
          disabled={pending || uploading || (!body.trim() && attachments.length === 0)}
          onClick={() => void run(() => replyOnDesk({ itemId, body, attachments }))}
        >
          {pending ? "Sending…" : closed ? "Reply and reopen" : "Reply"}
        </button>
        {!closed ? (
          <button
            type="button"
            className={secondary}
            disabled={pending || uploading || attachments.length > 0}
            title="Closes the item. Anything written above is saved as your closing note."
            onClick={() => void run(() => closeDeskItem({ itemId, note: body }))}
          >
            {body.trim() ? "Close with this note" : "Close: this is settled"}
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
    </div>
  );
}
