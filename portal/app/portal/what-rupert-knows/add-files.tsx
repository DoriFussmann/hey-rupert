"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createMaterialUpload, registerMaterialFile } from "@/app/portal/setup/actions";
import { createClient } from "@/lib/supabase/client";
import {
  MATERIALS_BUCKET,
  MATERIAL_EXTENSIONS,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  fileExtension,
  formatBytes,
} from "@/lib/setup";

const ACCEPT = MATERIAL_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/**
 * The upload box on What Rupert Knows → Your Files: a big "Add Files" target
 * the founder can click or drop onto. Same upload path as Company Files, so
 * Rupert is notified the same way. Greyed when Rupert views as the client.
 */
export function AddFiles({ count, readOnly }: { count: number; readOnly: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [added, setAdded] = useState(0);

  async function uploadOne(file: File): Promise<string | null> {
    const extension = fileExtension(file.name);
    if (!MATERIAL_EXTENSIONS.includes(extension)) return `${file.name}: this file type is not supported.`;
    if (file.size > MATERIAL_MAX_BYTES) return `${file.name}: too large, the limit is ${formatBytes(MATERIAL_MAX_BYTES)}.`;
    if (file.size === 0) return `${file.name}: the file is empty.`;
    try {
      const ticket = await createMaterialUpload({ name: file.name, size: file.size });
      if (!ticket.ok) return `${file.name}: ${ticket.error}`;
      const { error } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
      if (error) return `${file.name}: upload failed (${error.message}).`;
      const saved = await registerMaterialFile({ path: ticket.path, name: file.name, size: file.size, type: file.type });
      return saved.ok ? null : `${file.name}: ${saved.error}`;
    } catch (err) {
      return `${file.name}: ${err instanceof Error ? err.message : "upload failed."}`;
    }
  }

  async function addFiles(list: FileList | File[]) {
    if (readOnly || busy) return;
    const incoming = Array.from(list);
    const room = Math.max(MATERIAL_MAX_FILES - count, 0);
    const problems: string[] = incoming.length > room ? [`You can attach up to ${MATERIAL_MAX_FILES} files.`] : [];
    let done = 0;
    for (const file of incoming.slice(0, room)) {
      setBusy(`Uploading ${file.name}…`);
      const problem = await uploadOne(file);
      if (problem) problems.push(problem);
      else done += 1;
    }
    setBusy(null);
    setErrors(problems);
    setAdded(done);
    if (done > 0) router.refresh();
  }

  return (
    <div className="mb-lg">
      <div
        role="button"
        tabIndex={readOnly ? -1 : 0}
        aria-disabled={readOnly}
        title={readOnly ? "Disabled while viewing as the client" : undefined}
        aria-label="Add files: drop them here or press Enter to browse"
        onClick={() => {
          if (!readOnly && !busy) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (!readOnly && !busy && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!readOnly) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-card border-2 border-dashed px-lg py-xl text-center transition-colors duration-hover ${
          readOnly ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } ${dragging ? "border-primary bg-primary-tint" : "border-primary/40 bg-primary-tint/40 hover:border-primary hover:bg-primary-tint"}`}
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
        <span className="mt-md inline-flex rounded-md bg-primary px-lg py-sm text-body text-white">
          {busy ? "Uploading…" : "Add Files"}
        </span>
        <p className="mt-sm text-body-sm text-heading">
          {busy ?? "Or drag and drop them here. An updated deck or anything new."}
        </p>
        <p className="mt-xs text-body-sm text-muted">
          PDF works best. PowerPoint, Word, Excel, CSV and images also work, up to {formatBytes(MATERIAL_MAX_BYTES)} each.
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
      {added > 0 && !busy ? (
        <p className="mt-sm text-body-sm text-heading">
          {added === 1 ? "File added." : `${added} files added.`} Rupert has been notified.
        </p>
      ) : null}
      {errors.map((problem) => (
        <p key={problem} className="mt-xs text-body-sm text-error">
          {problem}
        </p>
      ))}
    </div>
  );
}
