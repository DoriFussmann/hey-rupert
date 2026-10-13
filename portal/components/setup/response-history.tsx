import { formatDateAtTime } from "@/lib/format";
import type { SetupHistoryEntry } from "@/lib/setup";

/**
 * Earlier rounds of a review step: what was pushed and how the client
 * answered. The current round is shown by the page itself, so only rounds
 * before `currentVersion` are listed.
 */
export function ResponseHistory({
  history,
  currentVersion,
  who = "You",
}: {
  history: SetupHistoryEntry[];
  currentVersion: number;
  who?: string;
}) {
  const earlier = history
    .filter((entry) => entry.version < currentVersion && entry.response)
    .sort((a, b) => b.version - a.version);
  if (earlier.length === 0) return null;

  return (
    <details className="mt-lg rounded-card border border-border bg-surface px-lg py-md">
      <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
        Earlier rounds ({earlier.length})
      </summary>
      <ol className="mt-md space-y-md">
        {earlier.map((entry) => {
          const response = entry.response!;
          const notes = Object.entries(response.item_notes);
          return (
            <li key={entry.version} className="text-body-sm">
              <p className="text-label uppercase tracking-label text-muted">
                Version {entry.version} · sent {formatDateAtTime(entry.published_at)}
              </p>
              <p className="mt-xs text-heading">
                {who}{" "}
                {response.decision === "confirmed" ? "confirmed" : "asked for changes"}
                {response.at ? ` on ${formatDateAtTime(response.at)}` : ""}
              </p>
              {response.note ? (
                <p className="mt-xs whitespace-pre-wrap text-body">{response.note}</p>
              ) : null}
              {notes.length > 0 ? (
                <ul className="mt-xs list-disc space-y-xs pl-md text-body">
                  {notes.map(([key, note]) => (
                    <li key={key}>
                      <span className="text-heading">
                        {response.item_labels[key] ?? key}:
                      </span>{" "}
                      <span className="whitespace-pre-wrap">{note}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
