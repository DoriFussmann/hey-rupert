"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ProgressBar } from "@/components/progress-bar";
import { StagePill } from "@/components/stage-pill";
import { nextActionText, overallProgress } from "@/lib/progress";
import type { Client, EngagementStage } from "@/lib/types";

const STAGE_FILTERS: { value: "all" | EngagementStage; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sow", label: "SOW" },
  { value: "service_order", label: "Service Order" },
  { value: "nda", label: "NDA" },
  { value: "intake", label: "Intake" },
  { value: "payment", label: "Payment" },
  { value: "setup", label: "Setup" },
  { value: "live", label: "Live" },
];

function clientName(client: Client) {
  return (
    [client.first_name, client.last_name].filter(Boolean).join(" ") ||
    client.founder_name
  );
}

export function ClientTable({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"all" | EngagementStage>("all");
  const [view, setView] = useState<"active" | "archived">("active");

  const scoped = useMemo(
    () =>
      clients.filter((client) =>
        view === "archived" ? Boolean(client.archived_at) : !client.archived_at,
      ),
    [clients, view],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scoped.filter((client) => {
      if (stage !== "all" && client.stage !== stage) return false;
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
    });
  }, [scoped, query, stage]);

  const archivedCount = clients.filter((client) => client.archived_at).length;
  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;
  const filterClass = (active: boolean) =>
    `rounded-md px-sm py-xs text-body-sm transition-colors duration-hover ${
      active
        ? "border border-transparent bg-primary-tint text-heading"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <div className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-end justify-between gap-md border-b border-border px-lg py-md">
        <label className="block text-label uppercase tracking-label text-muted">
          Search
          <input
            className="mt-sm w-full max-w-md rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, founder"
          />
        </label>
        <div className="flex gap-sm">
          <button
            type="button"
            className={tabClass(view === "active")}
            onClick={() => setView("active")}
          >
            Active
          </button>
          <button
            type="button"
            className={tabClass(view === "archived")}
            onClick={() => setView("archived")}
          >
            Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-sm border-b border-border px-lg py-md">
        <p className="mr-sm text-label uppercase tracking-label text-muted">
          Stage
        </p>
        {STAGE_FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={stage === option.value}
            className={filterClass(stage === option.value)}
            onClick={() => setStage(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p className="px-lg py-xl text-body-sm text-muted">
          {view === "archived"
            ? "No archived clients."
            : query.trim() || stage !== "all"
              ? "No clients match those filters."
              : "No clients yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Client</th>
                <th className="px-lg py-sm font-medium">Stage</th>
                <th className="px-lg py-sm font-medium">Progress</th>
                <th className="px-lg py-sm font-medium">Next action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const href = `/admin/clients/${client.id}`;
                const company = client.company_name;
                const person = clientName(client);
                const heading =
                  company || person || client.email || "Open client";
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
                      {sub ? <p className="text-muted">{sub}</p> : null}
                    </td>
                    <td className="px-lg py-md">
                      <StagePill stage={client.stage} />
                    </td>
                    <td className="px-lg py-md">
                      <ProgressBar
                        value={progress.complete}
                        max={progress.total}
                      />
                      <p className="mt-xs text-body-sm text-muted">
                        {progress.complete} of {progress.total} complete
                      </p>
                    </td>
                    <td className="px-lg py-md text-muted">
                      {nextActionText(client)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
