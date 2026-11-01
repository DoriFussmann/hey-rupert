import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "@/components/chevron";

const selectClassName =
  "w-full cursor-pointer appearance-none rounded-md border border-border bg-background py-sm pl-sm pr-xl text-body-sm text-body outline-none";

export function Select({
  className,
  wrapperClassName,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <span className={["relative mt-sm block", wrapperClassName].filter(Boolean).join(" ")}>
      <select
        className={[selectClassName, className].filter(Boolean).join(" ")}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-sm top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </span>
  );
}
