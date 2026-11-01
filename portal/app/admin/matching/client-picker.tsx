"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/select";

/** Picks the client the Matching page works on. */
export function ClientPicker({
  clients,
  selectedId,
}: {
  clients: { id: string; name: string }[];
  /** The picked client, or null. */
  selectedId: string | null;
}) {
  const router = useRouter();
  const listed = clients.some((client) => client.id === selectedId);

  return (
    <label className="flex w-full items-center gap-sm text-label uppercase tracking-label text-muted sm:w-80">
      Client
      <Select
        value={listed && selectedId ? selectedId : ""}
        onChange={(event) => {
          const id = event.target.value;
          router.push(id ? `/admin/matching?client=${encodeURIComponent(id)}` : "/admin/matching");
        }}
        className="normal-case tracking-normal !py-[6px]"
        wrapperClassName="!mt-0 flex-1"
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
