"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDateAtTime } from "@/lib/format";
import { asReview, type SetupItem, type SetupStepState } from "@/lib/setup";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
} from "@/app/admin/clients/[id]/setup/shared";
import "@uiw/react-md-editor/markdown-editor.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="min-h-[320px] rounded-md border border-border bg-background" />
  ),
});

const STARTERS: Record<"deck_review" | "framing", string> = {
  deck_review: `## Overall

## Slide-by-slide

- **Slide 1 —** 

## Before outreach starts

- 
`,
  framing: `## The one-liner

## Why now

## Proof points

- 

## The ask

## Angle by tier

- **Tier 1 —** 
- **Tier 2 —** 
- **Tier 3 —** 
`,
};

export function ReviewEditor({
  clientId,
  step,
  item,
  row,
  intro,
  pushLabel,
}: {
  clientId: string;
  step: "deck_review" | "framing";
  item: SetupItem;
  row: SetupStepState | null;
  intro: string;
  pushLabel: string;
}) {
  const initial =
    asReview(row?.draft).body || asReview(row?.published).body || STARTERS[step];
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const published = asReview(row?.published).body;

  return (
    <StepFrame item={item} intro={intro}>
      <ClientAnswer row={step === "framing" ? row : null} />
      <div className="px-lg py-md">
        <div className="sow-editor" data-color-mode="light">
          <MDEditor
            value={value}
            onChange={(next) => setValue(next ?? "")}
            height={360}
            visibleDragbar={false}
            preview="live"
          />
        </div>
      </div>
      {row && row.version > 0 && published !== value ? (
        <details className="mx-lg mb-md text-body-sm">
          <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
            What the client sees now (version {row.version}
            {row.published_at ? `, ${formatDateAtTime(row.published_at)}` : ""})
          </summary>
          <div className="mt-sm rounded-md border border-border bg-background px-md py-md">
            <MarkdownBody content={published} emptyLabel="Empty." />
          </div>
        </details>
      ) : null}
      <EarlierRounds row={step === "framing" ? row : null} />
      <PublishBar
        clientId={clientId}
        step={step}
        item={item}
        row={row}
        draft={{ body: value }}
        dirty={value !== saved}
        onSaved={() => setSaved(value)}
        pushLabel={pushLabel}
        problem={
          !value.trim()
            ? "Write something before pushing."
            : value.trim() === STARTERS[step].trim()
              ? "Fill in the outline before pushing."
              : null
        }
      />
    </StepFrame>
  );
}
