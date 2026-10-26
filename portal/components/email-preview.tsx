"use client";

import { Fragment, useState } from "react";
import { previewEmail, tierName, type PreviewLead } from "@/lib/outreach/preview";
import type { CopySection, TypedGroupCopy } from "@/lib/outreach/copy";

function Segments({ segments }: { segments: ReturnType<typeof previewEmail>["body"] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.field ? (
          <mark
            key={index}
            className={`rounded-sm px-xs ${segment.missing ? "bg-transparent text-warning" : "bg-primary-tint text-heading"}`}
            title={segment.missing ? `${segment.field}: no value for this investor` : `Filled from ${segment.field}`}
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * A Preview button under one email: shows it as one real investor on the list
 * would get it, with the dynamic fields filled in. "Next investor" cycles
 * through a few from the same group.
 */
export function EmailPreview({
  group,
  section,
  index,
  leads,
  optOutLine,
}: {
  group: TypedGroupCopy;
  section: CopySection;
  index: number;
  leads: PreviewLead[];
  optOutLine: string;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  if (leads.length === 0) return null;
  const lead = leads[at % leads.length];
  const out = previewEmail(group, section, index, lead, optOutLine);
  const subject = out.subject.map((s) => s.text).join("").trim();

  return (
    <div className="mt-xs">
      <button
        type="button"
        className="text-body-sm text-primary hover:text-primary-hover"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Hide preview" : "Preview"}
      </button>
      {open ? (
        <div className="mt-xs rounded-md border border-border bg-surface px-md py-sm">
          <div className="flex flex-wrap items-center gap-sm text-body-sm text-muted">
            <span>
              As sent to <span className="text-heading">{lead.person_name || "the first contact"}</span> at{" "}
              <span className="text-heading">{lead.fund_name}</span> ({tierName(lead.tier)})
            </span>
            {leads.length > 1 ? (
              <button type="button" className="ml-auto text-primary hover:text-primary-hover" onClick={() => setAt((value) => value + 1)}>
                Next investor ›
              </button>
            ) : null}
          </div>
          <p className="mt-sm text-body-sm text-heading">
            <span className="text-muted">Subject: </span>
            {subject ? <Segments segments={out.subject} /> : index > 0 ? "(same thread)" : "—"}
          </p>
          <div className="mt-xs whitespace-pre-wrap text-body-sm text-body">
            <Segments segments={out.body} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
