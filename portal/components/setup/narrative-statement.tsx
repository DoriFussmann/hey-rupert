import type { NarrativeStatement } from "@/lib/setup";

/** Text written as "- " lines shows as a bullet list; anything else as a paragraph. */
function Claim({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulleted = lines.length > 0 && lines.every((line) => /^([-*•]|\d+[.)])\s+/.test(line));
  if (!bulleted) return <p className="whitespace-pre-wrap text-body-sm text-body">{text}</p>;
  return (
    <ul className="list-disc space-y-xs pl-lg text-body-sm text-body">
      {lines.map((line, index) => (
        <li key={index}>{line.replace(/^([-*•]|\d+[.)])\s+/, "")}</li>
      ))}
    </ul>
  );
}

/**
 * The Outreach Narrative as a statement: why three, the three selling points
 * as numbered cards, and the ask. The same look for Rupert and the founder.
 */
export function NarrativeStatementView({ statement }: { statement: NarrativeStatement }) {
  return (
    <div className="grid gap-sm">
      {statement.intro ? <p className="max-w-prose whitespace-pre-wrap text-body text-body">{statement.intro}</p> : null}
      <ol className="flex flex-col gap-sm">
        {statement.points.map((point, index) => (
          <li key={index} className="flex flex-col gap-xs rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
            <p className="text-label uppercase tracking-label text-primary">#{index + 1}</p>
            <p className="text-body text-heading">{point.title}</p>
            <Claim text={point.claim} />
          </li>
        ))}
      </ol>
      {statement.closing ? <p className="max-w-prose whitespace-pre-wrap text-body text-body">{statement.closing}</p> : null}
    </div>
  );
}
