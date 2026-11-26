"use client";

import { useRef, useState } from "react";
import { ATTACHMENTS_MAX, deskFileProblem, isDeskUrl, type DeskAttachment } from "@/lib/desk";
import { MATERIALS_BUCKET, MATERIAL_EXTENSIONS, formatBytes } from "@/lib/setup";
import { createClient } from "@/lib/supabase/client";

const ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");
const input =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";
const quiet = "text-body-sm text-primary underline disabled:opacity-40";

export type UploadTicket = { ok: true; path: string; token: string } | { ok: false; error: string };

/** A page of the client's portal Rupert can share, e.g. the investor list. */
export type PortalOutput = { label: string; url: string };

/**
 * The attachments on a Desk message. A client attaches files. Rupert can
 * also add a link or a page of the client's portal, and put any of them on
 * the client's asset shelf under a title (`admin`).
 */
export function AttachmentsEditor({
  value,
  onChange,
  upload,
  disabled = false,
  admin = false,
  outputs = [],
  onBusy,
}: {
  value: DeskAttachment[];
  onChange: (next: DeskAttachment[]) => void;
  /** Asks the server for a one-time upload URL for this file. */
  upload: (file: { name: string; size: number }) => Promise<UploadTicket>;
  disabled?: boolean;
  admin?: boolean;
  outputs?: PortalOutput[];
  /** Told while files are uploading, so the form can hold its Send button. */
  onBusy?: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const full = value.length >= ATTACHMENTS_MAX;

  async function addFiles(list: FileList) {
    if (disabled || busy) return;
    const problems: string[] = [];
    const added: DeskAttachment[] = [];
    onBusy?.(true);
    for (const file of Array.from(list)) {
      if (value.length + added.length >= ATTACHMENTS_MAX) {
        problems.push(`Up to ${ATTACHMENTS_MAX} attachments per message.`);
        break;
      }
      const problem = deskFileProblem({ name: file.name, size: file.size });
      if (problem) {
        problems.push(problem);
        continue;
      }
      setBusy(`Uploading ${file.name}…`);
      try {
        const ticket = await upload({ name: file.name, size: file.size });
        if (!ticket.ok) {
          problems.push(`${file.name}: ${ticket.error}`);
          continue;
        }
        const { error } = await createClient()
          .storage.from(MATERIALS_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
        if (error) {
          problems.push(`${file.name}: upload failed (${error.message}).`);
          continue;
        }
        added.push({ kind: "file", path: ticket.path, name: file.name, size: file.size, type: file.type });
      } catch (err) {
        problems.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
      }
    }
    setBusy(null);
    onBusy?.(false);
    setErrors(problems);
    if (added.length > 0) onChange([...value, ...added]);
  }

  function addLink(next: { url: string; label: string }) {
    const clean = next.url.trim();
    if (!isDeskUrl(clean)) {
      setErrors(["That link doesn't look right. It should start with https://."]);
      return;
    }
    setErrors([]);
    onChange([...value, { kind: "link", url: clean, label: next.label.trim() || clean }]);
    setUrl("");
    setLinkLabel("");
  }

  function update(index: number, next: DeskAttachment | null) {
    onChange(value.flatMap((item, at) => (at === index ? (next ? [next] : []) : [item])));
  }

  return (
    <div>
      {value.length > 0 ? (
        <ul className="mb-sm space-y-xs">
          {value.map((item, index) => (
            <li key={index} className="rounded-md border border-border px-sm py-xs text-body-sm">
              <span className="flex flex-wrap items-center justify-between gap-sm">
                <span className="min-w-0 truncate text-heading">
                  {item.kind === "file" ? item.name : item.label}
                  <span className="ml-sm text-muted">{item.kind === "file" ? formatBytes(item.size) : "link"}</span>
                </span>
                <button type="button" className="text-body-sm text-muted underline" disabled={disabled} onClick={() => update(index, null)}>
                  Remove
                </button>
              </span>
              {admin ? (
                <span className="mt-xs flex flex-wrap items-center gap-sm">
                  <label className="flex items-center gap-xs text-body-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={Boolean(item.asset)}
                      disabled={disabled}
                      onChange={(event) =>
                        update(index, {
                          ...item,
                          asset: event.target.checked
                            ? { title: item.kind === "file" ? item.name.replace(/\.[a-z0-9]+$/i, "") : item.label, version: 1 }
                            : undefined,
                        })
                      }
                    />
                    Put on their asset shelf
                  </label>
                  {item.asset ? (
                    <input
                      className={`${input} max-w-sm`}
                      value={item.asset.title}
                      maxLength={200}
                      aria-label="Asset title"
                      placeholder="Asset title, e.g. The 41 left out, with reasons"
                      disabled={disabled}
                      onChange={(event) => update(index, { ...item, asset: { title: event.target.value, version: 1 } })}
                    />
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-md">
        <button type="button" className={quiet} disabled={disabled || full || Boolean(busy)} onClick={() => inputRef.current?.click()}>
          {busy ?? "Attach files"}
        </button>
        {admin && outputs.length > 0 ? (
          <select
            className="cursor-pointer rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body outline-none focus:border-primary"
            value=""
            disabled={disabled || full}
            aria-label="Share a page of the client's portal"
            onChange={(event) => {
              const picked = outputs.find((output) => output.url === event.target.value);
              if (picked) {
                onChange([...value, { kind: "link", url: picked.url, label: picked.label, asset: { title: picked.label, version: 1 } }]);
              }
            }}
          >
            <option value="">Share from their portal…</option>
            {outputs.map((output) => (
              <option key={output.url} value={output.url}>
                {output.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {admin ? (
        <div className="mt-sm flex flex-wrap items-center gap-sm">
          <input
            className={`${input} max-w-xs`}
            value={url}
            placeholder="Paste a link (https://…)"
            aria-label="Link"
            maxLength={2000}
            disabled={disabled || full}
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            className={`${input} max-w-xs`}
            value={linkLabel}
            placeholder="What it is"
            aria-label="Link label"
            maxLength={200}
            disabled={disabled || full}
            onChange={(event) => setLinkLabel(event.target.value)}
          />
          <button type="button" className={quiet} disabled={disabled || full || !url.trim()} onClick={() => addLink({ url, label: linkLabel })}>
            Add link
          </button>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {errors.map((problem) => (
        <p key={problem} className="mt-xs text-body-sm text-error">
          {problem}
        </p>
      ))}
    </div>
  );
}
