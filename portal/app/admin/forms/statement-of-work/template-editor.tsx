"use client";

import { useState } from "react";
import { saveFormTemplate } from "@/app/admin/actions";
import { MarkdownBody } from "@/components/markdown-body";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import { STATEMENT_OF_WORK_SLUG } from "@/lib/form-fields";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm text-body outline-none";

export function StatementOfWorkTemplateEditor({
  initialContent,
}: {
  initialContent: string;
}) {
  const [value, setValue] = useState(initialContent);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash("sow-template");

  async function onSave() {
    setPending(true);
    setAdminFlash("sow-template", null);

    try {
      const result = await saveFormTemplate(STATEMENT_OF_WORK_SLUG, value);
      if (!result.ok) {
        setAdminFlash("sow-template", {
          kind: "error",
          text: result.error,
        });
        return;
      }
      setAdminFlash("sow-template", { kind: "ok", text: "Saved." });
    } catch (err) {
      setAdminFlash("sow-template", {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to save.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-card border border-border bg-surface p-lg">
      <p className="text-body-sm text-muted">
        Edit the Statement of Work below. Headings, lists and emphasis are
        formatted when you generate and send it to a client.
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
          {pending ? "Saving…" : "Save"}
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
