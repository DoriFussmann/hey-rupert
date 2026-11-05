"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { deleteManualFund, fillManualFund, huntManualEmails, loadManualFunds, saveManualFund } from "@/app/admin/manual-fund-actions";
import type { AddedContact, AddedFund } from "@/lib/match/added/core";
import type { ManualFundInput, ManualOptions } from "@/lib/match/added/manual";

// Add a fund, at the end of every Matching step: saved straight into the Fund
// Database (every client) and onto this client's Final Roster. Contacts by
// hand, then Hunter for their emails. One shared list for all the steps.

type Shared = {
  clientId: string;
  funds: AddedFund[];
  options: ManualOptions | null;
  hunter: boolean;
  claude: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** After a change: the Roster and the Plan reload. */
  changed: () => void;
};

const Ctx = createContext<Shared | null>(null);

export function AddFundProvider({ clientId, onChanged, children }: { clientId: string; onChanged: () => void; children: ReactNode }) {
  const [funds, setFunds] = useState<AddedFund[]>([]);
  const [options, setOptions] = useState<ManualOptions | null>(null);
  const [flags, setFlags] = useState({ hunter: false, claude: false });
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const r = await loadManualFunds(clientId);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setFunds(r.funds);
    setOptions(r.options);
    setFlags({ hunter: r.hunter, claude: r.claude });
  }, [clientId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ clientId, funds, options, ...flags, error, reload, changed: onChanged }}>{children}</Ctx.Provider>;
}

const empty = (): ManualFundInput => ({
  name: "",
  kind: "fund",
  website: "",
  description: "",
  hqCity: "",
  hqCountry: "",
  foundedYear: null,
  firmType: "",
  stages: [],
  geographies: [],
  industries: [],
  verticals: [],
  financing: [],
  notes: "",
  contacts: [],
});

const fromFund = (f: AddedFund): ManualFundInput => ({
  name: f.name,
  kind: f.kind,
  website: f.website,
  description: f.description,
  hqCity: f.hqCity,
  hqCountry: f.hqCountry,
  foundedYear: f.foundedYear,
  firmType: f.firmType,
  stages: f.stages,
  geographies: f.geographies,
  industries: f.industries,
  verticals: f.verticals,
  financing: f.financing,
  notes: f.notes,
  contacts: f.contacts,
});

const blankContact = (): AddedContact => ({ first: "", last: "", title: "", email: "", confidence: null, linkedin: "", source: "manual" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Chips for the chosen labels, and a box with suggestions to add one. Only the taxonomy's labels. */
function LabelPicker({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const add = (v: string) => {
    const hit = options.find((o) => o.toLowerCase() === v.trim().toLowerCase());
    if (hit && !value.includes(hit)) onChange([...value, hit]);
    if (hit) setTyped("");
  };
  return (
    <div>
      <p className={labelClass}>{label}</p>
      <div className="mt-xs flex flex-wrap items-center gap-xs">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-xs rounded-full border border-border bg-background px-sm py-[2px] text-body-sm text-heading">
            {v}
            <button type="button" className="text-muted hover:text-error" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
              ×
            </button>
          </span>
        ))}
        <input
          className={`${inputClass} w-48 normal-case tracking-normal`}
          list={id}
          value={typed}
          placeholder="Type to add"
          aria-label={`Add ${label}`}
          onChange={(e) => {
            setTyped(e.target.value);
            // Picking a suggestion fills the box with an exact label: add it at once.
            if (options.some((o) => o === e.target.value)) add(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(typed);
            }
          }}
        />
        <datalist id={id}>
          {options
            .filter((o) => !value.includes(o))
            .map((o) => (
              <option key={o} value={o} />
            ))}
        </datalist>
      </div>
    </div>
  );
}

