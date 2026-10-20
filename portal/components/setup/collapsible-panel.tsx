import type { ReactNode } from "react";
import { ChevronDown } from "@/components/chevron";

/**
 * A card that opens and closes: the title row is the toggle, the content sits
 * below it. Closed by default. Native <details>: keyboard and screen-reader
 * friendly, no JS.
 */
export function CollapsiblePanel({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** One line under the title, e.g. when it was shared. */
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group/panel min-w-0 rounded-card border border-border bg-surface"
    >
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-md px-lg py-md text-secondary transition-colors duration-hover hover:text-heading [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-h4 text-heading">{title}</span>
          {meta ? <span className="mt-xs block text-body-sm text-muted">{meta}</span> : null}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
          <ChevronDown className="h-4 w-4 transition-transform duration-hover group-open/panel:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border px-lg py-lg">{children}</div>
    </details>
  );
}
