"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownBody({
  content,
  emptyLabel,
}: {
  content: string;
  emptyLabel: string;
}) {
  if (!content.trim()) {
    return <p className="text-body-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <div className="sow-markdown max-w-prose">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