function FundForm({ editing, onDone }: { editing: AddedFund | null; onDone: (message: string) => void }) {
  const ctx = useContext(Ctx)!;
  const options = ctx.options!;
  const [form, setForm] = useState<ManualFundInput>(editing ? fromFund(editing) : empty());
  const [busy, setBusy] = useState<null | "save" | "fill">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const set = <K extends keyof ManualFundInput>(key: K, value: ManualFundInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setContact = (i: number, patch: Partial<AddedContact>) =>
    setForm((f) => ({ ...f, contacts: f.contacts.map((c, j) => (j === i ? { ...c, ...patch, source: patch.email !== undefined ? "manual" : c.source } : c)) }));
  const field = `${inputClass} mt-xs normal-case tracking-normal`;

  async function fill() {
    setBusy("fill");
    setError(null);
    setNote(null);
    try {
      const r = await fillManualFund(ctx.clientId, { name: form.name, kind: form.kind, website: form.website });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Fills what's empty; what you typed stays.
      setForm((f) => {
        const x = r.fill;
        const pick = <T,>(mine: T, theirs: T | undefined, isEmpty: boolean) => (isEmpty && theirs !== undefined ? theirs : mine);
        return {
          ...f,
          website: pick(f.website, x.website, !f.website),
          description: pick(f.description, x.description, !f.description),
          hqCity: pick(f.hqCity, x.hqCity, !f.hqCity),
          hqCountry: pick(f.hqCountry, x.hqCountry, !f.hqCountry),
          foundedYear: pick(f.foundedYear, x.foundedYear, !f.foundedYear),
          firmType: pick(f.firmType, x.firmType, !f.firmType),
          stages: pick(f.stages, x.stages, !f.stages.length),
          geographies: pick(f.geographies, x.geographies, !f.geographies.length),
          industries: pick(f.industries, x.industries, !f.industries.length),
          verticals: pick(f.verticals, x.verticals, !f.verticals.length),
          financing: pick(f.financing, x.financing, !f.financing.length),
          notes: pick(f.notes, x.notes, !f.notes),
          contacts: pick(f.contacts, x.contacts, !f.contacts.length),
        };
      });
      setNote("Filled in what was empty. Check everything before you save.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const r = await saveManualFund(ctx.clientId, editing?.id ?? null, form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await ctx.reload();
      ctx.changed();
      onDone(editing ? `${r.fund.name} saved.` : `${r.fund.name} added: in the Fund Database for every client, and on this client's Roster.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-md space-y-md rounded-card border border-border bg-background p-md">
      <div className="grid gap-md sm:grid-cols-[2fr_1fr_2fr]">
        <label className={labelClass}>
          Name *
          <input className={field} value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={labelClass}>
          Kind
          <select className={field} value={form.kind} onChange={(e) => set("kind", e.target.value === "angel" ? "angel" : "fund")}>
            <option value="fund">Fund</option>
            <option value="angel">Angel</option>
          </select>
        </label>
        <label className={labelClass}>
          Website
          <input className={field} value={form.website} placeholder="acme.vc" onChange={(e) => set("website", e.target.value)} />
        </label>
      </div>
      {ctx.claude ? (
        <div className="flex flex-wrap items-center gap-sm">
          <button type="button" className={secondaryButton} disabled={busy !== null || !form.name.trim()} onClick={() => void fill()}>
            {busy === "fill" ? "Researching… (about a minute)" : "Fill with AI"}
          </button>
          <span className="text-body-sm text-muted">Researches the fund on the web and fills the empty fields. Never emails: those come from Hunter.</span>
        </div>
      ) : null}
      <label className={`${labelClass} block`}>
        Description
        <textarea className={`${field} min-h-[60px]`} value={form.description} maxLength={400} onChange={(e) => set("description", e.target.value)} />
      </label>
      <div className="grid gap-md sm:grid-cols-4">
        <label className={labelClass}>
          Type
          <select className={field} value={form.firmType} onChange={(e) => set("firmType", e.target.value)}>
            <option value="">—</option>
            {options.firmTypes.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          HQ city
          <input className={field} value={form.hqCity} maxLength={80} onChange={(e) => set("hqCity", e.target.value)} />
        </label>
        <label className={labelClass}>
          HQ country
          <select className={field} value={form.hqCountry} onChange={(e) => set("hqCountry", e.target.value)}>
            <option value="">—</option>
            {options.countries.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Founded
          <input
            className={field}
            inputMode="numeric"
            value={form.foundedYear ?? ""}
            onChange={(e) => set("foundedYear", e.target.value ? Number(e.target.value.replace(/\D/g, "").slice(0, 4)) || null : null)}
          />
        </label>
      </div>
      <div className="grid gap-md sm:grid-cols-2">
        <LabelPicker label="Stages" options={options.stages} value={form.stages} onChange={(v) => set("stages", v)} />
        <LabelPicker label="Geographies" options={options.geographies} value={form.geographies} onChange={(v) => set("geographies", v)} />
        <LabelPicker label="Industries" options={options.industries} value={form.industries} onChange={(v) => set("industries", v)} />
        <LabelPicker label="Verticals" options={options.verticals} value={form.verticals} onChange={(v) => set("verticals", v)} />
        <LabelPicker label="Financing" options={options.financing} value={form.financing} onChange={(v) => set("financing", v)} />
      </div>

      <div>
        <p className={labelClass}>Contacts</p>
        <p className="mt-xs text-body-sm text-muted">
          Add people by name. Leave the email empty and use Find Emails (Hunter) once the fund is saved; with no contacts, Hunter looks for the investing team at the website.
        </p>
        <div className="mt-sm space-y-xs">
          {form.contacts.map((c, i) => (
            <div key={i} className="grid items-center gap-xs sm:grid-cols-[1fr_1fr_1.2fr_1.6fr_1.4fr_auto]">
              <input className={`${inputClass} normal-case tracking-normal`} placeholder="First" value={c.first} onChange={(e) => setContact(i, { first: e.target.value })} />
              <input className={`${inputClass} normal-case tracking-normal`} placeholder="Last" value={c.last} onChange={(e) => setContact(i, { last: e.target.value })} />
              <input className={`${inputClass} normal-case tracking-normal`} placeholder="Title" value={c.title} onChange={(e) => setContact(i, { title: e.target.value })} />
              <input className={`${inputClass} normal-case tracking-normal`} placeholder="Email (or Hunter)" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} />
              <input className={`${inputClass} normal-case tracking-normal`} placeholder="LinkedIn" value={c.linkedin} onChange={(e) => setContact(i, { linkedin: e.target.value })} />
              <button type="button" className="text-body-sm text-muted hover:text-error" onClick={() => set("contacts", form.contacts.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
        </div>
        {form.contacts.length < 10 ? (
          <button type="button" className={`${smallButton} mt-sm`} onClick={() => set("contacts", [...form.contacts, blankContact()])}>
            + Add contact
          </button>
        ) : null}
      </div>

      <label className={`${labelClass} block`}>
        Notes
        <textarea className={`${field} min-h-[50px]`} value={form.notes} maxLength={1500} onChange={(e) => set("notes", e.target.value)} />
      </label>

      {error ? <p className="text-body-sm text-error">{error}</p> : null}
      {note ? <p className="text-body-sm text-success">{note}</p> : null}
      <div className="flex flex-wrap gap-sm">
        <button type="button" className={primaryButton} disabled={busy !== null || !form.name.trim()} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : editing ? "Save" : "Add Fund"}
        </button>
        <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => onDone("")}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function FundRow({ fund, onEdit }: { fund: AddedFund; onEdit: () => void }) {
  const ctx = useContext(Ctx)!;
  const [busy, setBusy] = useState<null | "hunt" | "remove">(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const withEmail = fund.contacts.filter((c) => c.email).length;
  const waiting = fund.contacts.length - withEmail;

  async function hunt() {
    setBusy("hunt");
    setMessage(null);
    try {
      const r = await huntManualEmails(ctx.clientId, fund.id);
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        await ctx.reload();
        ctx.changed();
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${fund.name}? It comes off this client's Roster and out of the Fund Database for every client.`)) return;
    setBusy("remove");
    try {
      const r = await deleteManualFund(ctx.clientId, fund.id);
      if (!r.ok) setMessage({ ok: false, text: r.error });
      else {
        await ctx.reload();
        ctx.changed();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="border-t border-border py-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div>
          <span className="text-body text-heading">{fund.name}</span>
          <span className="ml-sm text-body-sm text-muted">
            {[fund.firmType || (fund.kind === "angel" ? "Angel" : ""), fund.website, plural(fund.contacts.length, "contact")].filter(Boolean).join(" · ")}
            {fund.contacts.length ? ` (${withEmail} with email)` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-xs">
          {ctx.hunter ? (
            <button
              type="button"
              className={smallButton}
              disabled={busy !== null || !fund.website || (fund.contacts.length > 0 && waiting === 0)}
              title={!fund.website ? "Add the website first" : fund.contacts.length && !waiting ? "Every contact has an email" : undefined}
              onClick={() => void hunt()}
            >
              {busy === "hunt" ? "Hunter…" : fund.contacts.length ? `Find Emails (${waiting})` : "Find Contacts (Hunter)"}
            </button>
          ) : null}
          <button type="button" className={smallButton} disabled={busy !== null} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className={smallButton} disabled={busy !== null} onClick={() => void remove()}>
            {busy === "remove" ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
      {fund.contacts.length ? (
        <ul className="mt-xs space-y-[2px] text-body-sm text-secondary">
          {fund.contacts.map((c, i) => (
            <li key={i}>
              {[c.first, c.last].filter(Boolean).join(" ")}
              {c.title ? `, ${c.title}` : ""} · {c.email ? <span className="text-heading">{c.email}</span> : <span className="text-warning">no email yet</span>}
              {c.confidence !== null && c.email ? <span className="text-muted"> ({c.confidence}%)</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className={`mt-xs text-body-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p> : null}
    </li>
  );
}

/** At the end of a step: Add a Fund, and the funds added by hand for this client. */
export function AddFund() {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AddedFund | null>(null);
  const [showList, setShowList] = useState(false);
  const [done, setDone] = useState("");
  if (!ctx) return null;
  const count = ctx.funds.length;
  return (
    <div className="mt-md rounded-card border border-dashed border-border px-md py-sm">
      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          className={smallButton}
          disabled={!ctx.options}
          onClick={() => {
            setEditing(null);
            setOpen((o) => !o || editing !== null);
            setDone("");
          }}
        >
          {open && !editing ? "Close" : "+ Add a Fund"}
        </button>
        <span className="text-body-sm text-muted">Into the Fund Database for every client, and onto this client&apos;s Final Roster.</span>
        {count ? (
          <button type="button" className="text-body-sm text-primary hover:underline" onClick={() => setShowList((s) => !s)}>
            {showList ? "Hide" : "Show"} the {plural(count, "fund")} added by hand
          </button>
        ) : null}
      </div>
      {ctx.error ? <p className="mt-xs text-body-sm text-error">{ctx.error}</p> : null}
      {done ? <p className="mt-xs text-body-sm text-success">{done}</p> : null}
      {open && ctx.options ? (
        <FundForm
          key={editing?.id ?? "new"}
          editing={editing}
          onDone={(message) => {
            setOpen(false);
            setEditing(null);
            setDone(message);
            if (message) setShowList(true);
          }}
        />
      ) : null}
      {showList && count ? (
        <ul className="mt-sm">
          {ctx.funds.map((f) => (
            <FundRow
              key={f.id}
              fund={f}
              onEdit={() => {
                setEditing(f);
                setOpen(true);
                setDone("");
              }}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
