"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmClassification, updateSectors } from "@/app/admin/profile-actions";
import {
  errorText,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  smallButton,
} from "@/app/admin/clients/[id]/match/ui";
import { Select } from "@/components/select";
import { formatDateAtTime } from "@/lib/format";
import {
  READINESS_LABEL,
  SEVERITY_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  VERSION_SOURCE_LABEL,
  type Classification,
  type CompanyProfile,
  type IssueSeverity,
  type ProfileIssue,
  type Readiness,
  type TextFact,
  type VersionSource,
} from "@/lib/company-profile/core";

export type VersionRow = {
  version: number;
  source: VersionSource;
  readiness: Readiness;
  createdBy: string | null;
  createdAt: string;
  note: string;
};

export type SectorChoice = { id: string; label: string; broad: boolean };

const READINESS_TONE: Record<Readiness, string> = {
  blocked: "border-error/40 text-error",
  limited: "border-warning/40 text-warning",
  ready: "border-success/40 text-success",
};

const SEVERITY_TONE: Record<IssueSeverity, string> = {
  blocking: "text-error",
  limited: "text-warning",
  info: "text-muted",
};

function Chip({ children, tone = "text-secondary" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex rounded-full border border-border px-sm py-px text-label uppercase tracking-label ${tone}`}>
      {children}
    </span>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setPending(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      setError(errorText(err, "Something went wrong."));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

function Evidence({ items }: { items: { quote: string; verified: boolean }[] }) {
  if (items.length === 0) return <p className="text-body-sm text-muted">No founder quote.</p>;
  return (
    <ul className="space-y-xs text-body-sm">
      {items.map((item) => (
        <li key={item.quote} className={item.verified ? "text-secondary" : "text-warning"}>
          <span aria-hidden="true">{item.verified ? "✓ " : "✗ "}</span>
          <span className="sr-only">{item.verified ? "Found in the founder's messages: " : "Not found in the founder's messages: "}</span>
          “{item.quote}”{item.verified ? "" : " (not found in the founder's messages)"}
        </li>
      ))}
    </ul>
  );
}

function ClassCard({
  title,
  item,
  clientId,
  path,
}: {
  title: string;
  item: Classification;
  clientId: string;
  path: string;
}) {
  const { pending, error, run } = useRun();
  return (
    <div className="rounded-md border border-border bg-background p-md">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <p className="text-label uppercase tracking-label text-muted">{title}</p>
          <p className="text-body text-heading">{item.label}</p>
          <div className="mt-xs flex flex-wrap gap-xs">
            <Chip>{SOURCE_LABEL[item.source]}</Chip>
            <Chip tone={item.status === "needs_confirmation" ? "text-warning" : "text-success"}>{STATUS_LABEL[item.status]}</Chip>
            {item.confidence ? <Chip tone="text-muted">Confidence: {item.confidence}</Chip> : null}
          </div>
        </div>
        {item.status !== "confirmed_founder" ? (
          <button type="button" className={smallButton} disabled={pending} onClick={() => run(() => confirmClassification(clientId, path))}>
            Confirmed with founder
          </button>
        ) : null}
      </div>
      <div className="mt-sm space-y-xs">
        <Evidence items={item.evidence} />
        {item.rationale ? (
          <p className="text-body-sm text-secondary">
            <span className="text-muted">Why: </span>
            {item.rationale}
          </p>
        ) : null}
        <p className="text-label text-muted">
          {item.decidedBy ? `Decided by ${item.decidedBy}. ` : ""}
          {item.confirmedBy ? `Confirmed with the founder by ${item.confirmedBy}${item.confirmedAt ? `, ${formatDateAtTime(item.confirmedAt)}` : ""}.` : ""}
        </p>
      </div>
      {error ? (
        <p role="alert" className="mt-xs text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Fact({ label, fact }: { label: string; fact: TextFact | null }) {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      {fact ? (
        <>
          <p className="mt-xs text-body-sm text-heading">
            {fact.text} <span className="text-muted">({SOURCE_LABEL[fact.source]})</span>
          </p>
          <Evidence items={fact.evidence} />
        </>
      ) : (
        <p className="mt-xs text-body-sm text-muted">Not recorded.</p>
      )}
    </div>
  );
}

function SectorEditor({
  clientId,
  profile,
  choices,
  onDone,
}: {
  clientId: string;
  profile: CompanyProfile;
  choices: SectorChoice[];
  onDone: () => void;
}) {
  const { pending, error, run } = useRun();
  const ids = profile.sectors.map((s) => s.nodeId);
  const [primary, setPrimary] = useState(ids[0] ?? "");
  const [second, setSecond] = useState(ids[1] ?? "");
  const [third, setThird] = useState(ids[2] ?? "");
  const [rationale, setRationale] = useState("");
  const options = (current: string) => (
    <>
      <option value="">{current === "primary" ? "Pick a sector" : "None"}</option>
      <optgroup label="Specific sectors">
        {choices.filter((c) => !c.broad).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Broad industries">
        {choices.filter((c) => c.broad).map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </optgroup>
    </>
  );

  async function save() {
    const ok = await run(() => updateSectors(clientId, { primary, secondary: [second, third].filter(Boolean), rationale }));
    if (ok) onDone();
  }

  return (
    <div className="mt-sm space-y-sm rounded-md border border-border bg-background p-md">
      <div className="grid gap-sm sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="sector-primary">
            Primary sector
          </label>
          <Select id="sector-primary" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            {options("primary")}
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="sector-second">
            Secondary
          </label>
          <Select id="sector-second" value={second} onChange={(e) => setSecond(e.target.value)}>
            {options("secondary")}
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="sector-third">
            Secondary
          </label>
          <Select id="sector-third" value={third} onChange={(e) => setThird(e.target.value)}>
            {options("secondary")}
          </Select>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="sector-why">
          Why (required for a change)
        </label>
        <textarea
          id="sector-why"
          className={`${inputClass} mt-xs`}
          rows={2}
          maxLength={800}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="What the company does that puts it in these sectors (not its customers' industries)."
        />
      </div>
      <p className="text-body-sm text-muted">
        Prefer the most specific sector the business supports. The profile fields matching runs on follow this change.
      </p>
      <div className="flex flex-wrap gap-sm">
        <button type="button" className={primaryButton} disabled={pending || !primary} onClick={save}>
          Save sectors
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ClassificationPanel({
  clientId,
  profile,
  issues,
  readiness,
  version,
  versions,
  outOfSync,
  unusable,
  choices,
}: {
  clientId: string;
  profile: CompanyProfile;
  issues: ProfileIssue[];
  readiness: Readiness;
  version: VersionRow | null;
  versions: VersionRow[];
  outOfSync: boolean;
  unusable: string[];
  choices: SectorChoice[];
}) {
  const [editing, setEditing] = useState(false);
  const sorted = [...issues].sort(
    (a, b) => ["blocking", "limited", "info"].indexOf(a.severity) - ["blocking", "limited", "info"].indexOf(b.severity),
  );
  const list = (items: Classification[]) => (items.length ? items.map((c) => c.label).join(", ") : "None");

  return (
    <section aria-labelledby="classification" className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md border-b border-border px-lg py-md">
        <div>
          <h2 id="classification" className="text-h4 text-heading">
            Classification
          </h2>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            The company in investor-taxonomy categories, with the founder&apos;s own words behind each one. Matching still runs on
            the profile fields below; readiness here is shown only and does not change today&apos;s matching.
          </p>
          <p className="mt-xs text-body-sm text-secondary">
            {version
              ? `Version ${version.version} · ${VERSION_SOURCE_LABEL[version.source]}${version.createdBy ? ` by ${version.createdBy}` : ""} · ${formatDateAtTime(version.createdAt)}`
              : "Legacy profile: built before evidence was recorded. Rebuild from the intake to collect it."}
          </p>
          {outOfSync ? (
            <p className="mt-xs text-body-sm text-warning">
              The profile fields changed after this version. Shown merged; the next change saves a new version.
            </p>
          ) : null}
        </div>
        <span className={`inline-flex rounded-full border px-md py-xs text-label uppercase tracking-label ${READINESS_TONE[readiness]}`}>
          {READINESS_LABEL[readiness]}
        </span>
      </div>

      {sorted.length > 0 ? (
        <ul className="space-y-xs border-b border-border px-lg py-md text-body-sm">
          {sorted.map((issue, i) => (
            <li key={`${issue.field}-${i}`} className={SEVERITY_TONE[issue.severity]}>
              <span className="font-medium">{SEVERITY_LABEL[issue.severity]}</span> · {issue.field}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-md border-b border-border px-lg py-md md:grid-cols-3">
        <Fact label="What the company does" fact={profile.business.product} />
        <Fact label="Who pays" fact={profile.business.customers} />
        <div>
          <p className={labelClass}>Not the company&apos;s sector</p>
          {profile.business.notCompanySectors.length ? (
            <ul className="mt-xs space-y-xs text-body-sm text-secondary">
              {profile.business.notCompanySectors.map((item) => (
                <li key={item.label}>
                  <span className="text-heading">{item.label}</span>: {item.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-xs text-body-sm text-muted">None recorded.</p>
          )}
        </div>
      </div>

      <div className="space-y-sm px-lg py-md">
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 className="text-body text-heading">Sectors</h3>
          <button type="button" className={smallButton} onClick={() => setEditing((open) => !open)}>
            {editing ? "Close" : "Change sectors"}
          </button>
        </div>
        {editing ? <SectorEditor clientId={clientId} profile={profile} choices={choices} onDone={() => setEditing(false)} /> : null}
        {profile.sectors.length === 0 ? <p className="text-body-sm text-error">No sector yet.</p> : null}
        <div className="grid gap-sm md:grid-cols-3">
          {profile.sectors.map((sector) => (
            <ClassCard
              key={`${sector.nodeId}-${sector.status}-${sector.source}`}
              title={sector.role === "primary" ? "Primary sector" : "Secondary sector"}
              item={sector}
              clientId={clientId}
              path={`sector:${sector.nodeId}`}
            />
          ))}
        </div>
        {unusable.length > 0 ? (
          <p className="text-body-sm text-warning">Not usable by the current matching engine yet: {unusable.join(", ")}.</p>
        ) : null}

        <h3 className="pt-sm text-body text-heading">Stage and headquarters</h3>
        <div className="grid gap-sm md:grid-cols-3">
          {profile.stage ? <ClassCard key={`stage-${profile.stage.status}`} title="Stage" item={profile.stage} clientId={clientId} path="stage" /> : null}
          {profile.hq.country ? (
            <ClassCard key={`country-${profile.hq.country.status}`} title="HQ country" item={profile.hq.country} clientId={clientId} path="hq_country" />
          ) : null}
          {profile.hq.state ? (
            <ClassCard key={`state-${profile.hq.state.status}`} title="HQ state" item={profile.hq.state} clientId={clientId} path="hq_state" />
          ) : null}
        </div>
        <p className="text-body-sm text-secondary">
          <span className="text-muted">Also selling into:</span> {list(profile.markets)} ·{" "}
          <span className="text-muted">Financing:</span> {list(profile.financing)} ·{" "}
          <span className="text-muted">Investor types:</span> {profile.firmTypes.length ? list(profile.firmTypes) : "Set from the stage"}
        </p>
        <p className="text-body-sm text-muted">Stage, headquarters and markets are edited in the profile fields below.</p>
      </div>

      {versions.length > 0 ? (
        <details className="border-t border-border px-lg py-md">
          <summary className="cursor-pointer text-body-sm text-heading">Version history ({versions.length})</summary>
          <ul className="mt-sm space-y-xs text-body-sm text-secondary">
            {versions.map((v) => (
              <li key={v.version}>
                <span className="text-heading">v{v.version}</span> · {VERSION_SOURCE_LABEL[v.source]} · {READINESS_LABEL[v.readiness]}
                {v.createdBy ? ` · ${v.createdBy}` : ""} · {formatDateAtTime(v.createdAt)}
                {v.note ? <span className="text-muted"> · {v.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
