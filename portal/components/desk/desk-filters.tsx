"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DESK_STATUSES,
  DESK_STEPS,
  DESK_TYPES,
  STATUS_LABEL_ADMIN,
  STATUS_LABEL_CLIENT,
  STEP_LABEL,
  TYPE_LABEL,
  type DeskOpener,
} from "@/lib/desk";

const select =
  "cursor-pointer rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body outline-none focus:border-primary";

/** Step, type and status filters for a Desk list. They live in the URL, so a filtered list can be linked to. */
export function DeskFilters({ side }: { side: DeskOpener }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = side === "client" ? STATUS_LABEL_CLIENT : STATUS_LABEL_ADMIN;

  function set(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  const active = ["step", "type", "status"].some((name) => params.get(name));

  return (
    <div className="flex flex-wrap items-center gap-sm">
      <select className={select} aria-label="Step" value={params.get("step") ?? ""} onChange={(event) => set("step", event.target.value)}>
        <option value="">All steps</option>
        {DESK_STEPS.map((step) => (
          <option key={step} value={step}>
            {STEP_LABEL[step]}
          </option>
        ))}
      </select>
      <select className={select} aria-label="Type" value={params.get("type") ?? ""} onChange={(event) => set("type", event.target.value)}>
        <option value="">All types</option>
        {DESK_TYPES.map((type) => (
          <option key={type} value={type}>
            {TYPE_LABEL[type]}
          </option>
        ))}
      </select>
      <select className={select} aria-label="Status" value={params.get("status") ?? ""} onChange={(event) => set("status", event.target.value)}>
        <option value="">Any status</option>
        {DESK_STATUSES.map((value) => (
          <option key={value} value={value}>
            {status[value]}
          </option>
        ))}
      </select>
      {active ? (
        <button type="button" className="text-body-sm text-primary underline" onClick={() => router.replace(pathname, { scroll: false })}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
