"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import type { Client } from "@/lib/types";

export function ClientTable({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
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
    if (!needle) return scoped;
    return scoped.filter((client) =>
      [
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
        .some((value) => value!.toLowerCase().includes(needle)),
    );
  }, [scoped, query]);

  const archivedCount = clients.filter((client) => client.archived_at).length;
  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
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
      {filtered.length === 0 ? (
        <p className="px-lg py-xl text-body-sm text-muted">
          {view === "archived"
            ? "No archived clients."
            : query.trim()
              ? "No clients match that search."
              : "No clients yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">Company</th>
                <th className="px-lg py-sm font-medium">Founder</th>
                <th className="px-lg py-sm font-medium">Status</th>
                <th className="px-lg py-sm font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((client) => {
                const href = `/admin/clients/${client.id}`;
                const name =
                  client.company_name ||
                  client.founder_name ||
                  client.email ||
                  "Open client";

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
                        {name}
                      </Link>
                      <p className="text-muted">
                        {client.vertical || client.sector}
                      </p>
                    </td>
                    <td className="px-lg py-md">
                      {[client.first_name, client.last_name]
                        .filter(Boolean)
                        .join(" ") || client.founder_name}
                    </td>
                    <td className="px-lg py-md">
                      <StatusBadge status={client.stage || client.status} />
                    </td>
                    <td className="px-lg py-md text-muted">
                      {formatDate(client.last_activity_at)}
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
