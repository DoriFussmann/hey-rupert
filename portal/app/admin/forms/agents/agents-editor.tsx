"use client";

import { useState } from "react";
import { saveAgentPrompts } from "@/app/admin/agent-actions";
import { AGENTS, AGENT_PROMPT_MAX, type AgentId, type AgentPrompts } from "@/lib/agents";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const FLASH_KEY = "agent-prompts";

export function AgentsEditor({ initialPrompts }: { initialPrompts: AgentPrompts }) {
  const [prompts, setPrompts] = useState<AgentPrompts>(initialPrompts);
  const [saved, setSaved] = useState<AgentPrompts>(initialPrompts);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash(FLASH_KEY);

  const dirty = AGENTS.some((agent) => prompts[agent.id] !== saved[agent.id]);

  function setPrompt(id: AgentId, value: string) {
    setPrompts((current) => ({ ...current, [id]: value }));
  }

  function resetOne(id: AgentId) {
    const agent = AGENTS.find((item) => item.id === id)!;
    if (!window.confirm(`Reset "${agent.title}" to the default? Nothing is saved until you click Save.`)) {
      return;
    }
    setPrompt(id, agent.defaultPrompt);
  }

  async function onSave() {
    setPending(true);
    setAdminFlash(FLASH_KEY, null);
    try {
      const result = await saveAgentPrompts(prompts);
      if (result.ok) setSaved(prompts);
      setAdminFlash(
        FLASH_KEY,
        result.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: result.error },
      );
    } catch (err) {
      setAdminFlash(FLASH_KEY, {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to save.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-lg">
      {AGENTS.map((agent) => {
        const value = prompts[agent.id];
        const isDefault = value.trim() === agent.defaultPrompt.trim();
        return (
          <section key={agent.id} className="rounded-card border border-border bg-surface p-lg">
            <div className="flex flex-wrap items-start justify-between gap-md">
              <div className="min-w-0">
                <h2 className="text-h4">{agent.title}</h2>
                <p className="mt-xs max-w-prose text-body-sm text-muted">{agent.description}</p>
              </div>
              <div className="flex items-center gap-sm">
                <span className="text-body-sm text-muted">{isDefault ? "Default" : "Edited"}</span>
                <button
                  type="button"
                  className={smallButton}
                  disabled={pending || isDefault}
                  onClick={() => resetOne(agent.id)}
                >
                  Reset to default
                </button>
              </div>
            </div>
            <label className="mt-md block text-label uppercase tracking-label text-muted">
              Instructions
              <textarea
                className={`${fieldClass} min-h-[280px] resize-y`}
                value={value}
                maxLength={AGENT_PROMPT_MAX}
                onChange={(event) => setPrompt(agent.id, event.target.value)}
                spellCheck
              />
            </label>
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
        {flash?.kind === "ok" ? <p className="text-body-sm text-success">{flash.text}</p> : null}
        {flash?.kind === "error" ? (
          <p role="alert" className="text-body-sm text-error">
            {flash.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
