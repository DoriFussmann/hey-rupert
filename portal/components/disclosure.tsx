import type { ReactNode } from "react";
import { ChevronDown } from "@/components/chevron";

/**
 * A collapsible group of panels on a long admin page: a ruled heading row
 * with a chevron, and the panels (their own cards) below it. Native
 * <details>: keyboard and screen-reader friendly, no JS. Give it an `id` so
 * "Go to" links can open it.
 */
export function Disclosure({
  id,
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  /** Short status shown next to the title, e.g. "2 steps". */
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={defaultOpen} className="group/disclosure mt-lg scroll-mt-lg">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-md border-b border-border py-sm text-secondary transition-colors duration-hover hover:text-heading [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-sm">
          <span className="text-h4 text-heading">{title}</span>
          {meta ? <span className="truncate text-body-sm text-muted">{meta}</span> : null}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
          <ChevronDown className="h-4 w-4 transition-transform duration-hover group-open/disclosure:rotate-180" />
        </span>
      </summary>
      <div className="pb-sm">{children}</div>
    </details>
  );
}
