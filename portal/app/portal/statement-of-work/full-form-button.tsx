"use client";

import { useEffect, useId, useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";

export function FullFormButton({ content }: { content: string }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!content.trim()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-sm block rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
      >
        Full Form
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md lg:p-xl">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-heading/20"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[90vh] w-full max-w-[1080px] flex-col overflow-hidden rounded-card border border-border bg-surface"
          >
            <div className="flex items-start justify-between gap-md border-b border-border px-lg py-md">
              <h2 id={titleId} className="text-h4">
                Statement of Work
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-body-sm text-muted transition-colors duration-hover hover:text-heading"
              >
                Close
              </button>
            </div>
            <div className="sow-compact min-h-0 flex-1 overflow-y-auto px-lg py-lg lg:px-xl">
              <MarkdownBody
                content={content}
                emptyLabel="No statement of work has been added yet."
                className="sow-markdown max-w-none"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
