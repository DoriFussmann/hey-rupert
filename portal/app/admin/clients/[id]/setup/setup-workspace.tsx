import { EmailCopyPanel } from "@/app/admin/clients/[id]/setup/email-copy-panel";
import { InvestorListPanel } from "@/app/admin/clients/[id]/setup/investor-list-panel";
import { NarrativeEditor } from "@/app/admin/clients/[id]/setup/narrative-editor";
import {
  SETUP_TOTAL,
  asFeedback,
  asInvestorList,
  isSharedWithClient,
  getSetupItems,
  readyForInvestorList,
  tierCounts,
  type SetupSource,
  type SetupStepId,
} from "@/lib/setup";

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
}) {
  const items = getSetupItems(source);
  const rows = source.setup_steps ?? [];
  const item = (id: SetupStepId) => items.find((entry) => entry.id === id)!;
  const row = (id: SetupStepId) => rows.find((entry) => entry.step === id) ?? null;
  const done = items.filter((entry) => entry.status === "done").length;
  const materialsSubmitted = row("materials")?.status === "submitted";
  // Feedback a client received as its own step, before it moved into the narrative.
  const legacyRow = row("deck_review");
  const legacyFeedback =
    isSharedWithClient(legacyRow) || Boolean(asFeedback(legacyRow?.draft).analysis);
  const investors = asInvestorList(row("investor_list")?.published);
  const listScheme = investors.tier_scheme ?? "three";
  const counts = tierCounts(investors.rows, listScheme);
  const ready = readyForInvestorList(source);

  return (
    <section className="mt-lg">
      <div className="rounded-card border border-border bg-surface px-lg py-lg">
        <div className="flex flex-wrap items-center gap-sm">
          <h2 className="text-h4">Setup</h2>
          {ready ? (
            <a
              href="#setup-investor_list"
              className="inline-flex rounded-full border border-primary/30 bg-primary-tint px-sm py-xs text-label uppercase tracking-label text-primary no-underline"
            >
              Ready for investor list
            </a>
          ) : null}
        </div>
        <p className="mt-xs text-body-sm text-muted">
          {done} of {SETUP_TOTAL} complete. Outreach Narrative: Analyze writes the Company
          Materials Feedback, Build narrative writes the narrative, then one Push to Client
          Portal & Send. The client confirms the narrative (the feedback is for them to read) →
          investor list, client confirms → email copy, client confirms.
        </p>
        <ol className="mt-md flex flex-wrap gap-sm text-body-sm">
          {items.map((entry, index) => (
            <li key={entry.id}>
              <a
                href={`#setup-${entry.id}`}
                className={`inline-flex rounded-full border px-sm py-xs no-underline ${
                  entry.status === "waiting"
                    ? "border-primary/30 bg-primary-tint text-primary"
                    : entry.status === "done"
                      ? "border-border text-success"
                      : "border-border text-muted"
                }`}
              >
                {index + 1}. {entry.title}
                {entry.status === "waiting"
                  ? " · your turn"
                  : entry.status === "your_turn"
                    ? " · client"
                    : entry.status === "done"
                      ? " · done"
                      : ""}
              </a>
            </li>
          ))}
        </ol>
      </div>

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
      />
      <EmailCopyPanel
        clientId={clientId}
        item={item("email_copy")}
        row={row("email_copy")}
        tierCounts={counts}
        listScheme={listScheme}
        claudeReady={claudeReady}
      />
    </section>
  );
}
