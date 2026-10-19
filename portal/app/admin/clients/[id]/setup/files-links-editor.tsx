"use client";

import { useRef, useState } from "react";
import { createSetupUpload } from "@/app/admin/agent-actions";
import { inputClass } from "@/app/admin/clients/[id]/setup/shared";
import { isHttpUrl } from "@/lib/material-fields";
import { createClient } from "@/lib/supabase/client";
import {
  FEEDBACK_LINKS_MAX,
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  fileExtension,
  formatBytes,
  type FeedbackLink,
  type MaterialFile,
} from "@/lib/setup";

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function newLinkId() {
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Files and links Rupert shares with the feedback or the narrative. Files
 * upload straight to private storage; they become part of the draft once it
 * is saved or sent.
 */
export function FilesLinksEditor({
  clientId,
  attachments,
  links,
  fileLinks,
  disabled,
  onChange,
}: {
  clientId: string;
  attachments: MaterialFile[];
  links: FeedbackLink[];
  /** Signed download links for files already saved. */
  fileLinks: Record<string, string>;
  disabled: boolean;
  onChange: (patch: { attachments?: MaterialFile[]; links?: FeedbackLink[] }) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function onUpload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const ticket = await createSetupUpload(clientId, { name: file.name, size: file.size });
      if (!ticket.ok) {
        setMessage({ kind: "error", text: ticket.error });
        return;
      }
      const { error } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });
      if (error) {
        setMessage({ kind: "error", text: `Upload failed: ${error.message}` });
        return;
      }
      onChange({
        attachments: [
          ...attachments,
          {
            path: ticket.path,
            name: file.name.slice(0, 255),
            size: file.size,
            type: file.type.slice(0, 120),
            uploaded_at: new Date().toISOString(),
          },
        ],
      });
      setMessage({ kind: "ok", text: `${file.name} attached. Save the draft to keep it.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Upload failed." });
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <h4 className="text-h4">Files & links</h4>
      <p className="mt-xs text-body-sm text-muted">
        Shown to the client in their portal with this version.
      </p>
      {attachments.length + links.length > 0 ? (
        <ul className="mt-sm divide-y divide-border">
          {attachments.map((file) => (
            <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
              <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                {fileExtension(file.name) || "file"}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                {fileLinks[file.path] ? (
                  <a href={fileLinks[file.path]} className="text-heading hover:text-primary">
                    {file.name}
                  </a>
                ) : (
                  file.name
                )}
              </span>
              <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="text-body-sm text-muted hover:text-error"
                onClick={() =>
                  onChange({ attachments: attachments.filter((other) => other.path !== file.path) })
                }
              >
                Remove
              </button>
            </li>
          ))}
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-sm py-sm">
              <input
                className={`${inputClass} sm:w-56`}
                value={link.label}
                maxLength={200}
                placeholder="Label (optional)"
                aria-label="Link label"
                onChange={(event) =>
                  onChange({
                    links: links.map((other) =>
                      other.id === link.id ? { ...other, label: event.target.value } : other,
                    ),
                  })
                }
              />
              <input
                className={`${inputClass} min-w-0 flex-1`}
                value={link.url}
                maxLength={2000}
                type="url"
                placeholder="https://"
                aria-label="Link URL"
                aria-invalid={Boolean(link.url) && !isHttpUrl(link.url)}
                onChange={(event) =>
                  onChange({
                    links: links.map((other) =>
                      other.id === link.id ? { ...other, url: event.target.value } : other,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-body-sm text-muted hover:text-error"
                onClick={() => onChange({ links: links.filter((other) => other.id !== link.id) })}
              >
                Remove
              </button>
              {link.url && !isHttpUrl(link.url) ? (
                <p className="w-full text-body-sm text-error">
                  Use a full link starting with https://. Invalid links are not saved.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-sm flex flex-wrap gap-sm">
        <button
          type="button"
          className={smallButton}
          disabled={disabled || uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? "Uploading…" : "Attach file"}
        </button>
        <button
          type="button"
          className={smallButton}
          disabled={disabled || links.length >= FEEDBACK_LINKS_MAX}
          onClick={() => onChange({ links: [...links, { id: newLinkId(), label: "", url: "" }] })}
        >
          Add link
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onUpload(file);
          }}
        />
      </div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
