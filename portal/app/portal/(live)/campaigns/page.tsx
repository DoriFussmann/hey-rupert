import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { listCampaigns } from "@/lib/data";

const statLabels = [
  ["sent", "Sent"],
  ["opened", "Opened"],
  ["clicked", "Clicked"],
  ["replied", "Replied"],
  ["bounced", "Bounced"],
  ["meetings", "Meetings booked"],
] as const;

export default async function CampaignsPage() {
  const campaigns = await listCampaigns();
  const totals = campaigns.reduce(
    (acc, campaign) => ({
      sent: acc.sent + campaign.stats.sent,
      opened: acc.opened + campaign.stats.opened,
      clicked: acc.clicked + campaign.stats.clicked,
      replied: acc.replied + campaign.stats.replied,
      bounced: acc.bounced + campaign.stats.bounced,
      meetings: acc.meetings + campaign.stats.meetings,
    }),
    { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, meetings: 0 },
  );

  return (
    <>
      <PageHeader
        title="Campaign Analytics"
        description="Performance across outreach sequences. Instantly analytics will land here once connected."
      />
      <p className="mb-lg rounded-card border border-border bg-primary-tint px-lg py-md text-body-sm text-heading">
        Instantly is not connected. Figures below are placeholders so the layout
        can be reviewed.
      </p>
      <div className="mb-lg grid gap-md sm:grid-cols-2 lg:grid-cols-3">
        {statLabels.map(([key, label]) => (
          <div
            key={key}
            className="rounded-card border border-border bg-surface px-lg py-lg"
          >
            <p className="text-label uppercase tracking-label text-muted">
              {label}
            </p>
            <p className="mt-sm font-mono text-h2 text-heading">
              {totals[key]}
            </p>
          </div>
        ))}
      </div>
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          description="Sequences will appear here after outreach is live."
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Campaign</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium">Sent</th>
                <th className="px-lg py-sm font-medium">Replied</th>
                <th className="px-lg py-sm font-medium">Bounced</th>
                <th className="px-lg py-sm font-medium">Meetings</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr
                  key={campaign.id}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-lg py-md text-heading">{campaign.name}</td>
                  <td className="px-lg py-md">
                    <StatusBadge status={campaign.status} />
                  </td>
                  <td className="px-lg py-md font-mono text-mono">
                    {campaign.stats.sent}
                  </td>
                  <td className="px-lg py-md font-mono text-mono">
                    {campaign.stats.replied}
                  </td>
                  <td className="px-lg py-md font-mono text-mono">
                    {campaign.stats.bounced}
                  </td>
                  <td className="px-lg py-md font-mono text-mono">
                    {campaign.stats.meetings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
