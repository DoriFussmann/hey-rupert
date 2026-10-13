"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMaterialUpload,
  registerMaterialFile,
  removeMaterialFile,
  saveMaterialsText,
  submitMaterials,
} from "@/app/portal/setup/actions";
import { createClient } from "@/lib/supabase/client";
import {
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  fileExtension,
  formatBytes,
  type MaterialFile,
  type MaterialsPayload,
} from "@/lib/setup";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary disabled:opacity-60";

type Upload = { id: string; name: string; state: "uploading" | "error"; error?: string };

const ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");

export function MaterialsWorkspace({
  initial,
  links,
  submitted,
  readOnly,
}: {
  initial: MaterialsPayload;
  links: Record<string, string>;
  submitted: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Set once the client submits, so a late draft save cannot show an error.
  const submittedRef = useRef(false);
  const [files, setFiles] = useState<MaterialFile[]>(initial.files);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [companyText, setCompanyText] = useState(initial.company_text);
  const [otherInputs, setOtherInputs] = useState(initial.other_inputs);
  const [dragging, setDragging] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedText, setSavedText] = useState({
    company: initial.company_text,
    other: initial.other_inputs,
  });

  const locked = submitted || readOnly;
  const busy = uploads.some((upload) => upload.state === "uploading");

  async function uploadOne(file: File) {
    const id = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
    const extension = fileExtension(file.name);
    const localError = !MATERIAL_EXTENSIONS.includes(extension)
      ? "This file type is not supported."
      : file.size > MATERIAL_MAX_BYTES
        ? `Too large (${formatBytes(file.size)}). The limit is ${formatBytes(MATERIAL_MAX_BYTES)}.`
        : file.size === 0
          ? "The file is empty."
          : null;

    if (localError) {
      setUploads((current) => [
        ...current,
        { id, name: file.name, state: "error", error: localError },
      ]);
      return;
    }

    setUploads((current) => [...current, { id, name: file.name, state: "uploading" }]);
    const fail = (message: string) =>
      setUploads((current) =>
        current.map((upload) =>
          upload.id === id ? { ...upload, state: "error", error: message } : upload,
        ),
      );

    try {
      const ticket = await createMaterialUpload({ name: file.name, size: file.size });
      if (!ticket.ok) return fail(ticket.error);

      const { error: uploadError } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || undefined,
        });
      if (uploadError) return fail(`Upload failed: ${uploadError.message}`);

      const saved = await registerMaterialFile({
        path: ticket.path,
        name: file.name,
        size: file.size,
        type: file.type,
      });
      if (!saved.ok) return fail(saved.error);

      setFiles((current) => [...current, saved.file]);
      setUploads((current) => current.filter((upload) => upload.id !== id));
    } catch (err) {
      fail(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  async function addFiles(list: FileList | File[]) {
    if (locked) return;
    setError(null);
    const incoming = Array.from(list);
    const room = MATERIAL_MAX_FILES - files.length - uploads.filter((u) => u.state === "uploading").length;
    if (incoming.length > room) {
      setError(`You can attach up to ${MATERIAL_MAX_FILES} files.`);
    }
    // One at a time keeps the draft updates in order.
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      await uploadOne(file);
    }
  }

  async function onRemove(path: string) {
    if (locked) return;
    setError(null);
    const previous = files;
    setFiles((current) => current.filter((file) => file.path !== path));
    const result = await removeMaterialFile(path);
    if (!result.ok) {
      setFiles(previous);
      setError(result.error);
    }
  }

  async function saveText() {
    if (locked) return;
    if (companyText === savedText.company && otherInputs === savedText.other) return;
    setSaveState("saving");
    const result = await saveMaterialsText({
      company_text: companyText,
      other_inputs: otherInputs,
    });
    if (submittedRef.current) return;
    if (!result.ok) {
      setSaveState("idle");
      setError(result.error);
      return;
    }
    setSavedText({ company: companyText, other: otherInputs });
    setSaveState("saved");
  }

  async function onSubmit() {
    if (locked || submitting || busy) return;
    if (files.length === 0 && !companyText.trim()) {
      setError("Upload your pitch deck or paste a description of the company first.");
      return;
    }
    if (
      !window.confirm(
        "Submit your materials to Rupert? After this it's Rupert's turn. If he needs anything else, he'll reopen this for you.",
      )
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitMaterials({
        company_text: companyText,
        other_inputs: otherInputs,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      submittedRef.current = true;
      setError(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-lg">
      {/* Files */}
      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-md">
          <h2 className="text-h4">Pitch deck & files</h2>
          <p className="mt-xs text-body-sm text-muted">
            Your latest pitch deck first. Add one-pagers, financial summaries or
            anything else useful. PDF, PowerPoint, Keynote, Word, Excel, CSV or
            images, up to {formatBytes(MATERIAL_MAX_BYTES)} each.
          </p>
        </div>

        {!locked ? (
          <div className="px-lg pt-lg">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload files: drop them here or press Enter to browse"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (event.dataTransfer.files.length > 0) {
                  void addFiles(event.dataTransfer.files);
                }
              }}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-lg py-xl text-center transition-colors duration-hover ${
                dragging
                  ? "border-primary bg-primary-tint"
                  : "border-border bg-background hover:border-primary/50"
              }`}
            >
              <svg className="h-8 w-8 text-primary" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
                />
              </svg>
              <p className="mt-sm text-body-sm text-heading">
                Drag & drop files here, or <span className="text-primary">browse</span>
              </p>
              <p className="mt-xs text-body-sm text-muted">
                {files.length} of {MATERIAL_MAX_FILES} files attached
              </p>
            </div>
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
          </div>
        ) : null}

        <ul className="divide-y divide-border px-lg py-md">
          {files.length === 0 && uploads.length === 0 ? (
            <li className="py-sm text-body-sm text-muted">No files attached.</li>
          ) : null}
          {files.map((file) => (
            <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
              <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                {fileExtension(file.name) || "file"}
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                {links[file.path] ? (
                  <a href={links[file.path]} className="text-heading hover:text-primary">
                    {file.name}
                  </a>
                ) : (
                  file.name
                )}
              </span>
              <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
              {!locked ? (
                <button
                  type="button"
                  onClick={() => onRemove(file.path)}
                  className="text-body-sm text-muted hover:text-error"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
          {uploads.map((upload) => (
            <li key={upload.id} className="flex flex-wrap items-center gap-md py-sm">
              <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                {upload.name}
              </span>
              {upload.state === "uploading" ? (
                <span className="text-body-sm text-muted">Uploading…</span>
              ) : (
                <>
                  <span className="text-body-sm text-error">{upload.error}</span>
                  <button
                    type="button"
                    className="text-body-sm text-muted hover:text-heading"
                    onClick={() =>
                      setUploads((current) => current.filter((item) => item.id !== upload.id))
                    }
                  >
                    Dismiss
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Text */}
      <section className="rounded-card border border-border bg-surface px-lg py-lg">
        <label className="block text-label uppercase tracking-label text-muted">
          About the company
          <span className="mt-xs block text-body-sm normal-case tracking-normal text-muted">
            Paste your one-pager, website copy, or describe the company in your
            own words: what you do, for whom, and why now.
          </span>
          <textarea
            rows={10}
            className={fieldClass}
            value={companyText}
            disabled={locked}
            onChange={(event) => {
              setCompanyText(event.target.value);
              setSaveState("idle");
            }}
            onBlur={saveText}
          />
        </label>

        <label className="mt-lg block text-label uppercase tracking-label text-muted">
          Anything else
          <span className="mt-xs block text-body-sm normal-case tracking-normal text-muted">
            Links (data room, product demo, press), recent wins, investors
            you&apos;re already talking to, or anything Rupert should keep in mind.
          </span>
          <textarea
            rows={6}
            className={fieldClass}
            value={otherInputs}
            disabled={locked}
            onChange={(event) => {
              setOtherInputs(event.target.value);
              setSaveState("idle");
            }}
            onBlur={saveText}
          />
        </label>
      </section>

      {!submitted ? (
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            className={primaryButton}
            onClick={onSubmit}
            disabled={locked || submitting || busy}
          >
            {submitting ? "Submitting…" : "Submit to Rupert"}
          </button>
          <button
            type="button"
            className={secondaryButton}
            onClick={saveText}
            disabled={locked || saveState === "saving"}
          >
            {saveState === "saving" ? "Saving…" : "Save draft"}
          </button>
          {saveState === "saved" ? (
            <p className="text-body-sm text-success">Saved.</p>
          ) : null}
          {busy ? <p className="text-body-sm text-muted">Waiting for uploads to finish…</p> : null}
          {readOnly ? (
            <p className="text-body-sm text-muted">Preview only: actions are disabled.</p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
