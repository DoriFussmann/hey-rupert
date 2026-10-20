"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/select";

export function NudgeClientPicker({
  clients,
  selectedId,
}: {
  clients: { id: string; label: string; waiting: boolean }[];
  selectedId: string;
}) {
  const router = useRouter();

  return (
    <div className="mb-lg flex flex-wrap items-end gap-md">
      <label className="block w-full max-w-md text-label uppercase tracking-label text-muted">
        Client
        <Select
          value={selectedId}
          className="normal-case tracking-normal"
          onChange={(event) => {
            const id = event.target.value;
            router.push(id ? `/admin/nudge?client=${encodeURIComponent(id)}` : "/admin/nudge");
          }}
        >
          <option value="">All clients</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.label}
              {client.waiting ? " · waiting on client" : ""}
            </option>
          ))}
        </Select>
      </label>
      {selectedId ? (
        <Link href="/admin/nudge" className="pb-sm text-body-sm text-primary hover:text-primary-hover">
          Back to all clients
        </Link>
      ) : null}
    </div>
  );
}
