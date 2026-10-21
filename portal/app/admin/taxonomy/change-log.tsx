import { formatDateAtTime } from "@/lib/format";
import type { ChangeEntry } from "@/lib/taxonomy/server";

const ENTITY_LABEL: Record<string, string> = {
  tax_nodes: "Category",
  tax_aliases: "Value",
  tax_edges: "Relationship",
};

/** The latest changes to categories, value mappings and relationships. */
export function ChangeLog({ changes }: { changes: ChangeEntry[] }) {
  if (changes.length === 0) {
    return <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">No changes yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[640px] text-left text-body-sm">
        <thead>
          <tr className="border-b border-border text-label uppercase tracking-label text-muted">
            <th className="px-lg py-sm font-medium">Revision</th>
            <th className="px-md py-sm font-medium">When</th>
            <th className="px-md py-sm font-medium">Who</th>
            <th className="px-md py-sm font-medium">What</th>
            <th className="px-lg py-sm font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={change.id} className="border-b border-border align-top">
              <td className="px-lg py-sm font-mono text-muted">{change.id}</td>
              <td className="px-md py-sm text-muted">{formatDateAtTime(change.at)}</td>
              <td className="px-md py-sm text-secondary">{change.actor ?? "–"}</td>
              <td className="px-md py-sm text-heading">
                {ENTITY_LABEL[change.entity] ?? change.entity}{" "}
                <span className="font-mono text-label text-muted">{change.key}</span>
              </td>
              <td className="px-lg py-sm text-secondary">
                {change.action === "update" ? `Changed ${change.fields.join(", ") || "details"}` : change.action === "insert" ? "Added" : "Deleted"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
