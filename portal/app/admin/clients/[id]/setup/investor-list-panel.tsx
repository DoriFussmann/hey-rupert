"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import {
  ClientAnswer,
  ClientQuestions,
  EarlierRounds,
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { InvestorListReview } from "@/app/portal/setup/investor-list/investor-list-review";
import { ListAuditPanel } from "@/app/admin/clients/[id]/setup/list-audit-panel";
import { InvestorFundGroups } from "@/components/setup/investor-fund-groups";
import { InvestorListSummaryPanel } from "@/components/setup/investor-list-summary";
import { formatDate } from "@/lib/format";
import { auditSendWarning, listFingerprint, type ListAudit } from "@/lib/list-audit";
import { matchPath } from "@/lib/match/shared";
import {
  NOTE_MAX,
  asInvestorList,
  asInvestorListDraft,
  fitTiersFor,
  investorListForClient,
  investorListProblem,
  tierLabel,
  withoutGenericWhy,
  type InvestorFundFlag,
  type InvestorListPayload,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

/** The client's investor list page as it will look after the send. */
function ClientPreview({
  list,
  company,
  adminName,
}: {
  list: InvestorListPayload;
  company: string;
  adminName: string;
}) {
  return (
    <InvestorListReview
      rows={list.rows}
      summary={list.summary}
      scheme={list.tier_scheme}
      verification={list.verification}
      flags={list.client_flags}
      version={0}
      open
      company={company}
      adminName={adminName}
      adminNote={list.admin_note}
      readOnly
      heading="p"
    />
  );
}

function flagOf(flags: Record<string, InvestorFundFlag> | undefined, id: string) {
  return flags?.[id];
}

export function InvestorListPanel({
  clientId,
  item,
  row,
  to,
  companyName,
  clientFirstName,
  adminName,
  audit,
  claudeReady,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  companyName: string;
  clientFirstName: string;
  adminName: string;
  /** The newest founder's-eye audit, or why it could not be read. */
  audit: { value: ListAudit | null; error: string | null };
  claudeReady: boolean;
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
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const list: InvestorListPayload = investorListForClient({
    ...initial,
    admin_note: note.trim() || undefined,
  });
  const empty = list.rows.length === 0;
  const verification = list.verification;
  const visibleRows = list.rows.filter((entry) => !entry.hidden_duplicate);
  const hiddenCount = list.rows.length - visibleRows.length;
  const flaggedRows = list.rows.filter((entry) => {
    const flag = flagOf(list.client_flags, entry.id);
    return Boolean(flag?.excluded || flag?.known || flag?.note);
  });
  const adminRows = flaggedOnly ? flaggedRows : list.rows;
  const changesRequested = row?.status === "changes_requested";
  const fingerprint = listFingerprint(list.rows);
  const auditWarning = empty ? null : auditSendWarning(audit.value, fingerprint);
  const sendHint = clientFirstName
    ? `Sending makes the list visible in ${clientFirstName}'s portal.`
    : "Sending makes the list visible in the client's portal.";

  return (
    <StepFrame
      item={item}
      action={
        <Link href={matchPath(clientId)} className={`${secondaryButton} no-underline`}>
          Open Matching
        </Link>
      }
    >
      <p className="px-lg pt-md text-body-sm text-muted">
        The list comes from Matching (fund names, tiers, websites and contact counts; never people). Push to client
        there puts it here as a draft. Review it, preview it, draft the email, then Push to Client Portal &amp; Send.{" "}
        {sendStatus(row)}
      </p>
      <ClientAnswer row={row} hideWaiting />
      <ClientQuestions clientId={clientId} step="investor_list" row={row} />

      {empty ? (
        <p className="px-lg pt-md text-body-sm text-secondary">
          No list yet. Open Matching, run the match for this client, then click Push to client.
        </p>
      ) : (
        <>
          <p className="px-lg pt-md text-body-sm text-secondary">
            {list.source_file ? `${list.source_file} · ` : ""}
            {visibleRows.length} funds on the client list ·{" "}
            {fitTiersFor(list.tier_scheme).map(({ tier }) => {
              const count = visibleRows.filter((entry) => entry.tier === tier && !entry.broad).length;
              return `${tierLabel(tier, list.tier_scheme)}: ${count}`;
            }).join(" · ")}
            {visibleRows.some((entry) => entry.broad) ? ` · Broad investors: ${visibleRows.filter((entry) => entry.broad).length}` : ""}
            {hiddenCount > 0 ? ` · ${hiddenCount} hidden ${hiddenCount === 1 ? "duplicate" : "duplicates"}` : ""}
          </p>
          <p className="px-lg pt-xs text-body-sm text-muted">
            {list.tier_scheme === "four"
              ? `Four tiers${list.rules_version ? ` · rules ${list.rules_version}` : ""}${list.run_id ? ` · saved run ${list.run_id.slice(0, 8)}` : ""}.`
              : "Three tiers (a list made with the earlier engine)."}
          </p>
          <div className="px-lg pt-md text-body-sm text-secondary">
            <p className="text-heading">Quality check</p>
            {verification?.verification_ran ? (
              <p className="mt-xs">
                Sample {verification.sample_size ?? 0}. Firms confirmed active{" "}
                {verification.firms_confirmed_active ?? 0} of {verification.firms_checked ?? 0}.
                Emails checked {verification.emails_checked ?? 0}: valid {verification.emails_valid ?? 0},
                accept-all {verification.emails_accept_all ?? 0}, invalid {verification.emails_invalid ?? 0},
                unknown {verification.emails_unknown ?? 0}. Deliverable {verification.deliverable_rate ?? 0}%.
                {verification.verified_at && !Number.isNaN(new Date(verification.verified_at).getTime())
                  ? ` Checked ${formatDate(verification.verified_at)}.`
                  : ""}
              </p>
            ) : (
              <p className="mt-xs">Not run</p>
            )}
          </div>
          {list.removed_flags && list.removed_flags.length > 0 ? (
            <div className="px-lg pt-md text-body-sm text-secondary">
              <p className="text-heading">Flagged by client, no longer in list</p>
              <ul className="mt-xs space-y-xs">
                {list.removed_flags.map((item) => (
                  <li key={item.id}>
                    {item.fund_name}: Flagged by client, no longer in list
                    {item.excluded ? " · Excluded" : ""}
                    {item.known ? " · I know them" : ""}
                    {item.note ? ` · Note: ${item.note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {list.summary ? (
            <div className="px-lg pt-md">
              <InvestorListSummaryPanel summary={list.summary} scheme={list.tier_scheme} />
            </div>
          ) : null}
          <div className="mt-md border-t border-border py-md">
            <div className="flex flex-wrap items-center gap-sm px-lg pb-md">
              <button
                type="button"
                className={secondaryButton}
                aria-pressed={flaggedOnly}
                onClick={() => setFlaggedOnly((current) => !current)}
              >
                {flaggedOnly ? "✓ Flagged only" : "Flagged only"} ({flaggedRows.length})
              </button>
            </div>
            <InvestorFundGroups
              rows={adminRows}
              scheme={list.tier_scheme}
              renderRow={(entry) => {
                const flag = flagOf(list.client_flags, entry.id);
                const why = withoutGenericWhy(entry.why);
                return (
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
                    {entry.hidden_duplicate ? (
                      <p className="mt-xs text-body-sm text-warning">Hidden duplicate</p>
                    ) : null}
                    {entry.contact ? <p className="text-secondary">{entry.contact}</p> : null}
                    {entry.details ? <p className="mt-xs text-secondary">{entry.details}</p> : null}
                    {entry.reasons && entry.reasons.length > 0 ? (
                      <p className="mt-xs text-secondary">{entry.reasons.join(" · ")}</p>
                    ) : null}
                    {why ? <p className="mt-xs whitespace-pre-wrap text-body">{why}</p> : null}
                    {entry.comments ? <p className="mt-xs text-secondary">{entry.comments}</p> : null}
                    {flag?.excluded || flag?.known || flag?.note ? (
                      <p className="mt-xs text-heading">
                        {flag.excluded ? "Excluded" : ""}
                        {flag.excluded && flag.known ? " · " : ""}
                        {flag.known ? "I know them" : ""}
                        {flag.note ? ` · Note: ${flag.note}` : ""}
                      </p>
                    ) : null}
                  </li>
                );
              }}
            />
          </div>
          <ListAuditPanel
            key={audit.value?.id ?? "none"}
            clientId={clientId}
            initialAudit={audit.value}
            loadError={audit.error}
            fingerprint={fingerprint}
            scheme={list.tier_scheme}
            claudeReady={claudeReady}
          />
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
        sendHint={auditWarning ? `${sendHint} Audit: ${auditWarning}` : sendHint}
        clientPreview={
          empty ? undefined : (
            <ClientPreview list={list} company={companyName} adminName={adminName} />
          )
        }
      />

      <EarlierRounds row={row} />
    </StepFrame>
  );
}
