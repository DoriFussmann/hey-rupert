/**
 * Finished work on a client page, collapsed by default so open work stays
 * at the top. Native <details>: keyboard and screen-reader friendly, no JS.
 */
export function CompletedPanel({
  count,
  children,
}: {
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <details className="group/completed mt-xl rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-between gap-md px-lg py-md">
        <span className="flex items-center gap-sm">
          <span
            aria-hidden
            className="inline-block text-muted transition-transform duration-hover group-open/completed:rotate-90"
          >
            ›
          </span>
          <span className="text-h4">Completed</span>
          <span className="font-mono text-mono text-muted">{count}</span>
        </span>
        <span className="text-body-sm text-muted group-open/completed:hidden">Show</span>
        <span className="hidden text-body-sm text-muted group-open/completed:inline">
          Hide
        </span>
      </summary>
      <div className="border-t border-border px-lg pb-lg">{children}</div>
    </details>
  );
}
