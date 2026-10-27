"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ViewAsClientLink } from "@/components/eye-icon";
import { ProgressBar } from "@/components/progress-bar";
import { StagePill } from "@/components/stage-pill";
import { nextActionText, overallProgress } from "@/lib/progress";
import type { Client } from "@/lib/types";
import { isKickoffReady } from "@/lib/service-order";
import type { Readiness } from "@/lib/company-profile/core";
import { matchPath } from "@/lib/match/shared";

const MATCH_READY: Record<Readiness, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "text-success" },
  limited: { label: "Limited", tone: "text-warning" },
  blocked: { label: "Blocked", tone: "text-error" },
};

function clientName(client: Client) {
  return (
    [client.first_name, client.last_name].filter(Boolean).join(" ") ||
    client.founder_name
  );
}

function matches(client: Client, needle: string) {
  if (!needle) return true;
  return [
    client.company_name,
    client.first_name,
    client.last_name,
    client.founder_name,
    client.email,
    client.founder_email,
    client.raise_stage,
    client.vertical,
    client.sector,
    client.geography,
    client.stage,
    client.status,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(needle));
}

/**
 * Clients in three groups: Active (Service Order signed and Setup Fee paid),
 * Prospects (not signed or paid yet), and Archived, folded away at the bottom.
 */
export function ClientTable({
  clients,
  readiness = {},
}: {
  clients: Client[];
  /** Whether each client's profile can be matched, by client id. */
  readiness?: Record<string, Readiness>;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const shown = clients.filter((client) => matches(client, needle));
    return {
      active: shown.filter(
        (client) => !client.archived_at && isKickoffReady(client),
      ),
      prospects: shown.filter(
        (client) => !client.archived_at && !isKickoffReady(client),
      ),
      archived: shown.filter((client) => Boolean(client.archived_at)),
    };
  }, [clients, needle]);

  const empty = needle ? "No clients match your search." : null;

  return (
    <div className="grid gap-lg">
      <label className="block max-w-md text-label uppercase tracking-label text-muted">
        Search
        <input
          className="mt-sm w-full rounded-md border border-border bg-surface px-sm py-sm text-body-sm text-body outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Company, founder"
        />
      </label>

      <ClientSection
        title="Active clients"
        hint="Service Order signed and Setup Fee paid."
        clients={groups.active}
        readiness={readiness}
        empty={empty ?? "No active clients yet."}
      />
      <ClientSection
        title="Prospects"
        hint="Not signed or paid yet: Statement of Work and Service Order."
        clients={groups.prospects}
        readiness={readiness}
        empty={empty ?? "No prospects right now."}
      />
      {groups.archived.length > 0 || !needle ? (
        <details
          className="group rounded-card border border-border bg-surface"
          open={Boolean(needle) && groups.archived.length > 0}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between px-lg py-md">
            <span className="text-h4">
              Archived{" "}
              <span className="text-muted">({groups.archived.length})</span>
            </span>
            <span className="text-body-sm text-muted group-open:hidden">
              Show
            </span>
            <span className="hidden text-body-sm text-muted group-open:inline">
              Hide
            </span>
          </summary>
          <div className="border-t border-border">
            <ClientRows
              clients={groups.archived}
              readiness={readiness}
              empty="No archived clients."
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ClientSection({
  title,
  hint,
  clients,
  readiness,
  empty,
}: {
  title: string;
  hint: string;
  clients: Client[];
  readiness: Record<string, Readiness>;
  empty: string;
}) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-sm border-b border-border px-lg py-md">
        <h2 className="text-h4">
          {title} <span className="text-muted">({clients.length})</span>
        </h2>
        <p className="text-body-sm text-muted">{hint}</p>
      </div>
      <ClientRows clients={clients} readiness={readiness} empty={empty} />
    </section>
  );
}

function ClientRows({
  clients,
  readiness,
  empty,
}: {
  clients: Client[];
  readiness: Record<string, Readiness>;
  empty: string;
}) {
  const router = useRouter();
  if (clients.length === 0)
    return <p className="px-lg py-lg text-body-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-body-sm">
        <thead>
          <tr className="border-b border-border text-label uppercase tracking-label text-muted">
            <th className="px-lg py-sm font-medium">Client</th>
            <th className="px-lg py-sm font-medium">Stage</th>
            <th className="px-lg py-sm font-medium">Progress</th>
            <th className="px-lg py-sm font-medium">Next action</th>
            <th className="px-lg py-sm font-medium">Ready to match</th>
            <th className="px-lg py-sm font-medium">
              <span className="sr-only">View as client</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => {
            const href = `/admin/clients/${client.id}`;
            const company = client.company_name;
            const person = clientName(client);
            const heading = company || person || client.email || "Open client";
            const sub = company && person && person !== company ? person : "";
            const progress = overallProgress(client);

            return (
              <tr
                key={client.id}
                className="cursor-pointer border-b border-border last:border-b-0 transition-colors duration-hover hover:bg-background"
                onClick={() => router.push(href)}
              >
                <td className="px-lg py-md">
                  <Link
                    href={href}
                    onClick={(event) => event.stopPropagation()}
                    className="text-primary no-underline transition-colors duration-hover hover:text-primary-hover"
                  >
                    {heading}
                  </Link>
                  {client.is_test_pilot ? (
                    <span className="ml-sm inline-flex rounded-full border border-warning/40 px-sm py-px align-middle text-label uppercase tracking-label text-warning">
                      Test
                    </span>
                  ) : null}
                  {sub ? <p className="text-muted">{sub}</p> : null}
                </td>
                <td className="px-lg py-md">
                  <StagePill stage={client.stage} />
                </td>
                <td className="px-lg py-md">
                  <ProgressBar value={progress.complete} max={progress.total} />
                  <p className="mt-xs text-body-sm text-muted">
                    {progress.complete} of {progress.total} complete
                  </p>
                </td>
                <td className="px-lg py-md text-muted">
                  {nextActionText(client)}
                </td>
                <td className="px-lg py-md">
                  {readiness[client.id] ? (
                    <Link
                      href={matchPath(client.id)}
                      onClick={(event) => event.stopPropagation()}
                      className={`${MATCH_READY[readiness[client.id]].tone} no-underline hover:underline`}
                    >
                      {MATCH_READY[readiness[client.id]].label}
                    </Link>
                  ) : (
                    <span className="text-muted">–</span>
                  )}
                </td>
                <td className="px-sm py-md text-right">
                  <ViewAsClientLink clientId={client.id} label={heading} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
