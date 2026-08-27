"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownBody({
  content,
  emptyLabel,
  className,
}: {
  content: string;
  emptyLabel: string;
  className?: string;
}) {
  if (!content.trim()) {
    if (!emptyLabel) return null;
    return <p className="text-body-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <div className={className ?? "sow-markdown max-w-prose"}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
