"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { MarkdownBody } from "@/components/markdown-body";
import { AcknowledgeButton } from "@/app/portal/statement-of-work/acknowledge-button";

export function StatementOfWorkPanel({
  content,
  acknowledgedAt,
}: {
  content: string;
  acknowledgedAt?: string | null;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const node = frameRef.current;
      if (!node) return;

      const main = node.closest("main");
      const padBottom = main
        ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0
        : 0;
      const top = node.getBoundingClientRect().top + window.scrollY;
      const next = Math.floor(window.innerHeight - top - padBottom);

      if (next > 0) {
        setHeight((current) => (current === next ? current : next));
      }
    };

    measure();

    const aside = frame.closest("main")?.parentElement?.querySelector("aside");
    const observer = new ResizeObserver(measure);
    if (aside) observer.observe(aside);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div
      ref={frameRef}
      className="flex h-[calc(100dvh-26rem)] flex-col lg:h-[calc(100dvh-5rem)]"
      style={height ? { height } : undefined}
    >
      <div className="shrink-0 pb-md [&>p]:mb-0">
        <BackLink href="/portal/onboarding" label="Onboarding" />
      </div>
      <h1 className="sr-only">Statement of Work</h1>
      <div
        tabIndex={0}
        role="region"
        aria-label="Statement of Work"
        className="sow-compact min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-card border border-border bg-surface px-lg py-lg lg:px-xl"
      >
        <MarkdownBody
          content={content}
          emptyLabel="No statement of work has been added yet."
          className="sow-markdown max-w-none"
        />
      </div>
      {acknowledgedAt !== undefined ? (
        <div className="mt-md shrink-0">
          <AcknowledgeButton acknowledgedAt={acknowledgedAt} />
        </div>
      ) : null}
    </div>
  );
}
