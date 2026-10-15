"use client";

import { useMemo, useState } from "react";
import { AdminReply } from "@/components/setup/admin-reply";
import { InvestorFundGroups } from "@/components/setup/investor-fund-groups";
import { ReviewActions } from "@/components/setup/review-actions";
import {
  FIT_TIERS,
  NOTE_MAX,
  tierCounts,
  type InvestorRow,
} from "@/lib/setup";

export function InvestorListReview({
  rows,
  version,
  open,
  sentNotes,
  adminNote,
  readOnly,
}: {
  rows: InvestorRow[];
  version: number;
  /** True while it is the client's turn to respond. */
  open: boolean;
  /** Notes the client already sent on this version. */
  sentNotes: Record<string, string>;
  /** Rupert's reply, shown when the list is back for confirmation. */
  adminNote?: string;
  readOnly: boolean;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0);
  const counts = useMemo(() => tierCounts(rows), [rows]);

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <>
      {open && adminNote ? <AdminReply note={adminNote} /> : null}
      <div className="mb-md flex flex-wrap gap-sm" role="tablist" aria-label="Filter by tier">
        <button
          type="button"
          role="tab"
          aria-selected={tierFilter === 0}
          className={tabClass(tierFilter === 0)}
          onClick={() => setTierFilter(0)}
        >
          All · {rows.length}
        </button>
        {FIT_TIERS.map(({ tier, label }) => (
          <button
            key={tier}
            type="button"
            role="tab"
            aria-selected={tierFilter === tier}
            className={tabClass(tierFilter === tier)}
            onClick={() => setTierFilter(tier)}
          >
            {label} · {counts.find((entry) => entry.tier === tier)?.count ?? 0}
          </button>
        ))}
      </div>

      <InvestorFundGroups
        rows={rows.filter((row) => tierFilter === 0 || row.tier === tierFilter)}
        renderRow={(row) => {
                const note = notes[row.id] ?? "";
                const sent = sentNotes[row.id];
                const isEditing = editing[row.id] || Boolean(note);
                return (
                  <li key={row.id} className="px-lg py-md">
                    <div className="grid gap-sm md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                      <div className="min-w-0">
                        <p className="text-body-sm text-heading">
                          {row.fund_name}
                          {row.website ? (
                            <a
                              href={row.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-sm text-primary hover:text-primary-hover"
                              aria-label={`Open ${row.fund_name} website in a new tab`}
                            >
                              Website ↗
                            </a>
                          ) : null}
                        </p>
                        {row.contact ? (
                          <p className="text-body-sm text-secondary">{row.contact}</p>
                        ) : null}
                        {row.details ? (
                          <p className="mt-xs whitespace-pre-wrap text-body-sm text-muted">
                            {row.details}
                          </p>
                        ) : null}
                      </div>
                      <div className="min-w-0 text-body-sm">
                        {row.why ? (
                          <>
                            <p className="text-label uppercase tracking-label text-muted">
                              Why it works
                            </p>
                            <p className="mt-xs whitespace-pre-wrap text-body">{row.why}</p>
                          </>
                        ) : null}
                        {row.comments ? (
                          <>
                            <p className="mt-sm text-label uppercase tracking-label text-muted">
                              Rupert&apos;s comments
                            </p>
                            <p className="mt-xs whitespace-pre-wrap text-body">
                              {row.comments}
                            </p>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {sent ? (
                      <p className="mt-sm rounded-md bg-background px-sm py-xs text-body-sm text-secondary">
                        <span className="text-heading">Your note:</span> {sent}
                      </p>
                    ) : null}

                    {open ? (
                      isEditing ? (
                        <textarea
                          aria-label={`Your note on ${row.fund_name}`}
                          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
                          rows={2}
                          maxLength={NOTE_MAX}
                          value={note}
                          disabled={readOnly}
                          autoFocus={editing[row.id] && !note}
                          placeholder="Already in touch? Not a fit? A question?"
                          onChange={(event) =>
                            setNotes((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          onBlur={() => {
                            if (!note.trim()) {
                              setEditing((current) => ({ ...current, [row.id]: false }));
                            }
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={readOnly}
                          className="mt-sm text-body-sm text-primary hover:text-primary-hover disabled:opacity-40"
                          onClick={() =>
                            setEditing((current) => ({ ...current, [row.id]: true }))
                          }
                        >
                          + Add a note
                        </button>
                      )
                    ) : null}
                  </li>
                );
        }}
      />
      {open ? (
        <ReviewActions
          step="investor_list"
          version={version}
          itemNotes={notes}
          confirmLabel="Confirm investor list"
          changesLabel="Ask a question first"
          notePlaceholder="A comment for Rupert. Confirming the list sends it."
          intro="Confirm the list, or send Rupert your notes. Outreach can't start until you confirm."
          readOnly={readOnly}
          stickyFooter
        />
      ) : null}
    </>
  );
}
