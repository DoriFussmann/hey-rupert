import { MarkdownBody } from "@/components/markdown-body";
import { splitSowSections } from "@/lib/sow-sections";

export function StatementOfWorkDocument({
  content,
}: {
  content: string;
}) {
  const sections = splitSowSections(content);

  if (sections.length === 0) {
    return (
      <p className="text-body-sm text-muted">
        No statement of work has been added yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-sm">
      {sections.map((section, index) => (
        <details
          key={`${section.title}-${index}`}
          className="group rounded-card border border-border bg-surface"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-md px-lg py-sm text-body-sm font-medium text-heading transition-colors duration-hover hover:bg-background [&::-webkit-details-marker]:hidden">
            <span>{section.title}</span>
            <svg
              className="h-4 w-4 shrink-0 text-muted transition-transform duration-hover group-open:rotate-90"
              viewBox="0 0 16 16"
              aria-hidden
            >
              <path fill="currentColor" d="M6.2 3.2a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06L10.19 8 6.2 4.26a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </summary>
          {section.body ? (
            <div className="sow-compact border-t border-border px-lg py-md">
              <MarkdownBody content={section.body} emptyLabel="" />
            </div>
          ) : null}
        </details>
      ))}
    </div>
  );
}
