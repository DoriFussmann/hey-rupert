"use client";

export function EyeIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M1.75 10S4.75 4.25 10 4.25 18.25 10 18.25 10 15.25 15.75 10 15.75 1.75 10 1.75 10Z"
      />
      <circle
        cx="10"
        cy="10"
        r="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// Plain anchor on purpose: the target route sets a cookie, so it must not be
// prefetched the way next/link prefetches.
export function ViewAsClientLink({
  clientId,
  label,
  variant = "icon",
}: {
  clientId: string;
  label: string;
  variant?: "icon" | "button";
}) {
  const href = `/admin/clients/${clientId}/view`;

  if (variant === "button") {
    return (
      <a
        href={href}
        className="inline-flex items-center gap-sm rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading"
      >
        <EyeIcon />
        View as client
      </a>
    );
  }

  return (
    <a
      href={href}
      onClick={(event) => event.stopPropagation()}
      aria-label={`View portal as ${label}`}
      title="View as client"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted no-underline transition-colors duration-hover hover:bg-primary-tint hover:text-primary"
    >
      <EyeIcon />
    </a>
  );
}
