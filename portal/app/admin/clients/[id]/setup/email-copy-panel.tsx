"use client";

import { useMemo, useState } from "react";
import {
  EMAIL_SEQUENCE_LABELS,
  FIT_TIERS,
  asEmailCopy,
  emailCopyProblems,
  type EmailCopyPayload,
  type FitTier,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
  inputClass,
} from "@/app/admin/clients/[id]/setup/shared";

function hasContent(copy: EmailCopyPayload) {
  return FIT_TIERS.some(({ tier }) =>
    copy.tiers[`${tier}`].some((email) => email.subject.trim() || email.body.trim()),
  );
}

export function EmailCopyPanel({
  clientId,
  item,
  row,
  tierCounts,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  tierCounts: { tier: FitTier; count: number }[];
}) {
  const initial = useMemo(() => {
    const draft = asEmailCopy(row?.draft);
    return hasContent(draft) ? draft : asEmailCopy(row?.published);
  }, [row]);

  const [copy, setCopy] = useState<EmailCopyPayload>(initial);
  const [savedKey, setSavedKey] = useState(JSON.stringify(initial));
  const [tier, setTier] = useState<FitTier>(1);
  const problems = emailCopyProblems(copy);

  function update(index: number, field: "subject" | "body", value: string) {
    setCopy((current) => {
      const key = `${tier}` as const;
      const emails = current.tiers[key].map((email, position) =>
        position === index ? { ...email, [field]: value } : email,
      );
      return { tiers: { ...current.tiers, [key]: emails } };
    });
  }

  function copyFromTier(source: FitTier) {
    if (
      !window.confirm(
        `Replace the Tier ${tier} emails with a copy of Tier ${source}?`,
      )
    ) {
      return;
    }
    setCopy((current) => ({
      tiers: {
        ...current.tiers,
        [`${tier}`]: current.tiers[`${source}`].map((email) => ({ ...email })),
      },
    }));
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <StepFrame
      item={item}
      intro="A first email and two follow-ups for each fit tier. Leave a follow-up subject blank to send it in the same thread. Use placeholders like {{first_name}} and {{fund_name}} for personal details."
    >
      <ClientAnswer row={row} />
      <div className="px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm" role="tablist" aria-label="Tier">
          {FIT_TIERS.map((entry) => {
            const count = tierCounts.find((item) => item.tier === entry.tier)?.count ?? 0;
            return (
              <button
                key={entry.tier}
                type="button"
                role="tab"
                aria-selected={tier === entry.tier}
                className={tabClass(tier === entry.tier)}
                onClick={() => setTier(entry.tier)}
              >
                {entry.label} · {entry.detail}
                {count ? ` · ${count}` : ""}
              </button>
            );
          })}
          <span className="ml-auto flex flex-wrap gap-xs text-body-sm text-muted">
            Copy from:
            {FIT_TIERS.filter((entry) => entry.tier !== tier).map((entry) => (
              <button
                key={entry.tier}
                type="button"
                className="text-primary hover:text-primary-hover"
                onClick={() => copyFromTier(entry.tier)}
              >
                {entry.label}
              </button>
            ))}
          </span>
        </div>

        <ol className="mt-md space-y-lg">
          {copy.tiers[`${tier}`].map((email, index) => (
            <li key={`${tier}-${index}`}>
              <p className="text-label uppercase tracking-label text-muted">
                {EMAIL_SEQUENCE_LABELS[index]}
              </p>
              <input
                className={`${inputClass} mt-sm`}
                value={email.subject}
                maxLength={300}
                onChange={(event) => update(index, "subject", event.target.value)}
                placeholder={index === 0 ? "Subject" : "Subject (blank = same thread)"}
                aria-label={`Tier ${tier} ${EMAIL_SEQUENCE_LABELS[index]} subject`}
              />
              <textarea
                className={`${inputClass} mt-sm`}
                rows={index === 0 ? 10 : 6}
                maxLength={10000}
                value={email.body}
                onChange={(event) => update(index, "body", event.target.value)}
                placeholder="Body"
                aria-label={`Tier ${tier} ${EMAIL_SEQUENCE_LABELS[index]} body`}
              />
            </li>
          ))}
        </ol>

        {problems.length > 0 ? (
          <p className="mt-md text-body-sm text-muted">
            Before pushing: {problems.join(" ")}
          </p>
        ) : null}
      </div>
      <EarlierRounds row={row} />
      <PublishBar
        clientId={clientId}
        step="email_copy"
        item={item}
        row={row}
        draft={copy}
        dirty={JSON.stringify(copy) !== savedKey}
        onSaved={() => setSavedKey(JSON.stringify(copy))}
        pushLabel="Push emails for confirmation"
        problem={problems.length > 0 ? problems.join(" ") : null}
      />
    </StepFrame>
  );
}
