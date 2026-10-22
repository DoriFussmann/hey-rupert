"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { restorePromptVersionAction, savePromptAction, testPromptAction, type PromptTestOutput } from "@/app/admin/prompt-actions";
import { Select } from "@/components/select";
import { PROMPT_MAX, PROMPT_NOTE_MAX, versionLabel, type PromptKey } from "@/lib/prompts";
import type { PromptUseRow, PromptVersion } from "@/lib/prompts-server";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const labelClass = "block text-label uppercase tracking-label text-muted";
const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const cardClass = "rounded-card border border-border bg-surface p-lg";

type Notice = { kind: "ok" | "error"; text: string } | null;

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-sm text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}>
      {notice.text}
    </p>
  );
}

/**
 * Edits one managed prompt. Save makes a new active version (earlier ones
 * are kept); Test runs it for a client without saving or sending anything.
 */
export function PromptEditor({
  promptKey,
  fixed,
  testable,
  defaultText,
  versions,
  uses,
  clients,
}: {
  promptKey: PromptKey;
  fixed: string;
  testable: boolean;
  defaultText: string;
  versions: PromptVersion[];
  uses: PromptUseRow[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const active = versions[0] ?? null;
  const [text, setText] = useState(active?.content ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [clientId, setClientId] = useState("");
  const [output, setOutput] = useState<PromptTestOutput | null>(null);
  const [testNotice, setTestNotice] = useState<Notice>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const dirty = text.trim() !== (active?.content ?? "").trim();
  const tooLong = text.trim().length > PROMPT_MAX;

  async function save() {
    setBusy("save");
    setNotice(null);
    try {
      const result = await savePromptAction(promptKey, text, note);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setNotice({ kind: "ok", text: `Saved as version ${result.version}. It applies to the next run; nothing was re-run or sent.` });
      setNote("");
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setBusy(null);
    }
  }

  async function restore(version: number) {
    if (!window.confirm(`Make version ${version} active again? It is saved as a new version; nothing else changes.`)) return;
    setBusy(`restore-${version}`);
    setNotice(null);
    try {
      const result = await restorePromptVersionAction(promptKey, version);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setNotice({ kind: "ok", text: `Version ${version} is active again, saved as version ${result.version}.` });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Unable to restore." });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setTestNotice(null);
    setOutput(null);
    try {
      const result = await testPromptAction(promptKey, clientId, dirty ? text : null);
      if (!result.ok) {
        setTestNotice({ kind: "error", text: result.error });
        return;
      }
      setOutput(result.output);
      setTestNotice({ kind: "ok", text: `Ran ${dirty ? "your unsaved text" : `the active ${versionLabel(active?.version ?? 0)}`}. Nothing was saved or sent.` });
      router.refresh();
    } catch (err) {
      setTestNotice({ kind: "error", text: err instanceof Error ? err.message : "The test failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-lg">
      <section className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <h2 className="text-h4">Prompt</h2>
          <p className="text-body-sm text-muted">
            {active ? `${versionLabel(active.version)} active · saved ${when(active.createdAt)} by ${active.createdBy ?? "unknown"}` : "Not set up yet"}
          </p>
        </div>
        <label className={`${labelClass} mt-md`}>
          Instructions
          <textarea
            className={`${fieldClass} min-h-[360px] resize-y font-mono`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck
          />
        </label>
        <p className={`mt-xs text-label ${tooLong ? "text-error" : "text-muted"}`}>
          {text.trim().length.toLocaleString("en-US")} / {PROMPT_MAX.toLocaleString("en-US")} characters
        </p>
        <div className="mt-sm rounded-md border border-border px-sm py-xs text-body-sm text-secondary">
          <p className="text-heading">Added by the code, not editable here</p>
          <p className="mt-xs">{fixed}</p>
        </div>
        <label className={`${labelClass} mt-md`}>
          What changed (optional, kept with the version)
          <input className={fieldClass} value={note} maxLength={PROMPT_NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="mt-md flex flex-wrap items-center gap-sm">
          <button type="button" className={primaryButton} disabled={!dirty || tooLong || !text.trim() || Boolean(busy)} onClick={() => void save()}>
            {busy === "save" ? "Saving…" : `Save as version ${(active?.version ?? 0) + 1}`}
          </button>
          <button type="button" className={smallButton} disabled={!dirty || Boolean(busy)} onClick={() => setText(active?.content ?? "")}>
            Discard changes
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={Boolean(busy) || text.trim() === defaultText.trim()}
            onClick={() => {
              if (window.confirm("Put the default text in the editor? Nothing is saved until you click Save.")) setText(defaultText);
            }}
          >
            Reset to default
          </button>
        </div>
        <NoticeLine notice={notice} />
      </section>

      <section className={cardClass}>
        <h2 className="text-h4">Test on a client</h2>
        {testable ? (
          <>
            <p className="mt-xs text-body-sm text-muted">
              Runs {dirty ? "the text in the editor (unsaved)" : "the active version"} with this client&apos;s real data and shows the result. Nothing is saved,
              sent or changed for the client. It costs one AI call.
            </p>
            <div className="mt-sm flex flex-wrap items-end gap-sm">
              <label className={`${labelClass} min-w-[16rem] flex-1`}>
                Client
                <Select value={clientId} onChange={(event) => setClientId(event.target.value)} className="normal-case tracking-normal">
                  <option value="">{clients.length > 0 ? "Choose a client…" : "No active clients"}</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </label>
              <button type="button" className={primaryButton} disabled={!clientId || tooLong || !text.trim() || Boolean(busy)} onClick={() => void test()}>
                {busy === "test" ? "Running… (up to a few minutes)" : "Run test"}
              </button>
            </div>
            <NoticeLine notice={testNotice} />
            {output ? (
              <div className="mt-md space-y-sm">
                <p className="text-heading">{output.title}</p>
                {output.sections.map((section, index) => (
                  <div key={`${section.label}-${index}`} className="rounded-md border border-border px-sm py-xs">
                    <p className="text-label uppercase tracking-label text-muted">{section.label}</p>
                    <pre className="mt-xs whitespace-pre-wrap break-words font-sans text-body-sm text-body">{section.text || "(empty)"}</pre>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-xs text-body-sm text-muted">
            This prompt runs inside a batch job (or only on the test client), so it isn&apos;t run from here. Its recent uses below show which version each run used.
          </p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-h4">Versions</h2>
        <p className="mt-xs text-body-sm text-muted">Every saved version is kept. Making an older one active saves it again as the newest version.</p>
        {versions.length === 0 ? (
          <p className="mt-sm text-body-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-sm divide-y divide-border text-body-sm">
            {versions.map((version, index) => (
              <li key={version.version} className="py-sm">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <span>
                    <span className="text-heading">{versionLabel(version.version)}</span>
                    {index === 0 ? <span className="ml-xs text-success">active</span> : null}
                    <span className="text-secondary">
                      {" "}
                      · {when(version.createdAt)} by {version.createdBy ?? "unknown"}
                      {version.note ? ` · ${version.note}` : ""}
                    </span>
                  </span>
                  <span className="flex gap-xs">
                    <button type="button" className={smallButton} onClick={() => setViewing(viewing === version.version ? null : version.version)}>
                      {viewing === version.version ? "Hide" : "View"}
                    </button>
                    {index > 0 ? (
                      <button type="button" className={smallButton} disabled={Boolean(busy)} onClick={() => void restore(version.version)}>
                        {busy === `restore-${version.version}` ? "Restoring…" : "Make active"}
                      </button>
                    ) : null}
                  </span>
                </div>
                {viewing === version.version ? (
                  <pre className="mt-xs max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-sm py-xs font-mono text-label text-body">
                    {version.content}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-h4">Recent uses</h2>
        <p className="mt-xs text-body-sm text-muted">Each AI call records the version it used.</p>
        {uses.length === 0 ? (
          <p className="mt-sm text-body-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-sm divide-y divide-border text-body-sm text-secondary">
            {uses.map((use, index) => (
              <li key={`${use.at}-${index}`} className="py-xs">
                {when(use.at)} · {versionLabel(use.version)} · {use.purpose}
                {use.clientName ? ` · ${use.clientName}` : ""}
                {use.test ? " · test" : ""}
                {use.actor ? ` · ${use.actor}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
