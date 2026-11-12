import Link from "next/link";
import { notFound } from "next/navigation";
import { AddClientButton } from "@/app/admin/add-client-panel";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { isServiceRoleConfigured } from "@/lib/env";
import { STATUS_LABEL, answerText, clientPrefill, formatWhen, type FitOptions } from "@/lib/prospects/core";
import { ADMIN_TIME_ZONE, estimateOptions, loadProspect, type CallRow } from "@/lib/prospects/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { AfterCall, BriefAndFit, type PanelProspect } from "./prospect-panel";

// Refresh brief researches the web in a server action on this page.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const EMAIL_STATUS: Record<string, string> = {
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

function emailLine(label: string, status: CallRow["prep_email_status"], at: string | null, error?: string | null) {
  if (!status) return `${label}: not scheduled`;
  const when = at ? ` · ${formatWhen(at, null, ADMIN_TIME_ZONE)}` : "";
  return `${label}: ${EMAIL_STATUS[status] ?? status}${when}${status === "failed" && error ? ` (${error})` : ""}`;
}

export default async function ProspectPage({ params }: { params: { id: string } }) {
  if (!isServiceRoleConfigured() || !/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createServiceClient();
  const [loaded, opts] = await Promise.all([loadProspect(supabase, params.id), estimateOptions(supabase)]);
  if (!loaded.ok) {
    if (loaded.error === "Prospect not found.") notFound();
    return (
      <>
        <BackLink href="/admin" label="← Clients & Prospects" />
        <p className="text-body-sm text-error">{loaded.error}</p>
      </>
    );
  }
  const { prospect, calls } = loaded;
  const options: FitOptions | null = opts.ok ? opts.options : null;
  const shownCalls = calls.filter((c) => c.status !== "RESCHEDULED");
  const latest = shownCalls[0] ?? calls[0] ?? null;
  const answers = Object.entries(latest?.responses ?? {})
    .filter(([name]) => !["name", "email", "location", "title", "rescheduleReason", "attendeePhoneNumber"].includes(name))
    .map(([name, a]) => ({ name, label: a.label, value: answerText(a.value) }))
    .filter((a): a is { name: string; label: string; value: string } => Boolean(a.value));

  const panel: PanelProspect = {
    id: prospect.id,
    email: prospect.email,
    name: prospect.name,
    status: prospect.status,
    brief: prospect.brief,
    briefStatus: prospect.brief_status,
    briefError: prospect.brief_error,
    briefAt: prospect.brief_at,
    match: prospect.match,
    outcomeNotes: prospect.outcome_notes,
    outcomeAt: prospect.outcome_at,
    followUp: prospect.follow_up,
    followUpSentAt: prospect.follow_up_sent_at,
    converted: Boolean(prospect.client_id),
  };

  return (
    <>
      <BackLink href="/admin" label="← Clients & Prospects" />
      <PageHeader
        title={prospect.name || prospect.email}
        description={[prospect.company_name, prospect.email, STATUS_LABEL[prospect.status]].filter(Boolean).join(" · ")}
        actions={
          prospect.client_id ? (
            <Link href={`/admin/clients/${prospect.client_id}`} className="rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline hover:bg-primary-hover">
              Open client →
            </Link>
          ) : (
            <AddClientButton label="Convert to client" initial={clientPrefill(prospect)} />
          )
        }
      />

      <div className="grid gap-lg lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <BriefAndFit prospect={panel} options={options} optionsError={opts.ok ? null : opts.error} />
        <div className="grid content-start gap-lg">
          <section className="rounded-card border border-border bg-surface px-lg py-md">
            <h2 className="text-h4">Calls</h2>
            {shownCalls.length === 0 ? <p className="mt-sm text-body-sm text-muted">No calls.</p> : null}
            <ul className="mt-sm grid gap-md">
              {shownCalls.map((call) => (
                <li key={call.id} className="text-body-sm">
                  <p className="text-body">
                    {formatWhen(call.start_time, call.end_time, ADMIN_TIME_ZONE)}
                    <span className="ml-sm text-label uppercase tracking-label text-muted">{call.status.toLowerCase()}</span>
                  </p>
                  <p className="text-muted">{call.event_title}</p>
                  {call.video_url && call.status === "ACCEPTED" ? (
                    <a href={call.video_url} target="_blank" rel="noreferrer" className="text-primary">
                      Join link
                    </a>
                  ) : null}
                  <p className="mt-xs text-muted">{emailLine("Prep email (30 min before)", call.prep_email_status, call.prep_email_at, call.prep_email_error)}</p>
                  <p className="text-muted">{emailLine("Check-in (after the call)", call.checkin_email_status, call.checkin_email_at)}</p>
                  {call.cancellation_reason ? <p className="text-muted">Cancelled: {call.cancellation_reason}</p> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-border bg-surface px-lg py-md">
            <h2 className="text-h4">What they told us</h2>
            <dl className="mt-sm grid gap-sm text-body-sm">
              {answers.map((a) => (
                <div key={a.name}>
                  <dt className="text-label uppercase tracking-label text-muted">{a.label}</dt>
                  <dd className="text-body">{a.value}</dd>
                </div>
              ))}
              {prospect.heard_from && !answers.some((a) => /hear/i.test(a.name)) ? (
                <div>
                  <dt className="text-label uppercase tracking-label text-muted">Heard about us</dt>
                  <dd className="text-body">{prospect.heard_from}</dd>
                </div>
              ) : null}
              {prospect.utm ? (
                <div>
                  <dt className="text-label uppercase tracking-label text-muted">Campaign</dt>
                  <dd className="text-body">{Object.entries(prospect.utm).map(([k, v]) => `${k.replace("utm_", "")}: ${v}`).join(" · ")}</dd>
                </div>
              ) : null}
              {answers.length === 0 && !prospect.heard_from ? <p className="text-muted">Nothing beyond name and email.</p> : null}
            </dl>
          </section>
          <AfterCall prospect={panel} />
        </div>
      </div>
    </>
  );
}
