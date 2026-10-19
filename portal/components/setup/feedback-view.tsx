import { FeedbackChecklist } from "@/components/setup/feedback-checklist";
import { MarkdownBody } from "@/components/markdown-body";
import { isHttpUrl } from "@/lib/material-fields";
import { fileExtension, formatBytes, type FeedbackPublished } from "@/lib/setup";

/**
 * The Analysis & Feedback as the client sees it: Rupert's message, the
 * recommendations checklist, and the files and links. Used by the client's
 * page and by the live preview in the admin, so the two always match.
 */
export function FeedbackView({
  feedback,
  fileLinks,
  doneIds,
  readOnly,
  meta,
}: {
  feedback: FeedbackPublished;
  /** Signed download links by file path. */
  fileLinks: Record<string, string>;
  /** Recommendations the client ticked as done. */
  doneIds: string[];
  readOnly: boolean;
  /** "Shared …" line under From Rupert. */
  meta?: string;
}) {
  const links = feedback.links.filter((link) => isHttpUrl(link.url));

  return (
    <div className="grid gap-lg">
      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-md">
          <p className="text-label uppercase tracking-label text-muted">From Rupert</p>
          {meta ? <p className="mt-xs text-body-sm text-muted">{meta}</p> : null}
        </div>
        {feedback.intro.trim() ? (
          <div className="px-lg py-lg">
            <MarkdownBody content={feedback.intro} emptyLabel="" />
          </div>
        ) : null}
      </section>

      {feedback.items.length > 0 ? (
        <FeedbackChecklist items={feedback.items} initialDone={doneIds} readOnly={readOnly} />
      ) : null}

      {feedback.attachments.length > 0 || links.length > 0 ? (
        <section className="rounded-card border border-border bg-surface px-lg py-md">
          <h2 className="text-h4">Files & links from Rupert</h2>
          <ul className="mt-sm divide-y divide-border">
            {feedback.attachments.map((file) => (
              <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
                <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
                  {fileExtension(file.name) || "file"}
                </span>
                <span className="min-w-0 flex-1 truncate text-body-sm text-heading">
                  {file.name}
                </span>
                <span className="text-body-sm text-muted">{formatBytes(file.size)}</span>
                {fileLinks[file.path] ? (
                  <a
                    href={fileLinks[file.path]}
                    className="text-body-sm text-primary hover:text-primary-hover"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-body-sm text-muted">Link unavailable</span>
                )}
              </li>
            ))}
            {links.map((link) => (
              <li key={link.id} className="py-sm text-body-sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-primary hover:text-primary-hover"
                >
                  {link.label || link.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
