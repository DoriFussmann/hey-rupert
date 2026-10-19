"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import "@uiw/react-md-editor/markdown-editor.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => <div className="min-h-[200px] rounded-md border border-border bg-background" />,
});

/** Markdown editor without a formatting toolbar. Edit by default; Preview shows the rendered text. */
export function MarkdownField({
  value,
  onChange,
  height = 320,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  /** Accessible name for the editor. */
  label: string;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="sow-editor" data-color-mode="light">
      <div className="mb-sm flex justify-end">
        <button
          type="button"
          className="rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
          onClick={() => setPreview((current) => !current)}
          aria-pressed={preview}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? "")}
        height={height}
        visibleDragbar={false}
        preview={preview ? "preview" : "edit"}
        hideToolbar
        extraCommands={[]}
        textareaProps={{ "aria-label": label }}
      />
    </div>
  );
}
