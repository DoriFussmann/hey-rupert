"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyContacts, discardContacts, stageContacts } from "@/app/admin/match-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
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

/** Adds contacts to funds already in the Fund Database from a CSV: read, preview, apply. */
export function ContactImport({
  staged,
  error,
  hasLive,
}: {
  staged: ContactImportView | null;
  error: string | null;
  hasLive: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(error ? { kind: "error", text: error } : null);
  const [dragging, setDragging] = useState(false);
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`;
  const required = IMPORT_COLUMNS.filter((column) => column.required && column.key !== "website");
  const optional = IMPORT_COLUMNS.filter((column) => !column.required);
  const disabled = Boolean(busy) || !hasLive;

  async function read(file: File) {
    setMessage(null);
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setMessage({ kind: "error", text: "Upload a .csv file. In Excel or Google Sheets: File → Download → CSV." });
      return;
    }
    if (file.size > IMPORT_MAX_BYTES) {
      setMessage({ kind: "error", text: "The file must be under 3 MB. Split it into smaller files." });
      return;
    }
    setBusy("Reading the CSV…");
    try {
      const result = await stageContacts(file.name, await file.text());
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({ kind: "ok", text: "Read. Check the preview, then apply." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "The CSV could not be read.") });
    } finally {
      setBusy(null);
    }
  }

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
      <h2 className="text-h4 text-heading">Add contacts by CSV</h2>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        Adds people to funds already in the Fund Database. They stay in it when the provider sends a new workbook.
        Up to {n(IMPORT_MAX_ROWS)} rows and 3 MB per file.
      </p>
      <dl className="mt-md grid gap-sm text-body-sm sm:grid-cols-2">
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
        A file missing a required column is refused. Rows with an unknown fund, a missing value or a bad email are
        rejected and listed; emails already at that fund are skipped.
      </p>

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-md text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}
        >
          {message.text}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="mt-md text-body-sm text-primary">
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

      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a contacts CSV: drop it here or press Enter to browse"
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file && !disabled) void read(file);
        }}
        className={`mt-md flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-lg py-lg text-center transition-colors duration-hover ${
          dragging ? "border-primary bg-primary-tint" : "border-border bg-background hover:border-primary/50"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <p className="text-body-sm text-heading">
          {staged ? "Replace it: drop another .csv, or browse" : "Drop the .csv here, or browse"}
        </p>
        <p className="mt-xs text-body-sm text-muted">
          {hasLive ? "You see what it adds before anything changes." : "Upload the workbook first."}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.tsv,.txt"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = "";
        }}
      />
      <div className="mt-sm">
        <a href={templateHref} download="contacts-template.csv" className={`${secondaryButton} inline-block no-underline`}>
          Download CSV template
        </a>
      </div>
    </section>
  );
}
