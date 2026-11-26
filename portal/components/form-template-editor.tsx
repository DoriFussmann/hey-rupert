"use client";
import { askConfirm } from "@/components/confirm-dialog";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveFormTemplate } from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import type { FormSlug } from "@/lib/form-fields";
import { LEGAL_NOTE_MAX } from "@/lib/legal-versions";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm text-body outline-none";

export function FormTemplateEditor({
  slug,
  title,
  initialContent,
  defaultContent,
  note,
}: {
  slug: FormSlug;
  title: string;
  initialContent: string;
  defaultContent: string;
  note?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialContent);
  const [change, setChange] = useState("");
  const [pending, setPending] = useState(false);
  const flashKey = `${slug}-template`;
  const flash = useAdminFlash(flashKey);

  async function onSave() {
    setPending(true);
    setAdminFlash(flashKey, null);

    try {
      const result = await saveFormTemplate(slug, value, change);
      if (!result.ok) {
        setAdminFlash(flashKey, { kind: "error", text: result.error });
        return;
      }
      setAdminFlash(flashKey, {
        kind: "ok",
        text: result.unchanged
          ? `No changes. Version ${result.version} is still in use.`
          : `Saved as version ${result.version}. Documents already sent keep their version.`,
      });
      if (!result.unchanged) setChange("");
      router.refresh();
    } catch (err) {
      setAdminFlash(flashKey, {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to save.",
      });
    } finally {
      setPending(false);
    }
  }

  async function onRestoreDefault() {
    if (value === defaultContent) return;
    const confirmed = (await askConfirm(
      `Replace the text with the default ${title}? Nothing is saved until you click Save.`,
    ));
    if (!confirmed) return;
    setValue(defaultContent);
    setAdminFlash(flashKey, {
      kind: "ok",
      text: "Default restored. Click Save to keep it.",
    });
  }

  return (
    <section className="rounded-card border border-border bg-surface p-lg">
      <p className="text-body-sm text-muted">
        Edit the {title} below. Headings, lists and emphasis are formatted when
        you generate and send it to a client.
        {note ? ` ${note}` : ""}
      </p>
      <div className="mt-lg space-y-lg">
        <label className="block text-label uppercase tracking-label text-muted">
          Document
          <textarea
            className={`${fieldClass} min-h-[640px] resize-y`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck
          />
        </label>
        <label className="block text-label uppercase tracking-label text-muted">
          What changed (kept with the version)
          <input
            className={fieldClass}
            value={change}
            maxLength={LEGAL_NOTE_MAX}
            onChange={(event) => setChange(event.target.value)}
          />
        </label>
        <div>
          <p className="text-label uppercase tracking-label text-muted">
            Preview
          </p>
          <div className="mt-sm rounded-md border border-border bg-background p-lg">
            <MarkdownBody content={value} emptyLabel="Nothing to preview." />
          </div>
        </div>
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save as New Version"}
        </button>
        <button
          type="button"
          onClick={onRestoreDefault}
          disabled={pending}
          className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
        >
          Restore Default
        </button>
        {flash?.kind === "ok" ? (
          <p className="text-body-sm text-success">{flash.text}</p>
        ) : null}
        {flash?.kind === "error" ? (
          <p className="text-body-sm text-error">{flash.text}</p>
        ) : null}
      </div>
    </section>
  );
}
