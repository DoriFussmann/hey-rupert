import type { ReactNode } from "react";
import { ChevronDown } from "@/components/chevron";

/**
 * A <summary> in the house style: the title, and a round chevron on the right
 * that turns when open. Put `group/drop` on the parent <details>.
 */
export function DropSummary({ children }: { children: ReactNode }) {
  return (
    <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-md rounded-md border border-border bg-background px-md py-sm text-secondary transition-colors duration-hover hover:text-heading [&::-webkit-details-marker]:hidden">
      <span className="text-body-sm text-heading">{children}</span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
        <ChevronDown className="h-4 w-4 transition-transform duration-hover group-open/drop:rotate-180" />
      </span>
    </summary>
  );
}
