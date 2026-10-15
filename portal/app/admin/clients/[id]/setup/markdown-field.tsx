"use client";

import dynamic from "next/dynamic";
import "@uiw/react-md-editor/markdown-editor.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => <div className="min-h-[200px] rounded-md border border-border bg-background" />,
});

/** Markdown editor with live preview, as used across the Setup panels. */
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
  return (
    <div className="sow-editor" data-color-mode="light">
      <MDEditor
        value={value}
        onChange={(next) => onChange(next ?? "")}
        height={height}
        visibleDragbar={false}
        preview="live"
        textareaProps={{ "aria-label": label }}
      />
    </div>
  );
}
