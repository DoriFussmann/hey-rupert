"use client";

import { EmailBodyField } from "@/components/email-body-field";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveCoreAction,
  editCoreAction,
  loadCoreAction,
  setCoreSlotAction,
  syncCoreAction,
  writeCoreAction,
} from "@/app/admin/outreach-core-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { SEQUENCE_LABELS } from "@/lib/outreach/copy";
import { STATUS_LABEL, coreMessageIssues, coreSummary, isApproved } from "@/lib/outreach/core";
import type { CoreMessageView, CoreWorkspace } from "@/lib/outreach/core-server";
import type { CopyEmail } from "@/lib/setup";

/** Funds written in parallel; one fund's contacts go one after another, so its research is reused. */
const PARALLEL_FUNDS = 3;

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Message = { kind: "ok" | "error"; text: string } | null;

function statusClass(message: CoreMessageView) {
  if (isApproved(message)) return "text-success";
  if (message.status === "error") return "text-error";
  if (message.status === "drafted") return "text-primary";
  return "text-muted";
}

function statusText(message: CoreMessageView) {
  if (message.status === "approved" && !isApproved(message)) return "Edited since approval";
  return STATUS_LABEL[message.status];
}

function ContactCard({
  clientId,
  message,
  cap,
  busy,
  onChange,
  onWrite,
  onApprove,
}: {
  clientId: string;
  message: CoreMessageView;
  cap: number;
  busy: boolean;
  onChange: (next: CoreMessageView) => void;
  onWrite: (id: string, research: "auto" | "refresh" | "skip") => void;
  onApprove: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<CopyEmail[]>(message.emails);
  const [note, setNote] = useState(message.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEmails(message.emails);
    setNote(message.note);
  }, [message.emails, message.note]);

  const dirty = JSON.stringify(emails) !== JSON.stringify(message.emails) || note !== message.note;
  const issues = coreMessageIssues(emails, cap);
  const blocking = issues.some((issue) => issue.level === "error");
  const written = message.status === "drafted" || message.status === "approved";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await editCoreAction(clientId, message.id, { emails, note });
      if (!result.ok) setError(result.error);
      else onChange(result.message);
    } finally {
      setSaving(false);
    }
  }

  async function toReserve() {
    if (!window.confirm(`Move ${message.person.name || "this contact"} to the reserves? They won't be emailed.`)) return;
    const result = await setCoreSlotAction(clientId, message.id, "reserve");
    if (!result.ok) setError(result.error);
    else onChange(result.message);
  }

  return (
    <li className="border-t border-border px-lg py-md">
      <div className="flex flex-wrap items-start gap-sm">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-heading">
            {message.person.name || "(no name)"}
            {message.person.title ? <span className="text-muted"> · {message.person.title}</span> : null}
            {message.person.seq ? <span className="text-muted"> · {message.person.seq}</span> : null}
          </p>
          <p className="font-mono text-mono text-muted">{message.person.email}</p>
        </div>
        <span className={`text-body-sm ${statusClass(message)}`}>{statusText(message)}</span>
      </div>

      {message.error && message.status === "error" ? <p className="mt-xs text-body-sm text-error">{message.error}</p> : null}

      {message.quick_facts.length > 0 ? (
        <div className="mt-sm">
          <p className="text-label uppercase tracking-label text-muted">Quick Facts on Prospect</p>
          <ul className="mt-xs space-y-xs text-body-sm">
            {message.quick_facts.map((fact, index) => (
              <li key={index}>
                <span className="text-muted">{fact.about === "person" ? "Person" : "Fund"}: </span>
                {fact.fact}{" "}
                <a href={fact.url} target="_blank" rel="noreferrer" className="text-primary underline hover:text-primary-hover">
                  source
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : written ? (
        <p className="mt-sm text-body-sm text-muted">No Quick Facts found: the hook uses the fund&apos;s stated focus.</p>
      ) : null}

      <div className="mt-sm flex flex-wrap gap-xs">
        <button type="button" className={smallButton} disabled={busy} onClick={() => onWrite(message.id, "auto")}>
          {written ? "Rewrite" : "Write"}
        </button>
        {written ? (
          <button type="button" className={smallButton} disabled={busy} onClick={() => onWrite(message.id, "refresh")}>
            New research + rewrite
          </button>
        ) : null}
        {written ? (
          <button type="button" className={smallButton} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide emails" : "Review emails"}
          </button>
        ) : null}
        {written && !isApproved(message) ? (
          <button
            type="button"
            className={smallButton}
            disabled={busy || dirty || blocking}
            title={dirty ? "Save your edits first." : blocking ? "Fix the problems first." : undefined}
            onClick={() => onApprove([message.id])}
          >
            Approve
          </button>
        ) : null}
        <button type="button" className={`${smallButton} ml-auto`} disabled={busy} onClick={toReserve}>
          Move to reserve
        </button>
      </div>

      {open ? (
        <div className="mt-md">
          <ol className="space-y-md">
            {emails.map((email, index) => (
              <li key={index}>
                <p className="text-label uppercase tracking-label text-muted">{SEQUENCE_LABELS[index]}</p>
                <input
                  className={`${inputClass} mt-xs`}
                  value={email.subject}
                  maxLength={300}
                  placeholder={index === 0 ? "Subject" : "Subject (blank = same thread)"}
                  onChange={(event) => setEmails((current) => current.map((e, i) => (i === index ? { ...e, subject: event.target.value } : e)))}
                  aria-label={`${SEQUENCE_LABELS[index]} subject`}
                />
                <EmailBodyField
                  className={inputClass}
                  value={email.body}
                  onChange={(value) => setEmails((current) => current.map((e, i) => (i === index ? { ...e, body: value } : e)))}
                  label={`${SEQUENCE_LABELS[index]} body`}
                />
              </li>
            ))}
          </ol>
          {issues.length ? (
            <ul className="mt-sm text-body-sm">
              {issues.map((issue, index) => (
                <li key={index} className={issue.level === "error" ? "text-error" : "text-muted"}>
                  {issue.where} {issue.text}
                </li>
              ))}
            </ul>
          ) : null}
          <label className="mt-md block text-body-sm text-secondary">
            Note for the next rewrite (not sent)
            <input
              className={`${inputClass} mt-xs`}
              value={note}
              maxLength={2000}
              placeholder="e.g. lead with their 2025 fund close"
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <button type="button" className={secondaryButton} disabled={!dirty || saving} onClick={save}>
              {saving ? "Saving…" : "Save edits"}
            </button>
            {dirty ? <span className="text-body-sm text-muted">Saving edited text clears the approval.</span> : null}
          </div>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-xs text-body-sm text-error">{error}</p> : null}
    </li>
  );
}

export function CoreContactsPanel({ clientId, claudeReady }: { clientId: string; claudeReady: boolean }) {
  const [workspace, setWorkspace] = useState<CoreWorkspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [writing, setWriting] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<Message>(null);
  const [typeFilter, setTypeFilter] = useState("");

  const refresh = useCallback(async () => {
    const result = await loadCoreAction(clientId);
    if (!result.ok) setLoadError(result.error);
    else {
      setLoadError(null);
      setWorkspace(result.workspace);
    }
  }, [clientId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const messages = useMemo(() => workspace?.messages ?? [], [workspace]);
  const summary = coreSummary(messages);
  const types = Array.from(new Set(messages.map((m) => m.fund_type)));
  const funds = useMemo(() => {
    const map = new Map<string, CoreMessageView[]>();
    for (const m of messages) {
      if (typeFilter && m.fund_type !== typeFilter) continue;
      map.set(m.firm_id, [...(map.get(m.firm_id) ?? []), m]);
    }
    return Array.from(map.values());
  }, [messages, typeFilter]);

  function replace(next: CoreMessageView) {
    setWorkspace((current) =>
      current ? { ...current, messages: current.messages.map((m) => (m.id === next.id ? next : m)) } : current,
    );
  }

  async function writeOne(id: string, research: "auto" | "refresh" | "skip") {
    setWriting((current) => new Set(current).add(id));
    try {
      const result = await writeCoreAction(clientId, id, research);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        await refresh();
        return false;
      }
      replace(result.message);
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Writing failed." });
      return false;
    } finally {
      setWriting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  /** Writes contacts fund by fund, a few funds at a time. */
  async function writeMany(targets: CoreMessageView[], research: "auto" | "skip", label: string) {
    if (targets.length === 0) {
      setMessage({ kind: "ok", text: "Nothing to write." });
      return;
    }
    setRunning(label);
    setMessage(null);
    const byFund = new Map<string, CoreMessageView[]>();
    for (const m of targets) byFund.set(m.firm_id, [...(byFund.get(m.firm_id) ?? []), m]);
    const queue = Array.from(byFund.values());
    let done = 0;
    let failed = 0;
    const worker = async () => {
      for (let fund = queue.shift(); fund; fund = queue.shift()) {
        for (const m of fund) {
          const ok = await writeOne(m.id, research);
          done += 1;
          if (!ok) failed += 1;
          setRunning(`${label}: ${done} of ${targets.length}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_FUNDS, queue.length) }, worker));
    setRunning(null);
    setMessage({
      kind: failed ? "error" : "ok",
      text: `${done - failed} of ${targets.length} written.${failed ? ` ${failed} failed; see the contacts marked Failed.` : ""}`,
    });
  }

  async function onSync() {
    setRunning("Lining up contacts");
    setMessage(null);
    try {
      const result = await syncCoreAction(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setWorkspace(result.workspace);
      const parts = [`${result.added} contact${result.added === 1 ? "" : "s"} added.`];
      if (result.removed) parts.push(`${result.removed} removed (their funds left Core).`);
      if (result.leftOut) parts.push(`${result.leftOut} left out: verification flagged them or you removed them.`);
      setMessage({ kind: "ok", text: parts.join(" ") });
    } finally {
      setRunning(null);
    }
  }

  async function approve(ids: string[]) {
    setRunning("Approving");
    try {
      const result = await approveCoreAction(clientId, ids);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setWorkspace(result.workspace);
      const skipped = result.skipped.length ? ` ${result.skipped.length} skipped (not written or has problems).` : "";
      setMessage({ kind: "ok", text: `${result.approved} approved.${skipped}` });
    } finally {
      setRunning(null);
    }
  }

  async function activate(id: string) {
    const result = await setCoreSlotAction(clientId, id, "active");
    if (!result.ok) setMessage({ kind: "error", text: result.error });
    else replace(result.message);
  }

  const active = messages.filter((m) => m.slot === "active");
  const unwritten = active.filter((m) => m.status === "pending" || m.status === "error");
  const ready = active.filter(
    (m) => m.status === "drafted" && !coreMessageIssues(m.emails, workspace?.caps[m.fund_type] ?? 100).some((i) => i.level === "error"),
  );
  const busy = Boolean(running);
  const canWrite = claudeReady && !workspace?.blocker;

  return (
    <section id="setup-core-contacts" className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h3 className="text-h4">Core contacts</h3>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          {workspace ? `${workspace.perFirm} contact${workspace.perFirm === 1 ? "" : "s"}` : "The contacts"} per Core fund (from
          the campaign plan) get their own emails, written from the Core template of the fund&apos;s type and a few
          sourced Quick Facts. You approve each one. Other contacts wait as reserves until you activate them.
        </p>
        {workspace ? (
          <p className="mt-sm text-body-sm text-secondary">
            {summary.funds} funds · {summary.active} active · {summary.written} written · {summary.approved} approved
            {summary.failed ? ` · ${summary.failed} failed` : ""} · {summary.reserve} reserves
          </p>
        ) : null}
      </div>

      {loadError ? <p role="alert" className="px-lg py-md text-body-sm text-error">{loadError}</p> : null}
      {workspace?.blocker ? <p className="px-lg pt-md text-body-sm text-warning">{workspace.blocker}</p> : null}

      <div className="flex flex-wrap items-center gap-sm px-lg py-md">
        <button type="button" className={secondaryButton} disabled={busy || !workspace || Boolean(workspace.blocker && workspace.coreFunds === 0)} onClick={onSync}>
          {messages.length ? "Update contacts from the list" : "Line up contacts"}
        </button>
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !canWrite || unwritten.length === 0}
          onClick={() => writeMany(unwritten, "auto", "Researching and writing")}
        >
          Write {unwritten.length ? `${unwritten.length} ` : ""}not written
        </button>
        <button type="button" className={secondaryButton} disabled={busy || ready.length === 0} onClick={() => approve(ready.map((m) => m.id))}>
          Approve {ready.length ? `${ready.length} ` : ""}ready
        </button>
        {types.length > 1 ? (
          <select
            className="rounded-md border border-border bg-background px-sm py-xs text-body-sm"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Fund type"
          >
            <option value="">All fund types</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        ) : null}
        {typeFilter || types.length === 1 ? (
          <button
            type="button"
            className={secondaryButton}
            disabled={busy || !canWrite}
            title="After you change the Core template for this type: rewrites every active contact of the type, keeping their Quick Facts. Approvals are cleared."
            onClick={() => {
              const type = typeFilter || types[0];
              const targets = active.filter((m) => m.fund_type === type && m.status !== "pending");
              if (!window.confirm(`Rewrite all ${targets.length} ${type} Core emails from the current template? Their approvals are cleared.`)) return;
              void writeMany(targets, "skip", `Rewriting ${type}`);
            }}
          >
            Rewrite all {typeFilter || types[0]}
          </button>
        ) : null}
        <p className="w-full text-body-sm text-muted" aria-live="polite">
          {running ?? (!claudeReady ? "Claude is not configured (ANTHROPIC_API_KEY)." : "Research is a few web searches per contact; fund facts are reused for 60 days.")}
        </p>
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={`w-full text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
            {message.text}
          </p>
        ) : null}
      </div>

      <ul>
        {funds.map((contacts) => {
          const first = contacts[0];
          const activeHere = contacts.filter((m) => m.slot === "active");
          const reserves = contacts.filter((m) => m.slot === "reserve");
          const conflict = contacts.find((m) => m.conflict)?.conflict;
          return (
            <li key={first.firm_id} className="border-t border-border">
              <div className="flex flex-wrap items-baseline gap-sm bg-background px-lg py-sm">
                <span className="text-body-sm text-heading">{first.fund_name}</span>
                <span className="text-body-sm text-muted">
                  {first.fund_type} · {activeHere.length} active{reserves.length ? ` · ${reserves.length} more available` : ""}
                </span>
                {conflict ? <span className="text-body-sm text-warning">Possible conflict: backed {conflict}</span> : null}
              </div>
              <ul>
                {activeHere.map((m) => (
                  <ContactCard
                    key={m.id}
                    clientId={clientId}
                    message={m}
                    cap={workspace?.caps[m.fund_type] ?? 100}
                    busy={busy || writing.has(m.id) || !canWrite}
                    onChange={replace}
                    onWrite={(id, research) => void writeOne(id, research)}
                    onApprove={(ids) => void approve(ids)}
                  />
                ))}
              </ul>
              {reserves.length ? (
                <div className="border-t border-border px-lg py-sm text-body-sm text-muted">
                  Reserves:{" "}
                  {reserves.map((m, index) => (
                    <span key={m.id}>
                      {index ? " · " : ""}
                      {m.person.name || m.person.email}
                      {m.person.title ? ` (${m.person.title})` : ""}{" "}
                      <button type="button" className="text-primary hover:text-primary-hover" disabled={busy} onClick={() => activate(m.id)}>
                        Activate
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {workspace && messages.length === 0 && !workspace.blocker ? (
        <p className="border-t border-border px-lg py-md text-body-sm text-muted">
          Click Line up contacts to take the {workspace.perFirm} best contact{workspace.perFirm === 1 ? "" : "s"} of each of the {workspace.coreFunds} Core funds from the saved match.
        </p>
      ) : null}
    </section>
  );
}
