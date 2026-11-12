import Link from "next/link";
import { STATUS_LABEL, estimateMissing, estimateReady, formatWhen } from "@/lib/prospects/core";
import { ADMIN_TIME_ZONE, type ProspectListItem } from "@/lib/prospects/server";

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
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
        <h2 className="text-h4">
          Calls booked <span className="text-muted">({prospects.length})</span>
        </h2>
        <p className="text-body-sm text-muted">Booked a call on Cal.com, not a client yet. Convert one from their page.</p>
      </div>
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
                const href = `/admin/prospects/${p.id}`;
                const raise = [p.brief?.raise.stage, p.brief?.raise.amount].filter(Boolean).join(", ");
                return (
                  <tr key={p.id} className="border-b border-border last:border-b-0 transition-colors duration-hover hover:bg-background">
                    <td className="px-lg py-md">
                      <Link href={href} className="text-primary no-underline transition-colors duration-hover hover:text-primary-hover">
                        {p.name || p.email}
                      </Link>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
