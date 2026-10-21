"use client";

import { useMemo, useState } from "react";
import { addRelationship, reviewRelationship, suggestRelationships } from "@/app/admin/taxonomy-actions";
import { inputClass, labelClass, n, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { Select } from "@/components/select";
import {
  GENERALIST_KIND,
  RELATIONS,
  RELATION_HELP,
  RELATION_LABEL,
  type EdgeOrigin,
  type EdgeReview,
  type Relation,
  type TaxEdge,
  type TaxNode,
} from "@/lib/taxonomy/core";

const PAGE = 50;

const ORIGIN_LABEL: Record<EdgeOrigin, string> = {
  seed: "Seeded",
  legacy: "From the current match engine",
  manual: "Added by an admin",
  ai: "AI suggestion",
};

const REVIEW_LABEL: Record<EdgeReview, string> = {
  approved: "Approved",
  needs_review: "Needs review",
  rejected: "Rejected",
};

function EdgeItem({ edge, label }: { edge: TaxEdge; label: (id: string) => string }) {
  const { pending, error, run } = useAction();
  const [relation, setRelation] = useState<Relation>(edge.relation);
  const changed = relation !== edge.relation;

  return (
    <li className="border-b border-border py-sm">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0 text-body-sm">
          <p>
            <span className="text-heading">{label(edge.fromId)}</span>{" "}
            <span className="text-muted" aria-label={edge.directed ? "relates to (one way)" : "relates to (both ways)"}>
              {edge.directed ? "→" : "↔"}
            </span>{" "}
            <span className="text-heading">{label(edge.toId)}</span>
            <span className="text-muted">
              {" "}
              · {RELATION_LABEL[edge.relation]} · {REVIEW_LABEL[edge.review]}
            </span>
          </p>
          <p className="mt-xs text-secondary">{edge.rationale || "No reason recorded."}</p>
          <p className="text-muted">
            {ORIGIN_LABEL[edge.origin]}
            {edge.source ? ` · ${edge.source}` : ""}
            {edge.context ? ` · Holds when: ${edge.context}` : ""}
            {edge.reviewedBy ? ` · Reviewed by ${edge.reviewedBy}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-sm">
          <div className="w-48">
            <label className="sr-only" htmlFor={`rel-${edge.id}`}>
              Relationship type
            </label>
            <Select id={`rel-${edge.id}`} value={relation} onChange={(event) => setRelation(event.target.value as Relation)}>
              {RELATIONS.map((item) => (
                <option key={item} value={item}>
                  {RELATION_LABEL[item]}
                </option>
              ))}
            </Select>
          </div>
          {edge.review !== "approved" || changed ? (
            <button
              type="button"
              className={smallButton}
              disabled={pending}
              onClick={() => run(() => reviewRelationship(edge.id, "approved", changed ? relation : null))}
            >
              {changed ? `Approve as ${RELATION_LABEL[relation].toLowerCase()}` : "Approve"}
            </button>
          ) : null}
          {edge.review !== "rejected" ? (
            <button
              type="button"
              className={smallButton}
              disabled={pending}
              onClick={() => run(() => reviewRelationship(edge.id, "rejected", null))}
            >
              Reject
            </button>
          ) : null}
        </div>
      </div>
      <ErrorLine error={error} />
    </li>
  );
}

function AddRelationship({ sectors }: { sectors: TaxNode[] }) {
  const { pending, error, run } = useAction();
  const empty = { fromId: "", toId: "", relation: "immediate" as Relation, directed: false, rationale: "", context: "" };
  const [draft, setDraft] = useState(empty);

  async function save() {
    const saved = await run(() => addRelationship(draft));
    if (saved) setDraft(empty);
  }

  return (
    <div className="mt-md rounded-md border border-border bg-background p-md">
      <p className="text-heading">Add a relationship</p>
      <div className="mt-sm grid gap-sm sm:grid-cols-3">
        {(["fromId", "toId"] as const).map((key) => (
          <div key={key}>
            <label className={labelClass} htmlFor={`new-${key}`}>
              {key === "fromId" ? "Sector" : "Related sector"}
            </label>
            <Select id={`new-${key}`} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>
              <option value="">Pick a sector</option>
              {sectors.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
            </Select>
          </div>
        ))}
        <div>
          <label className={labelClass} htmlFor="new-relation">
            Type
          </label>
          <Select
            id="new-relation"
            value={draft.relation}
            onChange={(event) => setDraft({ ...draft, relation: event.target.value as Relation })}
          >
            {RELATIONS.map((item) => (
              <option key={item} value={item}>
                {RELATION_LABEL[item]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="mt-xs text-body-sm text-muted">{RELATION_HELP[draft.relation]}</p>
      <label className="mt-sm flex items-center gap-xs text-body-sm">
        <input type="checkbox" checked={draft.directed} onChange={(event) => setDraft({ ...draft, directed: event.target.checked })} />
        One way only (holds from the first sector to the second, not back)
      </label>
      <div className="mt-sm grid gap-sm sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="new-rationale">
            Reason (required)
          </label>
          <textarea
            id="new-rationale"
            className={`${inputClass} mt-xs`}
            rows={2}
            maxLength={600}
            value={draft.rationale}
            onChange={(event) => setDraft({ ...draft, rationale: event.target.value })}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-context">
            Only holds when (optional)
          </label>
          <textarea
            id="new-context"
            className={`${inputClass} mt-xs`}
            rows={2}
            maxLength={300}
            value={draft.context}
            onChange={(event) => setDraft({ ...draft, context: event.target.value })}
          />
        </div>
      </div>
      <button type="button" className={`${primaryButton} mt-sm`} disabled={pending || !draft.fromId || !draft.toId} onClick={save}>
        Add as approved
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

export function RelationshipReview({ edges, nodes }: { edges: TaxEdge[]; nodes: TaxNode[] }) {
  const { pending, error, run } = useAction();
  const [review, setReview] = useState<EdgeReview | "all">("needs_review");
  const [sector, setSector] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [note, setNote] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const label = (id: string) => byId.get(id)?.label ?? id;
  const sectors = nodes
    .filter((node) => node.dimension === "sector" && node.status === "active" && node.kind !== "group" && node.kind !== GENERALIST_KIND)
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = edges
    .filter((edge) => review === "all" || edge.review === review)
    .filter((edge) => !sector || edge.fromId === sector || edge.toId === sector)
    .sort((a, b) => label(a.fromId).localeCompare(label(b.fromId)) || label(a.toId).localeCompare(label(b.toId)));
  const count = (value: EdgeReview) => edges.filter((edge) => edge.review === value).length;

  async function suggest() {
    if (!sector) return;
    setNote(null);
    const result = await run(() => suggestRelationships(sector));
    if (result) {
      setReview("needs_review");
      setNote(
        result.proposed > 0
          ? `${result.proposed} relationship${result.proposed === 1 ? "" : "s"} suggested for review.`
          : "No new relationship suggested.",
      );
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface px-lg py-md">
      <p className="max-w-prose text-body-sm text-muted">
        How close two sectors are, closest first: equivalent, immediate, broader, weak. No relationship means none is
        established. Only approved relationships should be relied on; rejected ones stay recorded so they are not suggested
        again.{" "}
        <a href="/admin/taxonomy/relationships" className="text-primary underline">
          Export all relationships (.xlsx)
        </a>
      </p>
      <div className="mt-md grid gap-sm sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="edge-review">
            Show
          </label>
          <Select id="edge-review" value={review} onChange={(event) => setReview(event.target.value as EdgeReview | "all")}>
            <option value="needs_review">Needs review ({n(count("needs_review"))})</option>
            <option value="approved">Approved ({n(count("approved"))})</option>
            <option value="rejected">Rejected ({n(count("rejected"))})</option>
            <option value="all">All ({n(edges.length)})</option>
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="edge-sector">
            Sector
          </label>
          <Select id="edge-sector" value={sector} onChange={(event) => setSector(event.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((node) => (
              <option key={node.id} value={node.id}>
                {node.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={secondaryButton} disabled={pending || !sector} onClick={suggest}>
          {pending ? "Asking AI…" : sector ? `Suggest relationships for ${label(sector)} with AI` : "Pick a sector to get AI suggestions"}
        </button>
        {note ? (
          <span role="status" className="text-body-sm text-success">
            {note}
          </span>
        ) : null}
      </div>
      <ErrorLine error={error} />
      {filtered.length === 0 ? (
        <p className="mt-md text-body-sm text-muted">No relationships here.</p>
      ) : (
        <ul className="mt-md">
          {filtered.slice(0, limit).map((edge) => (
            <EdgeItem key={`${edge.id}-${edge.relation}-${edge.review}`} edge={edge} label={label} />
          ))}
        </ul>
      )}
      {filtered.length > limit ? (
        <button type="button" className={`${smallButton} mt-sm`} onClick={() => setLimit((current) => current + PAGE)}>
          Show more ({n(filtered.length - limit)} left)
        </button>
      ) : null}
      <AddRelationship sectors={sectors} />
    </div>
  );
}
