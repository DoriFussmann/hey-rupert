"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminMaterialUpload, registerAdminMaterialFile } from "@/app/admin/materials-actions";
import { INTAKE_FILE_EXTENSIONS, intakeFileProblem } from "@/lib/intake";
import { createClient } from "@/lib/supabase/client";
import { MATERIALS_BUCKET } from "@/lib/setup";

const ACCEPT = INTAKE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

const buttonClass =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Notice = { kind: "ok" | "error"; text: string } | null;

/**
 * Rupert adds files to the client's company materials (for example a deck
 * the founder emailed). They join the client's own files, so Re-analyze all
 * picks them up, and the client sees them under Company Files.
 */
export function AdminMaterialUpload({ clientId }: { clientId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function uploadOne(file: File): Promise<string | null> {
    const problem = intakeFileProblem({ name: file.name, size: file.size });
    if (problem) return problem;
    const ticket = await createAdminMaterialUpload(clientId, { name: file.name, size: file.size });
    if (!ticket.ok) return ticket.error;
    const { error } = await createClient()
      .storage.from(MATERIALS_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
    if (error) return `${file.name}: upload failed (${error.message}).`;
    const saved = await registerAdminMaterialFile(clientId, {
      path: ticket.path,
      name: file.name,
      size: file.size,
      type: file.type,
    });
    return saved.ok ? null : saved.error;
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (files.length === 0) return;
    setNotice(null);
    const errors: string[] = [];
    let added = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      setProgress(files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : "Uploading…");
      try {
        const error = await uploadOne(file);
        if (error) errors.push(error);
        else added += 1;
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : "upload failed."}`);
      }
    }
    setProgress(null);
    if (added > 0) router.refresh();
    setNotice(
      errors.length > 0
        ? { kind: "error", text: [added > 0 ? `${added} added.` : "", ...errors].filter(Boolean).join(" ") }
        : { kind: "ok", text: `${added} file${added === 1 ? "" : "s"} added. Re-analyze all to use ${added === 1 ? "it" : "them"}.` },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-sm">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void onFiles(event.target.files)}
        disabled={progress !== null}
      />
      <button type="button" className={buttonClass} disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress ?? "Upload files"}
      </button>
      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`w-full text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
