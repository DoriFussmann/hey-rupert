"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Select } from "@/components/select";
import type { Client, ClientStatus } from "@/lib/types";

const statuses: { value: ClientStatus; label: string }[] = [
  { value: "onboarding", label: "Onboarding" },
  { value: "preparation", label: "Preparation" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

export function ClientForm({ client }: { client: Client }) {
  const [saved, setSaved] = useState(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-lg rounded-card border border-border bg-surface p-lg md:grid-cols-2"
    >
      <label className="block text-label uppercase tracking-label text-muted">
        Company
        <input
          name="company_name"
          defaultValue={client.company_name}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Status
        <Select name="status" defaultValue={client.status}>
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </Select>
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Founder
        <input
          name="founder_name"
          defaultValue={client.founder_name}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Email
        <input
          name="founder_email"
          type="email"
          defaultValue={client.founder_email}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Raise stage
        <input
          name="raise_stage"
          defaultValue={client.raise_stage}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Raise amount
        <input
          name="raise_amount"
          defaultValue={client.raise_amount ?? ""}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <label className="block text-label uppercase tracking-label text-muted">
        Sector
        <input
          name="sector"
          defaultValue={client.sector ?? ""}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <div className="flex items-end">
        <StatusBadge status={client.status} />
      </div>
      <label className="block text-label uppercase tracking-label text-muted md:col-span-2">
        Notes
        <textarea
          name="notes"
          defaultValue={client.notes ?? ""}
          rows={5}
          className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
        />
      </label>
      <div className="md:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover"
        >
          Save changes
        </button>
        {saved ? (
          <p className="mt-sm text-body-sm text-success">
            Changes saved locally until the clients table is connected.
          </p>
        ) : null}
      </div>
    </form>
  );
}
