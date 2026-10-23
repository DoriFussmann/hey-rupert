import { formatDate } from "@/lib/format";
import { fileExtension, formatBytes, type MaterialFile } from "@/lib/setup";

/**
 * What the founder shared, at the top of the client page: one line per file
 * with a download link (signed for an hour; reload the page for fresh links).
 */
export function CompanyMaterialsCard({
  files,
  links,
  noDeck,
}: {
  files: MaterialFile[];
  /** Signed download link per file path. */
  links: Record<string, string>;
  /** The founder's reason for having no deck yet; empty otherwise. */
  noDeck: string;
}) {
  return (
    <section className="mb-lg rounded-card border border-border bg-surface" aria-labelledby="company-materials-title">
      <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
        <h2 id="company-materials-title" className="text-h4 text-heading">
          Company Materials
        </h2>
        <span className="text-body-sm text-muted">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </div>
      {files.length === 0 ? (
        <p className="px-lg py-md text-body-sm text-muted">
          {noDeck ? `No deck yet: "${noDeck}"` : "Nothing shared yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {files.map((file) => (
            <li key={file.path} className="flex flex-wrap items-center justify-between gap-sm px-lg py-sm">
              <span className="flex min-w-0 items-center gap-sm">
                <span className="shrink-0 rounded border border-border px-xs text-label uppercase tracking-label text-muted">
                  {fileExtension(file.name) || "file"}
                </span>
                <span className="truncate text-body-sm text-heading">{file.name}</span>
              </span>
              <span className="flex items-center gap-md text-body-sm text-muted">
                <span>
                  {formatBytes(file.size)}
                  {file.uploaded_at ? ` · ${formatDate(file.uploaded_at)}` : ""}
                </span>
                {links[file.path] ? (
                  <a
                    href={links[file.path]}
                    className="text-primary no-underline hover:text-primary-hover"
                    aria-label={`Download ${file.name}`}
                  >
                    Download
                  </a>
                ) : (
                  <span>Link unavailable</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
