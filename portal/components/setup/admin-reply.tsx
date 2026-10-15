/** Rupert's reply on a review step, shown above the client's confirm action. */
export function AdminReply({ note }: { note?: string }) {
  if (!note?.trim()) return null;
  return (
    <section className="mb-md rounded-card border border-border bg-surface px-lg py-md">
      <p className="text-label uppercase tracking-label text-muted">From Rupert</p>
      <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{note}</p>
    </section>
  );
}
