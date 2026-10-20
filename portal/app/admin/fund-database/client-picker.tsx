"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/select";
import { matchPath } from "@/lib/match/shared";

/** Picks the client Rupert Match runs for on the Fund Database page. */
export function ClientPicker({
  clients,
  selectedId,
}: {
  clients: { id: string; name: string }[];
  /** The picked client, or null. May be a client not in the list (the sandbox). */
  selectedId: string | null;
}) {
  const router = useRouter();
  const listed = clients.some((client) => client.id === selectedId);

  return (
    <label className="block max-w-md text-label uppercase tracking-label text-muted">
      Client
      <Select
        value={listed && selectedId ? selectedId : ""}
        onChange={(event) => {
          const id = event.target.value;
          router.push(id ? matchPath(id) : "/admin/fund-database");
        }}
        className="normal-case tracking-normal"
      >
        <option value="">{clients.length > 0 ? "Choose a client…" : "No active clients"}</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>
            {client.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
