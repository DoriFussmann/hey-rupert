"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applyFundVersion,
  createFundUpload,
  discardFundVersion,
  runWebsiteBatchNow,
  stageFundUpload,
  uploadFundChunk,
} from "@/app/admin/match-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  DAILY_SITE_BATCH,
  FUND_DB_MAX_BYTES,
  FUND_UPLOAD_CHUNK_BYTES,
  siteSummaryText,
  type FundDbVersion,
} from "@/lib/match/shared";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Message = { kind: "ok" | "error"; text: string; details?: string[] };

function n(value: number) {
  return value.toLocaleString("en-US");
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function Change({ label, before, after }: { label: string; before: number | null; after: number }) {
  return (
    <div className="rounded-md border border-border bg-background px-md py-sm">
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      <p className="mt-xs font-mono text-body text-heading">
        {before == null ? n(after) : `${n(before)} → ${n(after)}`}
      </p>
    </div>
  );
}

function StagedPreview({
  version,
  busy,
  onApply,
  onDiscard,
}: {
  version: FundDbVersion;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const diff = version.diff;
  return (
    <section className="mb-lg rounded-card border border-primary/30 bg-surface">
      <div className="border-b border-border px-lg py-md">
        <p className="text-label uppercase tracking-label text-primary">Ready to apply</p>
        <h2 className="mt-xs text-h4 text-heading">{version.fileName}</h2>
        <p className="text-body-sm text-muted">
          Uploaded {formatDateAtTime(version.createdAt)}
          {version.createdBy ? ` by ${version.createdBy}` : ""}. Nothing has changed yet.
        </p>
      </div>
      <div className="grid gap-sm px-lg py-md sm:grid-cols-2 lg:grid-cols-4">
        <Change label="Funds" before={diff?.previous?.firms ?? null} after={version.firms} />
        <Change label="Contacts" before={diff?.previous?.contacts ?? null} after={version.contacts} />
        {diff?.previous ? (
          <>
            <Change label="New funds" before={null} after={diff.added} />
            <Change label="Removed funds" before={null} after={diff.removed} />
          </>
        ) : null}
      </div>
      {diff?.previous ? (
        <div className="space-y-sm px-lg pb-md text-body-sm">
          <p className="text-secondary">
            {n(diff.changed)} existing fund{diff.changed === 1 ? "" : "s"} have updated details.
            Reviews, rejections and hidden funds carry over by FirmID.
            {diff.reviewsOnRemoved > 0
              ? ` ${n(diff.reviewsOnRemoved)} reviewed or hidden fund${diff.reviewsOnRemoved === 1 ? " is" : "s are"} no longer in the file.`
              : ""}
          </p>
          {diff.addedSample.length > 0 ? (
            <p className="text-muted">
              <span className="text-heading">New, e.g.:</span> {diff.addedSample.join(", ")}
            </p>
          ) : null}
          {diff.removedSample.length > 0 ? (
            <p className="text-muted">
              <span className="text-heading">Removed, e.g.:</span> {diff.removedSample.join(", ")}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="px-lg pb-md text-body-sm text-secondary">
          This is the first database. Matching starts working as soon as you apply it.
        </p>
      )}
      {diff && diff.warnings.length > 0 ? (
        <ul className="mx-lg mb-md list-disc rounded-md border border-warning/40 bg-background py-sm pl-xl pr-md text-body-sm text-warning">
          {diff.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-sm border-t border-border px-lg py-md">
        <button type="button" className={primaryButton} disabled={busy} onClick={onApply}>
          Apply: make this the live database
        </button>
        <button type="button" className={secondaryButton} disabled={busy} onClick={onDiscard}>
          Discard
        </button>
      </div>
    </section>
  );
}

export function FundDatabaseManager({
  versions,
  sites,
}: {
  versions: FundDbVersion[];
  sites: { checked: number; recent: number; byStatus: { label: string; count: number }[] };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);

  const live = versions.find((version) => version.status === "live") ?? null;
  const staged = versions.find((version) => version.status === "staged") ?? null;
  const history = versions.filter((version) => version.status !== "staged");
  const liveFirms = live?.firms ?? 0;

  async function upload(file: File) {
    setMessage(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setMessage({ kind: "error", text: "Upload the workbook as an .xlsx file." });
      return;
    }
    if (file.size > FUND_DB_MAX_BYTES) {
      setMessage({ kind: "error", text: "The file must be under 50 MB." });
      return;
    }
    try {
      setBusy("Uploading the workbook…");
      const ticket = await createFundUpload({ name: file.name, size: file.size });
      if (!ticket.ok) {
        setMessage({ kind: "error", text: ticket.error });
        return;
      }
      const parts = Math.ceil(file.size / FUND_UPLOAD_CHUNK_BYTES);
      for (let index = 0; index < parts; index += 1) {
        setBusy(`Uploading the workbook… ${index + 1} of ${parts}`);
        const form = new FormData();
        form.append("path", ticket.path);
        form.append("index", String(index));
        form.append(
          "chunk",
          file.slice(index * FUND_UPLOAD_CHUNK_BYTES, (index + 1) * FUND_UPLOAD_CHUNK_BYTES),
        );
        const sent = await uploadFundChunk(form);
        if (!sent.ok) {
          setMessage({ kind: "error", text: sent.error });
          return;
        }
      }
      setBusy("Reading and checking the workbook. This takes up to a minute…");
      const staged = await stageFundUpload(ticket.path, file.name, parts);
      if (!staged.ok) {
        setMessage({ kind: "error", text: staged.error, details: staged.errors });
        return;
      }
      setMessage({ kind: "ok", text: "Checked. Review the changes below, then apply." });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Upload failed.") });
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

  async function checkWebsites() {
    setBusy("Checking websites. This takes a few minutes…");
    setMessage(null);
    try {
      const result = await runWebsiteBatchNow();
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      const summary = siteSummaryText(result.summary);
      setMessage({
        kind: "ok",
        text: `Checked ${n(result.checked)} websites${summary ? `: ${summary}` : ""}. Dead, parked and not-investing funds now drop out of client tiers automatically.`,
      });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "The website check failed.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
        <p className="text-label uppercase tracking-label text-muted">Live database</p>
        {live ? (
          <>
            <p className="mt-xs text-h4 text-heading">
              {n(live.firms)} funds · {n(live.contacts)} contacts
            </p>
            <p className="text-body-sm text-muted">
              {live.fileName}
              {live.appliedAt ? `, live since ${formatDateAtTime(live.appliedAt)}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-xs text-body-sm text-secondary">
            None yet. Upload the workbook (Funds_Merged_Criteria.xlsx) to start matching.
          </p>
        )}
      </section>

      {message ? (
        <div
          role={message.kind === "error" ? "alert" : "status"}
          className={`mb-lg rounded-card border bg-surface px-lg py-md text-body-sm ${
            message.kind === "error" ? "border-error/40 text-error" : "border-success/40 text-success"
          }`}
        >
          <p>{message.text}</p>
          {message.details && message.details.length > 0 ? (
            <ul className="mt-xs list-disc pl-md">
              {message.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <p role="status" className="mb-lg rounded-card border border-border bg-primary-tint px-lg py-md text-body-sm text-primary">
          {busy}
        </p>
      ) : null}

      {staged ? (
        <StagedPreview
          version={staged}
          busy={Boolean(busy)}
          onApply={() =>
            void act("Applying…", () => applyFundVersion(staged.id), "Applied. Matching now uses the new database.")
          }
          onDiscard={() =>
            void act("Discarding…", () => discardFundVersion(staged.id), "Discarded. Nothing changed.")
          }
        />
      ) : null}

      <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
        <h2 className="text-h4 text-heading">{live ? "Upload a new version" : "Upload the database"}</h2>
        <p className="mt-xs text-body-sm text-muted">
          The workbook needs the sheets Firms and All Contacts (Offices is optional) with the usual
          column names. If the provider changed the format, the upload is refused with the exact
          columns that are missing, and the live database stays as it is.
        </p>
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload the fund database workbook: drop it here or press Enter to browse"
          aria-disabled={Boolean(busy)}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) {
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
            if (file && !busy) void upload(file);
          }}
          className={`mt-md flex cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed px-lg py-lg text-center transition-colors duration-hover ${
            dragging ? "border-primary bg-primary-tint" : "border-border bg-background hover:border-primary/50"
          } ${busy ? "pointer-events-none opacity-50" : ""}`}
        >
          <p className="text-body-sm text-heading">Drop the .xlsx here, or browse</p>
          <p className="mt-xs text-body-sm text-muted">Up to 50 MB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
      </section>

      <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div>
            <h2 className="text-h4 text-heading">Website checks</h2>
            <p className="mt-xs max-w-prose text-body-sm text-muted">
              Every day the {n(DAILY_SITE_BATCH)} fund websites checked longest ago are re-checked, so the whole
              database refreshes about once a month. Dead, parked and not-investing funds drop out
              of a client&apos;s tiers.
            </p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            disabled={Boolean(busy) || !live}
            onClick={() => void checkWebsites()}
          >
            Check the next {n(DAILY_SITE_BATCH)} now
          </button>
        </div>
        <p className="mt-md text-body-sm text-secondary">
          {n(sites.checked)} of {n(liveFirms)} funds checked · {n(sites.recent)} in the last 30 days
        </p>
        {sites.byStatus.length > 0 ? (
          <p className="mt-xs text-body-sm text-muted">
            {sites.byStatus.map((item) => `${item.label} ${n(item.count)}`).join(" · ")}
          </p>
        ) : null}
      </section>

      {history.length > 0 ? (
        <section className="overflow-x-auto rounded-card border border-border bg-surface">
          <h2 className="border-b border-border px-lg py-md text-h4 text-heading">Versions</h2>
          <table className="w-full min-w-[640px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="px-lg py-sm font-medium">File</th>
                <th className="px-md py-sm font-medium">Uploaded</th>
                <th className="px-md py-sm font-medium">Funds</th>
                <th className="px-md py-sm font-medium">Contacts</th>
                <th className="px-md py-sm font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((version) => (
                <tr key={version.id} className="border-b border-border last:border-b-0">
                  <td className="px-lg py-sm text-heading">{version.fileName}</td>
                  <td className="px-md py-sm text-muted">
                    {formatDateAtTime(version.createdAt)}
                    {version.createdBy ? ` · ${version.createdBy}` : ""}
                  </td>
                  <td className="px-md py-sm font-mono">{n(version.firms)}</td>
                  <td className="px-md py-sm font-mono">{n(version.contacts)}</td>
                  <td className="px-md py-sm">
                    {version.status === "live" ? (
                      <span className="text-success">Live</span>
                    ) : (
                      <button
                        type="button"
                        className="text-primary hover:text-primary-hover disabled:opacity-40"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (!window.confirm(`Make ${version.fileName} the live database again?`)) return;
                          void act(
                            "Switching versions…",
                            () => applyFundVersion(version.id),
                            "Done. Matching now uses that version.",
                          );
                        }}
                      >
                        Make live again
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}
