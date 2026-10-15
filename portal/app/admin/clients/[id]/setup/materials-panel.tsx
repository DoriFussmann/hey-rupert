"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenMaterials } from "@/app/admin/setup-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  isHttpUrl,
  labelledAnswers,
  type MaterialField,
} from "@/lib/material-fields";
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

// Formats the AI cannot read: the admin should ask for a PDF.
const NEEDS_PDF = new Set(["key", "ppt", "doc"]);

export function MaterialsPanel({
  clientId,
  item,
  row,
  fields,
  links,
  canReopen,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  fields: MaterialField[];
  links: Record<string, string>;
  /** False once the outreach narrative is with the client. */
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

  const answers = labelledAnswers(fields, materials.fields);
  const empty = materials.files.length === 0 && answers.length === 0;

  return (
    <StepFrame
      item={item}
      intro={
        submitted
          ? `Submitted ${row?.published_at ? formatDateAtTime(row.published_at) : ""}. Run Analyze below to review everything with the AI.`
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
                  {NEEDS_PDF.has(fileExtension(file.name)) ? (
                    <span className="text-body-sm text-warning">
                      The AI can&apos;t read this. Ask the client for a PDF.
                    </span>
                  ) : null}
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

        {answers.map((answer) => (
          <div key={answer.id} className="mt-md">
            <p className="text-label uppercase tracking-label text-muted">{answer.label}</p>
            {answer.type === "url" && isHttpUrl(answer.value) ? (
              <p className="mt-xs break-all text-body-sm">
                <a
                  href={answer.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-primary-hover"
                >
                  {answer.value}
                </a>
              </p>
            ) : (
              <p className="mt-xs max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">
                {answer.value}
              </p>
            )}
          </div>
        ))}
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
                  : "The outreach narrative is already with the client; ask by email instead."
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
