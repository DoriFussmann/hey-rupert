"use client";

import { useState } from "react";
import Link from "next/link";
import { saveIntakeSettings } from "@/app/admin/actions";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import { matchingUse, topicIdFromTitle, type IntakeTopic } from "@/lib/intake";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const labelClass = "block text-label uppercase tracking-label text-muted";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const FLASH_KEY = "intake-settings";

export function IntakeSettingsEditor({
  initialTopics,
  defaultTopics,
}: {
  initialTopics: IntakeTopic[];
  defaultTopics: IntakeTopic[];
}) {
  const [topics, setTopics] = useState<IntakeTopic[]>(initialTopics);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash(FLASH_KEY);

  function updateTopic(index: number, patch: Partial<IntakeTopic>) {
    setTopics((current) =>
      current.map((topic, i) => (i === index ? { ...topic, ...patch } : topic)),
    );
  }

  function moveTopic(index: number, direction: -1 | 1) {
    setTopics((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeTopic(index: number) {
    setTopics((current) => current.filter((_, i) => i !== index));
  }

  function addTopic() {
    setTopics((current) => {
      const taken = new Set(current.map((topic) => topic.id));
      return [
        ...current,
        {
          id: topicIdFromTitle(`topic ${current.length + 1}`, taken),
          title: "",
          guidance: "",
          required: false,
        },
      ];
    });
  }

  function restoreDefaults() {
    const confirmed = window.confirm(
      "Replace the topics with the defaults? Nothing is saved until you click Save.",
    );
    if (!confirmed) return;
    setTopics(defaultTopics);
    setAdminFlash(FLASH_KEY, {
      kind: "ok",
      text: "Defaults restored. Click Save to keep them.",
    });
  }

  async function onSave() {
    setPending(true);
    setAdminFlash(FLASH_KEY, null);

    try {
      const result = await saveIntakeSettings(topics);
      setAdminFlash(
        FLASH_KEY,
        result.ok
          ? { kind: "ok", text: "Saved." }
          : { kind: "error", text: result.error },
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
      <section className="rounded-card border border-border bg-surface p-lg">
        <h2 className="text-h4">Rupert&apos;s instructions</h2>
        <p className="mt-xs text-body-sm text-muted">
          Persona, interview style, and how to open and close are a managed prompt, with every version kept.{" "}
          <Link href="/admin/forms/agents/intake_interviewer" className="text-primary underline hover:text-primary-hover">
            Edit the Intake interviewer prompt
          </Link>
          . Rupert also receives the company details you entered and the topics below.
        </p>
      </section>

      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-lg">
          <h2 className="text-h4">Topics</h2>
          <p className="mt-xs text-body-sm text-muted">
            What Rupert must learn. The client&apos;s progress is measured on
            required topics; the summary covers all of them.
          </p>
          <p className="mt-xs text-body-sm text-muted">
            Topics marked &ldquo;Used by matching&rdquo; feed the company profile matching runs on. They stay
            required and can&apos;t be removed; keep their wording asking for what they feed. The others are used for
            outreach and writing only.
          </p>
        </div>

        <ol>
          {topics.map((topic, index) => {
            const use = matchingUse(topic.id);
            return (
            <li
              key={topic.id}
              className="border-b border-border px-lg py-md last:border-b-0"
            >
              <div className="flex flex-wrap items-start gap-md">
                <span className="mt-sm w-6 shrink-0 font-mono text-mono text-muted">
                  {index + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-sm">
                  <p className={`text-body-sm ${use ? "text-primary" : "text-muted"}`}>
                    {use ? `Used by matching: ${use}` : "Outreach and writing only"}
                  </p>
                  <label className={labelClass}>
                    Title
                    <input
                      className={fieldClass}
                      value={topic.title}
                      maxLength={80}
                      onChange={(event) =>
                        updateTopic(index, { title: event.target.value })
                      }
                    />
                  </label>
                  <label className={labelClass}>
                    What Rupert needs to learn
                    <textarea
                      className={`${fieldClass} min-h-[72px] resize-y`}
                      value={topic.guidance}
                      maxLength={600}
                      onChange={(event) =>
                        updateTopic(index, { guidance: event.target.value })
                      }
                    />
                  </label>
                  <label className="inline-flex items-center gap-sm text-body-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={use ? true : topic.required}
                      disabled={Boolean(use)}
                      onChange={(event) =>
                        updateTopic(index, { required: event.target.checked })
                      }
                      className="h-4 w-4 accent-primary"
                    />
                    Required{use ? " (always, used by matching)" : ""}
                  </label>
                </div>
                <div className="flex shrink-0 flex-col gap-xs">
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => moveTopic(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${topic.title || "topic"} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => moveTopic(index, 1)}
                    disabled={index === topics.length - 1}
                    aria-label={`Move ${topic.title || "topic"} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => removeTopic(index)}
                    disabled={topics.length <= 1 || Boolean(use)}
                    title={use ? "Used by matching: can't be removed" : undefined}
                    aria-label={`Remove ${topic.title || "topic"}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
            );
          })}
        </ol>

        <div className="border-t border-border px-lg py-md">
          <button
            type="button"
            className={smallButton}
            onClick={addTopic}
            disabled={topics.length >= 20}
          >
            Add topic
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={pending}
          className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
        >
          Restore defaults
        </button>
        {flash?.kind === "ok" ? (
          <p className="text-body-sm text-success">{flash.text}</p>
        ) : null}
        {flash?.kind === "error" ? (
          <p role="alert" className="text-body-sm text-error">
            {flash.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
