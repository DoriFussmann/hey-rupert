import { EmailCopyPanel } from "@/app/admin/clients/[id]/setup/email-copy-panel";
import { CoreContactsPanel } from "@/app/admin/clients/[id]/setup/core-contacts-panel";
import { CampaignPanel } from "@/app/admin/clients/[id]/setup/campaign-panel";
import { LivePanel } from "@/app/admin/clients/[id]/setup/live-panel";
import { InvestorListPanel } from "@/app/admin/clients/[id]/setup/investor-list-panel";
import { NarrativeEditor } from "@/app/admin/clients/[id]/setup/narrative-editor";
import {
  asFeedback,
  asInvestorList,
  isSharedWithClient,
  getSetupItems,
  tierCounts,
  type SetupSource,
  type SetupStepId,
} from "@/lib/setup";
import type { ListAudit } from "@/lib/list-audit";

/**
 * Rupert's side of the Setup Turn Engine: one panel per step, in order.
 * Server component; each panel is interactive.
 */
export function SetupWorkspace({
  clientId,
  source,
  fileLinks,
  clientEmail,
  clientFirstName,
  companyName,
  adminName,
  claudeReady,
  listAudit,
}: {
  clientId: string;
  source: SetupSource;
  /** Signed links for files saved on the narrative draft. */
  fileLinks: Record<string, string>;
  /** The client's email address. */
  clientEmail: string;
  clientFirstName: string;
  companyName: string;
  adminName: string;
  claudeReady: boolean;
  /** The newest investor list audit, or why it could not be read. */
  listAudit: { value: ListAudit | null; error: string | null };
}) {
  const items = getSetupItems(source);
  const rows = source.setup_steps ?? [];
  const item = (id: SetupStepId) => items.find((entry) => entry.id === id)!;
  const row = (id: SetupStepId) => rows.find((entry) => entry.step === id) ?? null;
  const materialsSubmitted = row("materials")?.status === "submitted";
  // Feedback a client received as its own step, before it moved into the narrative.
  const legacyRow = row("deck_review");
  const legacyFeedback =
    isSharedWithClient(legacyRow) || Boolean(asFeedback(legacyRow?.draft).analysis);
  const investors = asInvestorList(row("investor_list")?.published);
  const listScheme = investors.tier_scheme ?? "three";
  const counts = tierCounts(investors.rows, listScheme);

  return (
    <section>
      <NarrativeEditor
        clientId={clientId}
        item={item("framing")}
        row={row("framing")}
        to={clientEmail}
        materialsSubmitted={materialsSubmitted}
        legacyFeedback={legacyFeedback}
        claudeReady={claudeReady}
        fileLinks={fileLinks}
      />
      <InvestorListPanel
        clientId={clientId}
        item={item("investor_list")}
        row={row("investor_list")}
        to={clientEmail}
        companyName={companyName}
        clientFirstName={clientFirstName}
        adminName={adminName}
        audit={listAudit}
        claudeReady={claudeReady}
      />
      <EmailCopyPanel
        clientId={clientId}
        item={item("email_copy")}
        row={row("email_copy")}
        to={clientEmail}
        tierCounts={counts}
        listScheme={listScheme}
        claudeReady={claudeReady}
      />
      {listScheme === "four" && row("investor_list")?.status === "confirmed" ? (
        <>
          <CoreContactsPanel clientId={clientId} claudeReady={claudeReady} />
          <CampaignPanel clientId={clientId} claudeReady={claudeReady} />
          <LivePanel clientId={clientId} />
        </>
      ) : null}
    </section>
  );
}
