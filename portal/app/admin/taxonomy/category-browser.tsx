"use client";

import { useState } from "react";
import { addCategory, editCategory } from "@/app/admin/taxonomy-actions";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { Select } from "@/components/select";
import { DIMENSIONS, DIMENSION_LABEL, type Dimension, type TaxAlias, type TaxNode } from "@/lib/taxonomy/core";

function NodeItem({ node, depth, uses }: { node: TaxNode; depth: number; uses: number }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ label: node.label, description: node.description });
  const retired = node.status === "retired";

  async function save(status: "active" | "retired") {
    const saved = await run(() => editCategory({ id: node.id, ...draft, status }));
    if (saved) setEditing(false);
  }

  return (
    <li className="border-b border-border py-xs" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <div className="flex flex-wrap items-baseline justify-between gap-sm text-body-sm">
        <p className={retired ? "text-muted line-through" : ""}>
          <span className={node.kind === "group" ? "font-medium text-heading" : "text-heading"}>{node.label}</span>{" "}
          <span className="font-mono text-label text-muted">{node.id}</span>
          <span className="text-muted">
            {" "}
            · {node.kind.replace("_", " ")}
            {uses > 0 ? ` · ${uses} value${uses === 1 ? "" : "s"}` : ""}
            {retired ? " · retired" : ""}
          </span>
        </p>
        <button type="button" className={smallButton} onClick={() => setEditing((open) => !open)}>
          Edit
        </button>
      </div>
      {node.description && !editing ? <p className="text-body-sm text-muted">{node.description}</p> : null}
      {editing ? (
        <div className="my-sm grid gap-sm rounded-md border border-border bg-background p-md sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`label-${node.id}`}>
              Name
            </label>
            <input
              id={`label-${node.id}`}
              className={`${inputClass} mt-xs`}
              maxLength={120}
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`desc-${node.id}`}>
              Notes
            </label>
            <input
              id={`desc-${node.id}`}
              className={`${inputClass} mt-xs`}
              maxLength={600}
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
          <div className="flex flex-wrap gap-sm sm:col-span-2">
            <button type="button" className={primaryButton} disabled={pending} onClick={() => save(node.status)}>
              Save
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={pending}
              onClick={() => save(retired ? "active" : "retired")}
            >
              {retired ? "Restore" : "Retire"}
            </button>
          </div>
          {!retired && uses > 0 ? (
            <p className="text-body-sm text-warning sm:col-span-2">
              Retiring it makes the {uses} value{uses === 1 ? "" : "s"} mapped here show as broken until remapped.
            </p>
          ) : null}
          <ErrorLine error={error} />
        </div>
      ) : null}
    </li>
  );
}

function AddCategory({ dimension, nodes, kinds }: { dimension: Dimension; nodes: TaxNode[]; kinds: string[] }) {
  const { pending, error, run } = useAction();
  const empty = { label: "", parentId: "", kind: kinds[0] ?? "", description: "" };
  const [draft, setDraft] = useState(empty);
  const [note, setNote] = useState<string | null>(null);

  async function save() {
    setNote(null);
    const saved = await run(() => addCategory({ dimension, ...draft, kind: draft.kind || kinds[0], parentId: draft.parentId || null }));
    if (saved) {
      setDraft(empty);
      setNote(`Added ${saved.id}.`);
    }
  }

  return (
    <div className="mt-md rounded-md border border-border bg-background p-md">
      <p className="text-heading">Add a {DIMENSION_LABEL[dimension].toLowerCase()} category</p>
      <div className="mt-sm grid gap-sm sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="cat-label">
            Name
          </label>
          <input
            id="cat-label"
            className={`${inputClass} mt-sm`}
            maxLength={120}
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="cat-parent">
            Inside
          </label>
          <Select id="cat-parent" value={draft.parentId} onChange={(event) => setDraft({ ...draft, parentId: event.target.value })}>
            <option value="">Top level</option>
            {nodes
              .filter((node) => node.status === "active")
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.label}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="cat-kind">
            Kind
          </label>
          <Select id="cat-kind" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <label className={`${labelClass} mt-sm`} htmlFor="cat-desc">
        Notes (optional)
      </label>
      <input
        id="cat-desc"
        className={`${inputClass} mt-xs`}
        maxLength={600}
        value={draft.description}
        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
      />
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={pending || !draft.label.trim()} onClick={save}>
          Add category
        </button>
        {note ? (
          <span role="status" className="text-body-sm text-success">
            {note}
          </span>
        ) : null}
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

export function CategoryBrowser({
  nodes,
  aliases,
  kinds,
}: {
  nodes: TaxNode[];
  aliases: TaxAlias[];
  kinds: Record<Dimension, string[]>;
}) {
  const [dimension, setDimension] = useState<Dimension>("sector");
  const inDimension = nodes.filter((node) => node.dimension === dimension);
  const uses = new Map<string, number>();
  for (const alias of aliases) {
    for (const id of alias.nodeIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const ids = new Set(inDimension.map((node) => node.id));
  const childrenOf = (parentId: string | null) =>
    inDimension.filter((node) => (parentId == null ? !node.parentId || !ids.has(node.parentId) : node.parentId === parentId));

  const rows: { node: TaxNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf(parentId)) {
      rows.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <div className="rounded-card border border-border bg-surface px-lg py-md">
      <div className="max-w-xs">
        <label className={labelClass} htmlFor="cat-dimension">
          Dimension
        </label>
        <Select id="cat-dimension" value={dimension} onChange={(event) => setDimension(event.target.value as Dimension)}>
          {DIMENSIONS.map((item) => (
            <option key={item} value={item}>
              {DIMENSION_LABEL[item]} ({nodes.filter((node) => node.dimension === item).length})
            </option>
          ))}
        </Select>
      </div>
      {dimension === "sector" ? (
        <p className="mt-sm max-w-prose text-body-sm text-muted">
          Groups are for browsing only. Whether two sectors are related comes from Sector relationships, never from sharing a
          group.
        </p>
      ) : null}
      <ul className="mt-md">
        {rows.map(({ node, depth }) => (
          <NodeItem key={`${node.id}-${node.label}-${node.status}`} node={node} depth={depth} uses={uses.get(node.id) ?? 0} />
        ))}
      </ul>
      <AddCategory key={dimension} dimension={dimension} nodes={inDimension} kinds={kinds[dimension]} />
    </div>
  );
}
