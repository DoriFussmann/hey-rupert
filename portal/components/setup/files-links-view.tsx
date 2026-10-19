import { isHttpUrl } from "@/lib/material-fields";
import { fileExtension, formatBytes, type FeedbackLink, type MaterialFile } from "@/lib/setup";

/** Files and links Rupert shared, as the client sees them. Nothing when there are none. */
export function FilesLinksView({
  attachments,
  links,
  fileLinks,
}: {
  attachments: MaterialFile[];
  links: FeedbackLink[];
  /** Signed download links by file path. */
  fileLinks: Record<string, string>;
}) {
  const safeLinks = links.filter((link) => isHttpUrl(link.url));
  if (attachments.length === 0 && safeLinks.length === 0) return null;

  return (
    <section className="rounded-card border border-border bg-surface px-lg py-md">
      <h2 className="text-h4">Files & links from Rupert</h2>
      <ul className="mt-sm divide-y divide-border">
        {attachments.map((file) => (
          <li key={file.path} className="flex flex-wrap items-center gap-md py-sm">
            <span className="rounded-md border border-border px-xs text-label uppercase tracking-label text-muted">
              {fileExtension(file.name) || "file"}
            </span>
            <span className="min-w-0 flex-1 truncate text-body-sm text-heading">{file.name}</span>
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
        {safeLinks.map((link) => (
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
  );
}
