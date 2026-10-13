import { EmailCopyPanel } from "@/app/admin/clients/[id]/setup/email-copy-panel";
import { InvestorListPanel } from "@/app/admin/clients/[id]/setup/investor-list-panel";
import { MaterialsPanel } from "@/app/admin/clients/[id]/setup/materials-panel";
import { ReviewEditor } from "@/app/admin/clients/[id]/setup/review-editor";
import {
  SETUP_TOTAL,
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
  materialLinks,
}: {
  clientId: string;
  source: SetupSource;
  materialLinks: Record<string, string>;
}) {
  const items = getSetupItems(source);
  const rows = source.setup_steps ?? [];
  const item = (id: SetupStepId) => items.find((entry) => entry.id === id)!;
  const row = (id: SetupStepId) => rows.find((entry) => entry.step === id) ?? null;
  const done = items.filter((entry) => entry.status === "done").length;
  const framing = row("framing");
  const counts = tierCounts(asInvestorList(row("investor_list")?.published).rows);

  return (
    <section className="mt-lg">
      <div className="rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h4">Setup</h2>
        <p className="mt-xs text-body-sm text-muted">
          {done} of {SETUP_TOTAL} complete. Materials (client) → your comments
          and message framing → client confirms → investor list → client
          confirms → email copy → client confirms. Every push emails the
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
        links={materialLinks}
        canReopen={!framing || framing.version === 0}
      />
      <ReviewEditor
        clientId={clientId}
        step="deck_review"
        item={item("deck_review")}
        row={row("deck_review")}
        intro="Your comments on the deck and materials. The client reads them; no confirmation needed. You can push an update anytime."
        pushLabel="Push comments to client"
      />
      <ReviewEditor
        clientId={clientId}
        step="framing"
        item={item("framing")}
        row={row("framing")}
        intro="The general message framing the outreach is built on. The client confirms or asks for changes."
        pushLabel="Push framing for confirmation"
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
