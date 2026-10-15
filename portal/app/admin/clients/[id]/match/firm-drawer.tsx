"use client";

import { useEffect, useRef, useState } from "react";
import { clearFirmReview, getFirmDetail, reviewFirm } from "@/app/admin/match-actions";
import {
  errorText,
  inputClass,
  labelClass,
  n,
  smallButton,
} from "@/app/admin/clients/[id]/match/ui";
import {
  REJECT_REASONS,
  SITE_LABEL,
  TIERS,
  type FirmDetail,
  type FirmRow,
  type MatchView,
} from "@/lib/match/shared";

const HIDE_BY_DEFAULT = "Not active / no recent deals";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-lg py-md">
      <h3 className={`${labelClass} mb-sm`}>{title}</h3>
      {children}
    </section>
  );
}

function ReviewBox({
  clientId,
  row,
  onView,
  onHidden,
}: {
  clientId: string;
  row: FirmRow;
  onView: (view: MatchView) => void;
  onHidden: () => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(row.review?.note ?? "");
  const [hide, setHide] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: "ok" | "no") {
    if (status === "no" && !reason) {
      setError("Choose a reason for rejecting.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await reviewFirm(clientId, {
        firmId: row.id,
        firmName: row.name,
        tier: row.tier,
        status,
        reason,
        note,
        hideForAll: status === "no" && hide,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onView(result.view);
      if (status === "no" && hide) onHidden();
    } catch (err) {
      setError(errorText(err, "The review was not saved."));
    } finally {
      setPending(false);
    }
  }

  async function clear() {
    setPending(true);
    setError(null);
    try {
      const result = await clearFirmReview(clientId, row.id);
      if (!result.ok) setError(result.error);
      else onView(result.view);
    } catch (err) {
      setError(errorText(err, "The review was not cleared."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-lg my-md rounded-card border border-border bg-background px-md py-md">
      <p className={labelClass}>Review for this client</p>
      {row.review ? (
        <p className={`mt-xs text-body-sm ${row.review.status === "ok" ? "text-success" : "text-error"}`}>
          {row.review.status === "ok" ? "✓ Approved" : `✕ Rejected: ${row.review.reason}`}
          {row.review.note ? <span className="text-muted"> · {row.review.note}</span> : null}
          <button type="button" className="ml-sm text-primary hover:text-primary-hover" disabled={pending} onClick={() => void clear()}>
            Clear
          </button>
        </p>
      ) : null}
      <div className="mt-sm flex flex-wrap gap-sm">
        <button type="button" className={smallButton} disabled={pending} onClick={() => void submit("ok")}>
          ✓ Approve
        </button>
      </div>
      <div className="mt-sm grid gap-sm sm:grid-cols-[1fr_auto]">
        <select
          aria-label="Reason for rejecting"
          className={inputClass}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            setHide(event.target.value === HIDE_BY_DEFAULT);
          }}
        >
          <option value="">Reject because…</option>
          {REJECT_REASONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button type="button" className={smallButton} disabled={pending} onClick={() => void submit("no")}>
          ✕ Reject
        </button>
      </div>
      <input
        aria-label="Note"
        placeholder="Note (optional): what you checked"
        className={`${inputClass} mt-sm`}
        value={note}
        maxLength={1000}
        onChange={(event) => setNote(event.target.value)}
      />
      <label className="mt-sm flex items-center gap-xs text-body-sm">
        <input type="checkbox" checked={hide} onChange={(event) => setHide(event.target.checked)} />
        Hide this fund for all clients (when rejecting)
      </label>
      {error ? (
        <p role="alert" className="mt-sm text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FirmDrawer({
  clientId,
  firmId,
  row,
  onClose,
  onView,
}: {
  clientId: string;
  firmId: string;
  row: FirmRow | null;
  onClose: () => void;
  onView: (view: MatchView) => void;
}) {
  const [detail, setDetail] = useState<FirmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    getFirmDetail(clientId, firmId)
      .then((result) => {
        if (!active) return;
        if (result.ok) setDetail(result.detail);
        else setError(result.error);
      })
      .catch((err) => {
        if (active) setError(errorText(err, "The fund could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [clientId, firmId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = row ?? detail?.row ?? null;
  const tierLabel = current ? TIERS.find((tier) => tier.key === current.tier)?.label : "";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-heading/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={current?.name ?? "Fund"}
        className="h-full w-full max-w-[560px] overflow-y-auto bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md px-lg py-md">
          <div className="min-w-0">
            {current ? (
              <>
                <p className="text-label uppercase tracking-label text-primary">
                  {tierLabel}
                  {current.overflow ? " · wave 2" : ""} · fit {current.score}
                </p>
                <h2 className="mt-xs text-h3 text-heading">{current.name}</h2>
                <p className="text-body-sm text-muted">
                  {current.type} · {current.hq || current.loc}
                  {current.year ? ` · founded ${current.year}` : ""} · {n(current.people)} investing contact{current.people === 1 ? "" : "s"}
                </p>
              </>
            ) : (
              <h2 className="text-h3 text-heading">Fund</h2>
            )}
          </div>
          <button ref={closeRef} type="button" className={smallButton} onClick={onClose}>
            Close
          </button>
        </div>
        {detail ? <p className="px-lg pb-sm text-body-sm text-body">{detail.why}</p> : null}

        {row ? <ReviewBox key={`${row.id}-${row.review?.status ?? "open"}`} clientId={clientId} row={row} onView={onView} onHidden={onClose} /> : null}

        {error ? (
          <p role="alert" className="px-lg py-md text-body-sm text-error">
            {error}
          </p>
        ) : null}
        {!detail && !error ? <p className="px-lg py-md text-body-sm text-muted">Loading…</p> : null}

        {detail ? (
          <>
            {detail.siteState ? (
              <Section title="Website check">
                <p className="text-body-sm text-heading">{SITE_LABEL[detail.siteState]}</p>
                {detail.site ? (
                  <div className="mt-xs space-y-px text-body-sm text-secondary">
                    {detail.site.why ? <p>{detail.site.why}</p> : null}
                    {detail.site.title ? <p className="text-heading">{detail.site.title}</p> : null}
                    {detail.site.desc ? <p>{detail.site.desc}</p> : null}
                    {detail.site.stages?.length ? <p>Mentions: {[...detail.site.stages, ...(detail.site.sectors ?? [])].join(", ")}</p> : null}
                    {detail.site.check ? <p>Stated check: {detail.site.check}</p> : null}
                    <p className="text-muted">Checked {detail.site.at}</p>
                  </div>
                ) : null}
                {detail.firm.website ? (
                  <a
                    href={/^https?:\/\//i.test(detail.firm.website) ? detail.firm.website : `https://${detail.firm.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-xs inline-block text-body-sm text-primary"
                  >
                    Open {detail.firm.website}
                  </a>
                ) : null}
              </Section>
            ) : null}

            <Section title="Why it fits">
              <ul className="space-y-px text-body-sm">
                {detail.pros.map((pro) => (
                  <li key={pro} className="text-body">
                    <span className="text-success">+</span> {pro}
                  </li>
                ))}
              </ul>
            </Section>

            {detail.cons.length > 0 || detail.flags.length > 0 ? (
              <Section title="Watch-outs & red flags">
                <ul className="space-y-px text-body-sm">
                  {detail.cons.map((con) => (
                    <li key={con} className="text-warning">
                      − {con}
                    </li>
                  ))}
                  {detail.flags.map((flag) => (
                    <li key={flag.text} className={flag.sev === "high" ? "text-error" : flag.sev === "med" ? "text-warning" : "text-muted"}>
                      ⚑ {flag.text}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section title="Verify before sending (not in the database)">
              <ul className="space-y-px text-body-sm text-body">
                {detail.verify.map((item) => (
                  <li key={item}>? {item}</li>
                ))}
              </ul>
            </Section>

            <Section title={`Fit ${detail.row.score} breakdown`}>
              <ul className="space-y-xs text-body-sm">
                {detail.fitParts.map((part) => (
                  <li key={part.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-sm">
                    <span className="text-body">{part.label}</span>
                    <span className="block h-1.5 rounded-full bg-border">
                      <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((part.value / part.max) * 100)}%` }} />
                    </span>
                    <span className="text-right font-mono text-muted">
                      {part.value}/{part.max}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={`Data confidence · ${detail.row.conf}`}>
              <ul className="space-y-px text-body-sm">
                {detail.checks.map((check) => (
                  <li key={check.text} className={check.ok ? "text-body" : "text-warning"}>
                    {check.ok ? "✓" : "✕"} {check.text}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={`Everyone at the fund (${detail.contacts.length})`}>
              {detail.contacts.length === 0 ? (
                <p className="text-body-sm text-muted">No contacts in the database.</p>
              ) : (
                <ul className="space-y-sm text-body-sm">
                  {detail.contacts.map((contact, index) => (
                    <li key={`${contact.email}-${index}`}>
                      <p className="text-heading">
                        {contact.name}
                        {contact.seq ? <span className="ml-xs rounded bg-primary-tint px-xs text-label text-primary">{contact.seq}</span> : null}
                      </p>
                      <p className="text-secondary">
                        {contact.title || "No title"} · {contact.role}
                      </p>
                      <p className="text-muted">
                        {[contact.location, contact.email || "no email", contact.phone].filter(Boolean).join(" · ")}
                      </p>
                      {contact.why.length > 0 ? <p className="text-muted">{contact.why.join(", ")}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Fund data">
              <dl className="grid grid-cols-[8rem_1fr] gap-x-sm gap-y-xs text-body-sm">
                {(
                  [
                    ["Stages", detail.firm.stages.join(", ")],
                    ["Verticals", detail.firm.verticals.join(", ")],
                    ["Industries", detail.firm.industries.join(", ")],
                    ["Geography", detail.firm.geography.join(", ")],
                    ["Offices", detail.firm.offices.join("; ")],
                    ["Email", detail.firm.email],
                    ["Phone", detail.firm.phone],
                  ] as [string, string][]
                )
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted">{label}</dt>
                      <dd className="text-body">{value}</dd>
                    </div>
                  ))}
              </dl>
            </Section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
