export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-xl flex flex-wrap items-end justify-between gap-md">
      <div>
        <h1 className="text-h1 font-light">{title}</h1>
        {description ? (
          <p className="mt-sm max-w-prose text-body-sm text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
