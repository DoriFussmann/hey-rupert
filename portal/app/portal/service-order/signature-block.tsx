import { formatDate } from "@/lib/format";

export function SignatureBlock({
  party,
  company,
  signature,
  name,
  title,
  date,
  pending = false,
}: {
  party: string;
  company: string;
  /** Name rendered as the signature. Empty shows the signing line only. */
  signature: string;
  name: string;
  title: string;
  date: string | null;
  /** True while the client is still typing: the signature is a preview. */
  pending?: boolean;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-lg">
      <p className="text-label uppercase tracking-label text-muted">{party}</p>
      <p className="mt-xs text-body-sm text-heading">{company || "—"}</p>

      <div className="mt-md flex min-h-[64px] items-end border-b border-heading/40 pb-xs">
        {signature ? (
          <span
            className={`font-signature text-[34px] leading-none ${
              pending ? "text-heading/50" : "text-heading"
            }`}
          >
            {signature}
          </span>
        ) : (
          <span className="text-body-sm text-muted">Signature</span>
        )}
      </div>

      <dl className="mt-md grid grid-cols-[auto_1fr] gap-x-md gap-y-xs text-body-sm">
        <dt className="text-muted">Name</dt>
        <dd className="text-heading">{name || "—"}</dd>
        <dt className="text-muted">Title</dt>
        <dd className="text-heading">{title || "—"}</dd>
        <dt className="text-muted">Date</dt>
        <dd className="text-heading">
          {date ? formatDate(date) : pending ? "On signing" : "—"}
        </dd>
      </dl>
    </div>
  );
}
