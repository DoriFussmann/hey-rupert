import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { DUPLICATE_LEVELS, DUPLICATE_LEVEL_INFO, type DuplicateGroup } from "@/lib/match/tiers/duplicates";
import { duplicateReport } from "@/lib/match/tiers/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function verifiedText(verified: Record<string, number>) {
  const parts = Object.entries(verified).map(([status, count]) => `${count} ${status.replace("_", " ")}`);
  return parts.length ? parts.join(", ") : "none checked";
}

function GroupTable({ group }: { group: DuplicateGroup }) {
  return (
    <div className="mb-md">
      <p className="text-body-sm text-heading">{group.shared}</p>
      <div className="mt-xs overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="py-xs pr-md font-medium">FirmID</th>
              <th className="px-md py-xs font-medium">Name</th>
              <th className="px-md py-xs font-medium">Website</th>
              <th className="px-md py-xs font-medium">HQ</th>
              <th className="px-md py-xs text-right font-medium">Contacts</th>
              <th className="py-xs pl-md font-medium">Verification</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m, i) => (
              <tr key={`${m.id}-${i}`} className="border-b border-border align-top">
                <td className="py-xs pr-md font-mono text-label text-muted">{m.id}</td>
                <td className="px-md py-xs text-heading">{m.name}</td>
                <td className="px-md py-xs text-secondary">{m.website || "–"}</td>
                <td className="px-md py-xs text-secondary">{m.location || "–"}</td>
                <td className="px-md py-xs text-right tabular-nums text-secondary">{n(m.contacts)}</td>
                <td className="py-xs pl-md text-secondary">{verifiedText(m.verified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function DuplicateReportPage() {
  await requireAdmin();
  const header = (
    <>
      <BackLink href="/admin/matching" label="Four-tier matching" />
      <PageHeader
        title="Possible duplicate firms"
        description="Firms in the live Fund Database that may be the same investor, graded by confidence. Read-only: nothing is merged, hidden or changed, and nothing here is stored. Approve the rules before Sprint 3B consolidates anything."
        actions={
          <a href="/admin/matching/duplicates/export" className="text-body-sm text-secondary underline hover:text-heading">
            Download (.xlsx)
          </a>
        }
      />
    </>
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <p role="alert" className="text-body-sm text-error">Service role key is not configured.</p>
      </>
    );
  }
  const supabase = createServiceClient();
  const [taxonomy, live] = await Promise.all([loadTaxonomy(supabase), loadLiveDb(supabase)]);
  const report = taxonomy.ok && live.ok ? await duplicateReport(supabase, live.value.db, taxonomy.value) : null;
  const error = !taxonomy.ok ? taxonomy.error : !live.ok ? live.error : report && !report.ok ? report.error : null;
  if (error || !report || !report.ok) {
    return (
      <>
        {header}
        <p role="alert" className="text-body-sm text-error">{error ?? "The report could not be built."}</p>
      </>
    );
  }
  const value = report.value;

  return (
    <>
      {header}
      <section className={`${cardClass} mb-lg px-lg py-md`}>
        <h2 className="text-h4 text-heading">Counts by confidence</h2>
        <div className="mt-sm overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="py-xs pr-md font-medium">Level</th>
                <th className="px-md py-xs font-medium">Rule</th>
                <th className="px-md py-xs font-medium">Proposal</th>
                <th className="px-md py-xs text-right font-medium">Groups</th>
                <th className="py-xs pl-md text-right font-medium">Firms</th>
              </tr>
            </thead>
            <tbody>
              {DUPLICATE_LEVELS.map((level) => (
                <tr key={level} className="border-b border-border align-top">
                  <td className="py-xs pr-md text-heading">{DUPLICATE_LEVEL_INFO[level].label}</td>
                  <td className="px-md py-xs text-secondary">{DUPLICATE_LEVEL_INFO[level].rule}</td>
                  <td className="px-md py-xs text-secondary">{DUPLICATE_LEVEL_INFO[level].proposal}</td>
                  <td className="px-md py-xs text-right tabular-nums text-secondary">{n(value.counts[level].groups)}</td>
                  <td className="py-xs pl-md text-right tabular-nums text-secondary">{n(value.counts[level].firms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-sm text-body-sm text-muted">
          Of {n(value.firms)} firms. A firm can be in more than one group (for example, the same name in one group and the same website in another).
        </p>
      </section>

      {value.watched.map((watch) => (
        <section key={watch.name} className={`${cardClass} mb-lg px-lg py-md`}>
          <h2 className="text-h4 text-heading">{watch.name}</h2>
          {watch.groups.length === 0 ? (
            <p className="mt-sm text-body-sm text-muted">Not in any duplicate group in this Fund Database version.</p>
          ) : (
            <div className="mt-sm">
              {watch.groups.map((group) => (
                <div key={group.key}>
                  <p className="text-label uppercase tracking-label text-muted">{DUPLICATE_LEVEL_INFO[group.level].label}</p>
                  <GroupTable group={group} />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}

      {DUPLICATE_LEVELS.map((level) => {
        const groups = value.groups.filter((group) => group.level === level);
        return (
          <section key={level} className={`${cardClass} mb-lg px-lg py-md`}>
            <h2 className="text-h4 text-heading">
              {DUPLICATE_LEVEL_INFO[level].label} <span className="text-body-sm font-normal text-muted">{n(groups.length)} groups</span>
            </h2>
            <p className="mt-xs text-body-sm text-muted">{DUPLICATE_LEVEL_INFO[level].rule}</p>
            <div className="mt-sm">
              {groups.length === 0 ? <p className="text-body-sm text-muted">None.</p> : groups.slice(0, 150).map((group) => <GroupTable key={group.key} group={group} />)}
              {groups.length > 150 ? <p className="text-body-sm text-muted">Showing 150 of {n(groups.length)}. The download has every group.</p> : null}
            </div>
          </section>
        );
      })}
    </>
  );
}
