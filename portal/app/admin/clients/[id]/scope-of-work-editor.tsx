"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { updateScopeOfWork } from "@/app/admin/actions";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import "@uiw/react-md-editor/markdown-editor.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[300px] rounded-md border border-border bg-background" />
  ),
});

export function ScopeOfWorkEditor({
  clientId,
  content,
}: {
  clientId: string;
  content: string;
}) {
  const [value, setValue] = useState(content);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash("sow");

  async function onSave() {
    setPending(true);
    setAdminFlash("sow", null);

    try {
      const result = await updateScopeOfWork(clientId, value);

      if (!result?.ok) {
        setAdminFlash("sow", {
          kind: "error",
          text: result?.error ?? "Unable to save.",
        });
        return;
      }

      setAdminFlash("sow", { kind: "ok", text: "Saved." });
    } catch (err) {
      setAdminFlash("sow", {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to save.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-lg rounded-card border border-border bg-surface p-lg">
      <h2 className="text-h4">Scope of Work</h2>
      <div className="sow-editor mt-md" data-color-mode="light">
        <MDEditor
          value={value}
          onChange={(next) => setValue(next ?? "")}
          height={320}
          visibleDragbar={false}
          preview="live"
        />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save Scope of Work"}
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
