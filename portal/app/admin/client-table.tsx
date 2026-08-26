"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import type { Client } from "@/lib/types";

export function ClientTable({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) =>
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
  }, [clients, query]);

  return (
    <div className="rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <label className="block text-label uppercase tracking-label text-muted">
          Search
          <input
            className="mt-sm w-full max-w-md rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Company, founder, stage"
          />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="px-lg py-sm font-medium">Company</th>
              <th className="px-lg py-sm font-medium">Founder</th>
              <th className="px-lg py-sm font-medium">Stage</th>
              <th className="px-lg py-sm font-medium">Status</th>
              <th className="px-lg py-sm font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((client) => (
              <tr key={client.id} className="border-b border-border last:border-b-0">
                <td className="px-lg py-md">
                  <Link
                    href={`/admin/clients/${client.id}`}
                    className="text-heading no-underline transition-colors duration-hover hover:text-primary"
                  >
                    {client.company_name}
                  </Link>
                  <p className="text-muted">
                    {client.vertical || client.sector}
                  </p>
                </td>
                <td className="px-lg py-md">
                  <p>
                    {[client.first_name, client.last_name]
                      .filter(Boolean)
                      .join(" ") || client.founder_name}
                  </p>
                  <p className="font-mono text-mono text-muted">
                    {client.email || client.founder_email}
                  </p>
                </td>
                <td className="px-lg py-md">{client.raise_stage}</td>
                <td className="px-lg py-md">
                  <StatusBadge status={client.stage || client.status} />
                </td>
                <td className="px-lg py-md text-muted">
                  {formatDate(client.last_activity_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
