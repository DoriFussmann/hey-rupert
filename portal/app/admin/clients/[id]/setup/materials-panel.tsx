"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenMaterials } from "@/app/admin/setup-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  asMaterials,
  fileExtension,
  formatBytes,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";
import {
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";

export function MaterialsPanel({
  clientId,
  item,
  row,
  links,
  canReopen,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  links: Record<string, string>;
  /** False once the framing is with the client. */
  canReopen: boolean;
}) {
  const router = useRouter();
  const submitted = row?.status === "submitted";
  const materials = asMaterials(submitted ? row?.published : row?.draft);
  const [showReopen, setShowReopen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onReopen() {
    setPending(true);
    setMessage(null);
    try {
      const result = await reopenMaterials(clientId, note);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setNote("");
      setShowReopen(false);
      setMessage(
        result.clientEmail.ok
          ? { kind: "ok", text: "Sent back to the client, and they were emailed." }
          : {
              kind: "error",
              text: `Sent back to the client, but the email failed. ${result.clientEmail.reason}`,
            },
      );
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to reopen." });
    } finally {
      setPending(false);
    }
  }

  const empty =
    materials.files.length === 0 && !materials.company_text && !materials.other_inputs;

  return (
    <StepFrame
      item={item}
      intro={
        submitted
          ? `Submitted ${row?.published_at ? formatDateAtTime(row.published_at) : ""}. Download the files, then write your comments and the message framing below.`
          : "The client uploads their deck and shares company details here, then submits. Below is what they have added so far."
      }
    >
      <div className="px-lg py-md">
        {empty ? (
          <p className="text-body-sm text-muted">Nothing added yet.</p>
        ) : null}

        {materials.files.length > 0 ? (
          <>
            <p className="text-label uppercase tracking-label text-muted">
              Files ({materials.files.length})
            </p>
            <ul className="mt-sm divide-y divide-border rounded-md border border-border">
              {materials.files.map((file) => (
                <li key={file.path} className="flex flex-wrap items-center gap-md px-md py-sm">
                  <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                    {fileExtension(file.name) || "file"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                    {file.name}
                  </span>
                  <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
                  {links[file.path] ? (
                    <a href={links[file.path]} className="text-body-sm text-primary hover:text-primary-hover">
                      Download
                    </a>
                  ) : (
                    <span className="text-body-sm text-muted">Link unavailable</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {materials.company_text ? (
          <div className="mt-md">
            <p className="text-label uppercase tracking-label text-muted">About the company</p>
            <p className="mt-xs max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">
              {materials.company_text}
            </p>
          </div>
        ) : null}

        {materials.other_inputs ? (
          <div className="mt-md">
            <p className="text-label uppercase tracking-label text-muted">Anything else</p>
            <p className="mt-xs max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">
              {materials.other_inputs}
            </p>
          </div>
        ) : null}
      </div>

      {submitted ? (
        <div className="border-t border-border px-lg py-md">
          {showReopen ? (
            <>
              <label className="block text-label uppercase tracking-label text-muted">
                What do you need from the client?
                <textarea
                  className={`${inputClass} mt-sm normal-case tracking-normal`}
                  rows={3}
                  maxLength={4000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Please upload the latest deck (v5) and your financial summary."
                />
              </label>
              <div className="mt-sm flex flex-wrap gap-sm">
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={pending || !note.trim()}
                  onClick={onReopen}
                >
                  {pending ? "Sending…" : "Send back to client"}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={pending}
                  onClick={() => setShowReopen(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className={secondaryButton}
              disabled={!canReopen}
              title={
                canReopen
                  ? "Makes it the client's turn again, with your note"
                  : "The framing is already with the client; ask by email instead."
              }
              onClick={() => setShowReopen(true)}
            >
              Ask the client for more
            </button>
          )}
          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </StepFrame>
  );
}
