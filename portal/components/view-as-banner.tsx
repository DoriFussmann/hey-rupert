// Shown across the portal while an admin is viewing it as a client.
export function ViewAsBanner({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="mb-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-primary/30 bg-primary-tint px-lg py-sm"
    >
      <p className="text-body-sm text-heading">
        Viewing as <span className="font-medium">{label}</span>
        <span className="text-secondary"> · read-only</span>
      </p>
      {/* Plain anchor: the exit route clears a cookie and must not be prefetched. */}
      <a
        href="/portal/exit-view"
        className="text-body-sm text-primary no-underline hover:text-primary-hover"
      >
        Exit
      </a>
    </div>
  );
}

// Shown across the portal to a view-only viewer the client asked to be added.
export function ViewerBanner({ company }: { company: string }) {
  return (
    <div
      role="status"
      className="mb-lg rounded-card border border-primary/30 bg-primary-tint px-lg py-sm"
    >
      <p className="text-body-sm text-heading">
        You have view-only access to{" "}
        <span className="font-medium">{company}</span>
        <span className="text-secondary">
          {" "}
          · you can see everything and leave comments, but can&apos;t make changes
        </span>
      </p>
    </div>
  );
}
