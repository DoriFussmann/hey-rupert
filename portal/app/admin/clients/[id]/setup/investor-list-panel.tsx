"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import {
  ClientAnswer,
  EarlierRounds,
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { InvestorListReview } from "@/app/portal/setup/investor-list/investor-list-review";
import { InvestorFundGroups } from "@/components/setup/investor-fund-groups";
import { InvestorListSummaryPanel } from "@/components/setup/investor-list-summary";
import { TurnBanner } from "@/components/setup/turn-banner";
import { matchPath } from "@/lib/match/shared";
import {
  NOTE_MAX,
  asInvestorList,
  asInvestorListDraft,
  investorListForClient,
  investorListProblem,
  tierCounts,
  type InvestorListPayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

/** The client's Investor Matching page as it will look after the push. */
function ClientPreview({ list }: { list: InvestorListPayload }) {
  return (
    <>
      <h3 className="text-h3 text-heading">Investor Matching</h3>
      <p className="mb-md mt-xs text-body-sm text-muted">
        The investors Rupert matched for this raise. Open a fund type to look through it. Add a comment if you want,
        then confirm.
      </p>
      <TurnBanner
        owner="client"
        title="Review the list and confirm it, or send Rupert your notes. Outreach can't start until you confirm."
      />
      {list.summary ? (
        <div className="mb-lg">
          <InvestorListSummaryPanel summary={list.summary} />
        </div>
      ) : null}
      <InvestorListReview
        rows={list.rows}
        version={0}
        open
        sentNotes={{}}
        adminNote={list.admin_note}
        readOnly
        stickyFooter={false}
      />
    </>
  );
}

export function InvestorListPanel({
  clientId,
  item,
  row,
  to,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
}) {
  const initial = useMemo(() => {
    const draft = asInvestorListDraft(row?.draft);
    if (draft.rows.length > 0) return draft;
    // Nothing pushed from Rupert Match yet: show what the client has, if anything.
    const published = asInvestorList(row?.published);
    return { ...published, admin_note: draft.admin_note, client_email: draft.client_email };
  }, [row]);

  const [note, setNote] = useState(initial.admin_note ?? "");
  const [savedNote, setSavedNote] = useState(initial.admin_note ?? "");

  const list: InvestorListPayload = investorListForClient({
    ...initial,
    admin_note: note.trim() || undefined,
  });
  const counts = tierCounts(list.rows);
  const empty = list.rows.length === 0;
  const changesRequested = row?.status === "changes_requested";

  return (
    <StepFrame
      item={item}
      action={
        <Link href={matchPath(clientId)} className={`${secondaryButton} no-underline`}>
          Open Rupert Match
        </Link>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted">
        The list comes from Rupert Match on the Fund Database page (fund names, tiers, websites and contact counts;
        never people). Push to client there puts it here as a draft. Review it, preview it, draft the email, then Push
        to Client Portal &amp; Send. {sendStatus(row)}
      </p>
      <ClientAnswer row={row} hideWaiting />

      {empty ? (
        <p className="px-lg pt-md text-body-sm text-secondary">
          No list yet. Open Rupert Match, run the match for this client, then click Push to client.
        </p>
      ) : (
        <>
          <p className="px-lg pt-md text-body-sm text-muted">
            {list.source_file ? `${list.source_file} · ` : ""}
            {list.rows.length} funds ·{" "}
            {counts.map(({ tier, count }) => `Tier ${tier}: ${count}`).join(" · ")}
          </p>
          {list.summary ? (
            <div className="px-lg pt-md">
              <InvestorListSummaryPanel summary={list.summary} />
            </div>
          ) : null}
          <div className="mt-md border-t border-border py-md">
            <InvestorFundGroups
              rows={list.rows}
              renderRow={(entry) => (
                <li key={entry.id} className="px-lg py-md text-body-sm">
                  <p className="text-heading">
                    {entry.fund_name}
                    {entry.website ? (
                      <a
                        href={entry.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-sm text-primary hover:text-primary-hover"
                        aria-label={`Open ${entry.fund_name} website in a new tab`}
                      >
                        Website ↗
                      </a>
                    ) : null}
                  </p>
                  {entry.contact ? <p className="text-secondary">{entry.contact}</p> : null}
                  {entry.details ? <p className="mt-xs text-muted">{entry.details}</p> : null}
                  {entry.why ? <p className="mt-xs whitespace-pre-wrap text-body">{entry.why}</p> : null}
                  {entry.comments ? <p className="mt-xs text-muted">{entry.comments}</p> : null}
                </li>
              )}
            />
          </div>
        </>
      )}

      <div className="border-t border-border px-lg py-md">
        <label className={labelClass}>
          Note on their page (optional)
          <textarea
            className={`${inputClass} mt-sm min-h-[80px] resize-y normal-case tracking-normal`}
            value={note}
            maxLength={NOTE_MAX}
            placeholder={
              changesRequested
                ? "Reply to their notes, for example: the list does not need to change, here is why."
                : "Shown above Confirm on their page."
            }
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      </div>

      <DocumentStep
        clientId={clientId}
        step="investor_list"
        item={item}
        row={row}
        to={to}
        draft={list}
        initialEmail={initial.client_email}
        dirty={note !== savedNote}
        onSaved={() => setSavedNote(note)}
        problem={investorListProblem(list)}
        busy={false}
        pushSummary="Pushes the fund list above (fund names, tiers, websites and contact counts) and your note to the client's portal as a new version, and sends them this email. They add notes, ask questions or confirm there."
        clientPreview={empty ? undefined : <ClientPreview list={list} />}
      />

      <EarlierRounds row={row} />
    </StepFrame>
  );
}
