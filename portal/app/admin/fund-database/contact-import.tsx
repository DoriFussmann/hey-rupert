"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { applyContacts, discardContacts } from "@/app/admin/match-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE,
  type ContactImportView,
} from "@/lib/match/contact-import";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Message = { kind: "ok" | "error"; text: string };

function n(value: number) {
  return value.toLocaleString("en-US");
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-md py-sm">
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      <p className={`mt-xs font-mono text-h4 ${tone}`}>{n(value)}</p>
    </div>
  );
}

function ImportPreview({
  staged,
  busy,
  onApply,
  onDiscard,
}: {
  staged: ContactImportView;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const { summary } = staged;
  return (
    <div className="mt-md rounded-card border border-primary/30 bg-background">
      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-primary">Ready to apply</p>
        <p className="mt-xs text-body text-heading">{staged.fileName}</p>
        <p className="text-body-sm text-muted">
          Read {formatDateAtTime(staged.createdAt)}
          {staged.createdBy ? ` by ${staged.createdBy}` : ""}. Nothing has changed yet.
        </p>
      </div>
      <div className="grid gap-sm px-lg py-md sm:grid-cols-2 lg:grid-cols-4">
        <Count label="Rows" value={summary.rows} tone="text-heading" />
        <Count label="Will be added" value={summary.added} tone="text-success" />
        <Count label="Duplicates, skipped" value={summary.duplicates} tone="text-secondary" />
        <Count label="Rejected" value={summary.rejectedCount} tone={summary.rejectedCount > 0 ? "text-error" : "text-secondary"} />
      </div>
      {summary.sample.length > 0 ? (
        <p className="px-lg pb-md text-body-sm text-muted">
          <span className="text-heading">Added, e.g.:</span> {summary.sample.join("; ")}
        </p>
      ) : null}
      {summary.duplicates > 0 ? (
        <p className="px-lg pb-md text-body-sm text-muted">
          Duplicates are emails already at that fund in the database, or listed twice in the file.
        </p>
      ) : null}
      {summary.rejected.length > 0 ? (
        <div className="px-lg pb-md">
          <p className="text-body-sm text-error">
            Rejected rows{summary.rejectedCount > summary.rejected.length ? ` (first ${n(summary.rejected.length)} of ${n(summary.rejectedCount)})` : ""}:
          </p>
          <ul className="mt-xs max-h-64 overflow-y-auto rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary">
            {summary.rejected.map((item) => (
              <li key={`${item.row}-${item.reason}`}>
                Row {n(item.row)}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-sm border-t border-border px-lg py-md">
        <button type="button" className={primaryButton} disabled={busy || summary.added === 0} onClick={onApply}>
          {summary.added > 0 ? `Apply: add ${n(summary.added)} contact${summary.added === 1 ? "" : "s"}` : "Nothing to add"}
        </button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** A contacts file read from Upload: what it adds, to apply or discard; and the file format. */
export function ContactImport({
  staged,
  error,
}: {
  staged: ContactImportView | null;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(error ? { kind: "error", text: error } : null);
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`;
  const required = IMPORT_COLUMNS.filter((column) => column.required && column.key !== "website");
  const optional = IMPORT_COLUMNS.filter((column) => !column.required);

  async function act(label: string, run: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setBusy(label);
    setMessage(null);
    try {
      const result = await run();
      setMessage(result.ok ? { kind: "ok", text: done } : { kind: "error", text: result.error });
      if (result.ok) router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Something went wrong.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section id="add-contacts" className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mb-sm text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}
        >
          {message.text}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="mb-sm text-body-sm text-primary">
          {busy}
        </p>
      ) : null}
      {staged ? (
        <ImportPreview
          staged={staged}
          busy={Boolean(busy)}
          onApply={() =>
            void act(
              "Adding the contacts…",
              () => applyContacts(staged.id),
              "Added. The contacts are in the live database; re-run a client's match to include them.",
            )
          }
          onDiscard={() => void act("Discarding…", () => discardContacts(staged.id), "Discarded. Nothing changed.")}
        />
      ) : null}
      <details className={staged ? "mt-md" : ""}>
        <summary className="cursor-pointer text-h4 text-heading">Contacts file format</summary>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Adds people to funds already in the Fund Database; they stay when the provider sends a new workbook. Up to{" "}
          {n(IMPORT_MAX_ROWS)} rows and 3 MB per file. Drop it in Upload above.
        </p>
        <dl className="mt-sm grid gap-sm text-body-sm sm:grid-cols-2">
          <div>
            <dt className="text-label uppercase tracking-label text-muted">Required columns</dt>
            <dd className="mt-xs text-heading">
              {required
                .map((column) => (column.key === "firmId" ? "FirmID (or Firm Website if there is no ID)" : column.header))
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-label uppercase tracking-label text-muted">Optional columns</dt>
            <dd className="mt-xs text-secondary">{optional.map((column) => column.header).join(", ")}</dd>
          </div>
        </dl>
        <p className="mt-sm text-body-sm text-muted">
          A file missing a required column is refused. Rows with an unknown fund, a missing value or a bad email are rejected
          and listed; emails already at that fund are skipped.
        </p>
        <div className="mt-sm">
          <a href={templateHref} download="contacts-template.csv" className={`${secondaryButton} inline-block no-underline`}>
            Download CSV template
          </a>
        </div>
      </details>
    </section>
  );
}
