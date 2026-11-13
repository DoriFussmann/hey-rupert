import { STATUS_LABEL, estimateMissing, estimateReady, formatWhen } from "@/lib/prospects/core";
import { ADMIN_TIME_ZONE, type ProspectListItem } from "@/lib/prospects/server";
import { ChevronDown } from "@/components/chevron";
import { ProspectRow } from "@/app/admin/prospect-row-actions";

const STATUS_STYLE: Record<string, string> = {
  call_booked: "bg-primary-tint text-primary",
  call_done: "text-secondary",
  follow_up: "bg-primary-tint text-success",
  not_a_fit: "text-muted",
  no_show: "text-warning",
  cancelled: "text-muted",
  converted: "text-success",
};

/** Founders who booked a call and aren't clients yet: upcoming calls first, then the rest, newest first. */
export function ProspectList({ prospects, error }: { prospects: ProspectListItem[]; error?: string }) {
  const upcoming = prospects
    .filter((p) => p.nextCall)
    .sort((a, b) => Date.parse(a.nextCall!.start_time ?? "") - Date.parse(b.nextCall!.start_time ?? ""));
  const rest = prospects.filter((p) => !p.nextCall);
  const rows = [...upcoming, ...rest];

  return (
    <details className="group/calls mb-lg rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-sm px-lg py-md transition-colors duration-hover hover:bg-background group-open/calls:border-b group-open/calls:border-border [&::-webkit-details-marker]:hidden">
        <h2 className="text-h4">
          Calls booked <span className="text-muted">({prospects.length})</span>
          {upcoming.length ? <span className="ml-sm text-body-sm text-primary">{upcoming.length} upcoming</span> : null}
        </h2>
        <span className="flex items-center gap-md">
          <span className="hidden text-body-sm text-muted sm:inline">Booked a call on Cal.com, not a client yet. Click a row to edit or delete it.</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
            <ChevronDown className="h-4 w-4 transition-transform duration-hover group-open/calls:rotate-180" />
          </span>
        </span>
      </summary>
      {error ? (
        <p className="px-lg py-lg text-body-sm text-error">{error}</p>
      ) : rows.length === 0 ? (
        <p className="px-lg py-lg text-body-sm text-muted">No booked calls yet. New bookings appear here with a prep brief.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Founder</th>
                <th className="px-lg py-sm font-medium">Company</th>
                <th className="px-lg py-sm font-medium">Call</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium">Investor fit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const call = p.nextCall ?? p.lastCall;
                const raise = [p.brief?.raise.stage, p.brief?.raise.amount].filter(Boolean).join(", ");
                return (
                  <ProspectRow
                    key={p.id}
                    prospect={{
                      id: p.id,
                      name: p.name,
                      email: p.email,
                      companyName: p.company_name,
                      website: p.website,
                      status: p.status,
                      callId: call?.id ?? null,
                      callStart: call?.start_time ?? null,
                    }}
                  >
                    <td className="px-lg py-md">
                      <span className="text-primary">{p.name || p.email}</span>
                      <p className="text-body-sm text-muted">{p.email}</p>
                    </td>
                    <td className="px-lg py-md text-body">
                      {p.company_name || p.brief?.company.website || <span className="text-muted">–</span>}
                      {raise ? <p className="text-body-sm text-muted">{raise}</p> : null}
                    </td>
                    <td className="px-lg py-md text-body">
                      {call ? formatWhen(call.start_time, null, ADMIN_TIME_ZONE) : <span className="text-muted">–</span>}
                      {p.nextCall ? <p className="text-body-sm text-primary">Upcoming</p> : null}
                    </td>
                    <td className="px-lg py-md">
                      <span className={`inline-flex rounded-full border border-border px-sm py-xs text-label uppercase tracking-label ${STATUS_STYLE[p.status] ?? "text-secondary"}`}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-lg py-md text-muted">
                      {estimateReady(p.match) ? (
                        <span className="text-body">~{p.match.count.toLocaleString("en-US")} funds</span>
                      ) : p.brief_status === "ready" ? (
                        `Needs ${estimateMissing(p.match).join(", ")}`
                      ) : p.brief_status === "running" || p.brief_status === "pending" ? (
                        "Preparing…"
                      ) : p.brief_status === "failed" ? (
                        <span className="text-error">Brief failed</span>
                      ) : (
                        "–"
                      )}
                    </td>
                  </ProspectRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
