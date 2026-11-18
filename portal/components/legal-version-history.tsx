import Link from "next/link";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDate } from "@/lib/format";
import { changedLines, type VersionClient } from "@/lib/legal-versions";
import type { LegalHistory } from "@/lib/legal-versions-server";

// Every saved version of a legal document, newest first, with the clients on
// each. Server-rendered; the text and the changes open in place.

function ClientList({ clients, done, waiting }: { clients: VersionClient[]; done: string; waiting: string }) {
  if (clients.length === 0) return <p className="mt-sm text-body-sm text-muted">No clients.</p>;
  return (
    <ul className="mt-sm space-y-xs text-body-sm">
      {clients.map((client) => (
        <li key={client.client_id} className={client.current ? "text-body" : "text-muted"}>
          <Link href={`/admin/clients/${client.client_id}`} className="text-primary hover:text-primary-hover">
            {client.company_name || "Unnamed client"}
          </Link>
          {" · "}
          {client.current
            ? client.completed_at
              ? `${done} ${formatDate(client.completed_at)}`
              : `${waiting}, sent ${formatDate(client.sent_at)}`
            : `Replaced, sent ${formatDate(client.sent_at)}`}
          {client.customized ? (
            <span className="ml-sm rounded-full border border-border px-sm py-[1px] text-[12px] text-secondary">
              Custom terms
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function LegalVersionHistory({
  history,
  error,
  done,
  waiting,
}: {
  history: LegalHistory | null;
  error?: string | null;
  /** "Signed" or "Confirmed". */
  done: string;
  /** "Not signed" or "Not confirmed". */
  waiting: string;
}) {
  return (
    <section className="mt-lg rounded-card border border-border bg-surface p-lg">
      <h2 className="text-h4 text-heading">Versions</h2>
      {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
      {history && history.versions.length === 0 && !error ? (
        <p className="mt-sm text-body-sm text-muted">No versions yet. The first save creates version 1.</p>
      ) : null}
      {history?.versions.map((version, index) => {
        const previous = history.versions[index + 1] ?? null;
        const changes = previous ? changedLines(previous.content, version.content) : [];
        const active = version.version === history.activeVersion;
        return (
          <div key={version.version} className="mt-md border-t border-border pt-md">
            <div className="flex flex-wrap items-baseline gap-sm">
              <p className="text-body text-heading" style={{ fontWeight: 500 }}>
                Version {version.version}
              </p>
              {active ? (
                <span className="rounded-full px-sm py-[1px] text-[12px]" style={{ backgroundColor: "#eaf4ee", color: "#0e5e4f", border: "1px solid #a8d2c6" }}>
                  In use
                </span>
              ) : null}
              <p className="text-body-sm text-muted">
                {formatDate(version.created_at)}
                {version.created_by && version.created_by !== "history" ? ` · ${version.created_by}` : ""}
              </p>
            </div>
            {version.note ? <p className="mt-xs text-body-sm text-secondary">{version.note}</p> : null}
            <p className="mt-sm text-label uppercase tracking-label text-muted">
              Clients on this version ({version.clients.filter((client) => client.current).length})
            </p>
            <ClientList clients={version.clients} done={done} waiting={waiting} />
            {previous ? (
              <details className="mt-sm">
                <summary className="cursor-pointer text-body-sm text-primary">
                  Changes from version {previous.version} ({changes.length})
                </summary>
                <div className="mt-sm space-y-xs rounded-md border border-border bg-background p-md text-body-sm">
                  {changes.length === 0 ? <p className="text-muted">No text changes.</p> : null}
                  {changes.map((line, lineIndex) => (
                    <p
                      key={lineIndex}
                      style={
                        line.kind === "added"
                          ? { backgroundColor: "#eaf4ee", color: "#0e5e4f" }
                          : { backgroundColor: "#fbeeee", color: "#8a2a2a", textDecoration: "line-through" }
                      }
                      className="rounded px-sm py-[2px]"
                    >
                      {line.kind === "added" ? "+ " : "− "}
                      {line.text}
                    </p>
                  ))}
                </div>
              </details>
            ) : null}
            <details className="mt-sm">
              <summary className="cursor-pointer text-body-sm text-primary">Full text</summary>
              <div className="mt-sm rounded-md border border-border bg-background p-lg">
                <MarkdownBody content={version.content} emptyLabel="" />
              </div>
            </details>
          </div>
        );
      })}
      {history && history.unversioned.length > 0 ? (
        <div className="mt-md border-t border-border pt-md">
          <p className="text-body text-heading" style={{ fontWeight: 500 }}>
            No recorded version
          </p>
          <ClientList clients={history.unversioned} done={done} waiting={waiting} />
        </div>
      ) : null}
    </section>
  );
}
