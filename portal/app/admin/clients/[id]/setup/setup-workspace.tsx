import { EmailCopyPanel } from "@/app/admin/clients/[id]/setup/email-copy-panel";
import { FeedbackWorkspace } from "@/app/admin/clients/[id]/setup/feedback-workspace";
import { InvestorListPanel } from "@/app/admin/clients/[id]/setup/investor-list-panel";
import { MaterialsPanel } from "@/app/admin/clients/[id]/setup/materials-panel";
import { NarrativeEditor } from "@/app/admin/clients/[id]/setup/narrative-editor";
import type { MaterialField } from "@/lib/material-fields";
import {
  SETUP_TOTAL,
  asFeedback,
  asInvestorList,
  getSetupItems,
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
  materialFields,
  materialLinks,
  feedbackLinks,
  claudeReady,
}: {
  clientId: string;
  source: SetupSource;
  materialFields: MaterialField[];
  materialLinks: Record<string, string>;
  /** Signed links for files attached to the feedback. */
  feedbackLinks: Record<string, string>;
  claudeReady: boolean;
}) {
  const items = getSetupItems(source);
  const rows = source.setup_steps ?? [];
  const item = (id: SetupStepId) => items.find((entry) => entry.id === id)!;
  const row = (id: SetupStepId) => rows.find((entry) => entry.step === id) ?? null;
  const done = items.filter((entry) => entry.status === "done").length;
  const framing = row("framing");
  const materialsSubmitted = row("materials")?.status === "submitted";
  const hasAnalysis = Boolean(asFeedback(row("deck_review")?.draft).analysis);
  const counts = tierCounts(asInvestorList(row("investor_list")?.published).rows);

  return (
    <section className="mt-lg">
      <div className="rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h4">Setup</h2>
        <p className="mt-xs text-body-sm text-muted">
          {done} of {SETUP_TOTAL} complete. Materials (client) → Analyze and
          send feedback → outreach narrative, client confirms → investor list,
          client confirms → email copy, client confirms. Every push emails the
          client; every client answer emails you.
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

      <MaterialsPanel
        clientId={clientId}
        item={item("materials")}
        row={row("materials")}
        fields={materialFields}
        links={materialLinks}
        canReopen={!framing || framing.version === 0}
      />
      <FeedbackWorkspace
        clientId={clientId}
        item={item("deck_review")}
        row={row("deck_review")}
        materialsSubmitted={materialsSubmitted}
        claudeReady={claudeReady}
        attachmentLinks={feedbackLinks}
      />
      <NarrativeEditor
        clientId={clientId}
        item={item("framing")}
        row={row("framing")}
        hasAnalysis={hasAnalysis}
        claudeReady={claudeReady}
      />
      <InvestorListPanel
        clientId={clientId}
        item={item("investor_list")}
        row={row("investor_list")}
      />
      <EmailCopyPanel
        clientId={clientId}
        item={item("email_copy")}
        row={row("email_copy")}
        tierCounts={counts}
      />
    </section>
  );
}
