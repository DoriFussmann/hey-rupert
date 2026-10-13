import Link from "next/link";

/**
 * Says plainly whose turn it is, at the top of every Setup page:
 * the client's ("Your turn"), Rupert's, or done.
 */
export function TurnBanner({
  owner,
  title,
  detail,
  href,
  cta,
}: {
  owner: "client" | "rupert" | "done";
  title: string;
  detail?: string;
  href?: string;
  cta?: string;
}) {
  const styles = {
    client: "border-primary/30 bg-primary-tint",
    rupert: "border-border bg-surface",
    done: "border-border bg-surface",
  }[owner];
  const kicker = {
    client: "Your turn",
    rupert: "Rupert's turn",
    done: "Done",
  }[owner];
  const kickerColor = {
    client: "text-primary",
    rupert: "text-muted",
    done: "text-success",
  }[owner];

  return (
    <section
      role="status"
      className={`mb-lg flex flex-wrap items-center justify-between gap-md rounded-card border px-lg py-md ${styles}`}
    >
      <div className="min-w-0">
        <p className={`text-label uppercase tracking-label ${kickerColor}`}>
          {kicker}
        </p>
        <p className="mt-xs text-body-sm text-heading">{title}</p>
        {detail ? <p className="text-body-sm text-muted">{detail}</p> : null}
      </div>
      {href && cta ? (
        <Link
          href={href}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover"
        >
          {cta}
        </Link>
      ) : null}
    </section>
  );
}
