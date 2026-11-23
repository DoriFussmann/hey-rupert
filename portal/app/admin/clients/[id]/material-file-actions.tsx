"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { removeAdminMaterialFile } from "@/app/admin/materials-actions";
import { ACCEPT, uploadAdminMaterial } from "@/app/admin/clients/[id]/admin-material-upload";

const linkButton =
  "text-body-sm text-primary transition-colors duration-hover hover:text-primary-hover disabled:opacity-40";

/**
 * Per-file Replace and Remove on the Company Materials card. Replace uploads
 * the new file first and removes the old one only once it is in, so a failed
 * upload never loses the original.
 */
export function MaterialFileActions({
  clientId,
  path,
  name,
}: {
  clientId: string;
  path: string;
  name: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"replace" | "remove" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy("remove");
    setError(null);
    try {
      const result = await removeAdminMaterialFile(clientId, path);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the file.");
    } finally {
      setBusy(null);
      setConfirming(false);
    }
  }

  async function replace(list: FileList | null) {
    const file = list?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    setBusy("replace");
    setError(null);
    try {
      const uploadError = await uploadAdminMaterial(clientId, file);
      if (uploadError) {
        setError(uploadError);
        return;
      }
      const removed = await removeAdminMaterialFile(clientId, path);
      if (!removed.ok) {
        setError(`${file.name} was added, but ${name} could not be removed: ${removed.error}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not replace the file.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-md">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void replace(event.target.files)}
      />
      {confirming ? (
        <>
          <span className="text-body-sm text-heading">Remove {name}?</span>
          <button type="button" className="text-body-sm text-error disabled:opacity-40" disabled={busy !== null} onClick={() => void remove()}>
            {busy === "remove" ? "Removing…" : "Yes, remove"}
          </button>
          <button type="button" className={linkButton} disabled={busy !== null} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className={linkButton}
            disabled={busy !== null}
            onClick={() => input.current?.click()}
            aria-label={`Replace ${name} with a newer file`}
          >
            {busy === "replace" ? "Replacing…" : "Replace"}
          </button>
          <button
            type="button"
            className={linkButton}
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
            aria-label={`Remove ${name}`}
          >
            Remove
          </button>
        </>
      )}
      {error ? (
        <span role="alert" className="w-full text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
