"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { copyCompanyToSandbox, resetSandboxData, runSandbox } from "@/app/admin/sandbox-actions";
import { FieldInput, type Taxonomy } from "@/app/admin/clients/[id]/profile/profile-fields";
import { SANDBOX_FIELDS, type SandboxPanel } from "@/lib/match/sandbox";
import { matchPath, type MatchAnswers } from "@/lib/match/shared";

const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary no-underline transition-colors duration-hover hover:text-heading disabled:opacity-40";
const selectClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";

const SANDBOX = "sandbox";
const REQUIRED = new Set(["stage", "core_vertical", "hq_country"]);

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function hasValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value && value.trim());
}

/** Test matching without a real company: pick one, or fill in the Test Pilot. */
export function MatchSandbox({ panel, taxonomy }: { panel: SandboxPanel; taxonomy: Taxonomy }) {
  const router = useRouter();
  const [picked, setPicked] = useState(SANDBOX);
  const [answers, setAnswers] = useState<MatchAnswers>(panel.answers);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const company = panel.companies.find((item) => item.id === picked) ?? null;
  const sectorSet = hasValue(answers.core_vertical) || hasValue(answers.core_industry);
  const missing = [
    hasValue(answers.stage) ? "" : "Stage",
    sectorSet ? "" : "Verticals or industries",
    hasValue(answers.hq_country) ? "" : "HQ country",
  ].filter(Boolean);
  const isUs = answers.hq_country === "United States";

  function set(id: string, value: string | string[]) {
    setAnswers((current) => {
      const next = { ...current, [id]: value };
      if (id === "hq_country" && value !== "United States") delete next.hq_state;
      return next;
    });
  }

  async function act(label: string, work: () => Promise<void>) {
    setPending(label);
    setNotice(null);
    try {
      await work();
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "Something went wrong.") });
    } finally {
      setPending(null);
    }
  }

  const run = () =>
    act("run", async () => {
      const result = await runSandbox(answers);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      router.push(matchPath(result.clientId));
    });

  const copy = (clientId: string) =>
    act("copy", async () => {
      const result = await copyCompanyToSandbox(clientId);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setAnswers(result.answers);
      setPicked(SANDBOX);
      setNotice({ kind: "ok", text: `Copied ${company?.name ?? "the company"}'s inputs. Change anything, then Run match.` });
    });

  const reset = () => {
    if (
      !window.confirm(
        "Reset the sandbox? Its reviews, keep/remove decisions, verification runs and the list pushed to its portal are deleted. Fund Database fixes stay.",
      )
    ) {
      return;
    }
    void act("reset", async () => {
      const result = await resetSandboxData();
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setNotice({ kind: "ok", text: "The sandbox is clean." });
      router.refresh();
    });
  };

  return (
    <section id="match-sandbox" className="mb-lg scroll-mt-lg rounded-card border border-primary/40 bg-surface px-lg py-md">
      <h2 className="text-h4 text-heading">Match Sandbox</h2>
      <p className="text-body-sm text-muted">
        Test matching without setting up a client: open a company&apos;s match, or fill in the Test Pilot and run it.
      </p>

      <label className="mt-md block max-w-md">
        <span className="block text-label uppercase tracking-label text-muted">Company</span>
        <select className={`${selectClass} mt-xs`} value={picked} onChange={(event) => setPicked(event.target.value)}>
          <option value={SANDBOX}>Test Pilot (sandbox)</option>
          {panel.companies.length > 0 ? (
            <optgroup label="Companies">
              {panel.companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.archived ? " (archived)" : ""}
                  {item.ready ? "" : " · profile not ready"}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </label>

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-md text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {company ? (
        <div className="mt-md space-y-sm text-body-sm">
          <p className={company.ready ? "text-success" : "text-warning"}>
            {company.ready
              ? "Profile ready: stage, sector and HQ country are set."
              : `Profile not ready: needs ${company.missing.join(", ")}.`}
          </p>
          <div className="flex flex-wrap gap-sm">
            {company.ready ? (
              <Link href={matchPath(company.id)} className={primaryButton + " no-underline"}>
                Open Match
              </Link>
            ) : (
              <Link href={`/admin/clients/${company.id}/profile`} className={secondaryButton}>
                Edit company profile
              </Link>
            )}
            <button type="button" className={secondaryButton} disabled={Boolean(pending)} onClick={() => void copy(company.id)}>
              {pending === "copy" ? "Copying…" : "Copy into Test Pilot"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-md grid gap-md md:grid-cols-2">
            {SANDBOX_FIELDS.filter((field) => field.id !== "hq_state" || isUs).map((field) => {
              const wide = field.kind === "verticals" || field.kind === "industries" || field.kind === "markets" || field.kind === "investor_types" || field.kind === "textarea";
              return (
                <div key={field.id} className={wide ? "md:col-span-2" : undefined}>
                  <label htmlFor={`match-${field.id}`} className="block text-label uppercase tracking-label text-muted">
                    {field.label}
                    {REQUIRED.has(field.id) ? <span className="text-error"> *</span> : null}
                  </label>
                  <FieldInput field={field} value={answers[field.id]} taxonomy={taxonomy} onChange={(value) => set(field.id, value)} />
                  {field.hint ? <p className="mt-xs text-body-sm text-muted">{field.hint}</p> : null}
                </div>
              );
            })}
          </div>
          {missing.length > 0 ? (
            <p className="mt-md text-body-sm text-muted">Required to run: {missing.join(", ")}.</p>
          ) : null}
          <div className="mt-md flex flex-wrap gap-sm">
            <button type="button" className={primaryButton} disabled={Boolean(pending) || missing.length > 0} onClick={() => void run()}>
              {pending === "run" ? "Running the match…" : "Run match"}
            </button>
            {panel.sandboxId ? (
              <>
                <Link href={matchPath(panel.sandboxId)} className={secondaryButton}>
                  Open last sandbox match
                </Link>
                <button type="button" className={secondaryButton} disabled={Boolean(pending)} onClick={reset}>
                  {pending === "reset" ? "Resetting…" : "Reset sandbox"}
                </button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
