export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-card border border-border bg-surface px-lg py-xl">
      <h2 className="text-h4 text-heading">{title}</h2>
      <p className="mt-sm max-w-prose text-body-sm text-muted">{description}</p>
    </div>
  );
}
