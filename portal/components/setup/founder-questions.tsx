"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerFounderQuestionAction } from "@/app/portal/setup/actions";
import { AutoTextarea } from "@/components/email-body-field";

type Item = { id: string; question: string; answer: string };

/** Rupert's questions to the founder, answered right on the page. */
export function FounderQuestions({ items, readOnly }: { items: Item[]; readOnly: boolean }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (items.length === 0) return null;
  const open = items.filter((item) => !item.answer).length;

  async function save(id: string) {
    setSaving(id);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const result = await answerFounderQuestionAction(id, drafts[id] ?? "");
      if (!result.ok) setErrors((current) => ({ ...current, [id]: result.error }));
      else router.refresh();
    } catch (err) {
      setErrors((current) => ({ ...current, [id]: err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="mb-lg rounded-card border border-border bg-surface px-lg py-lg">
      <h2 className="text-h4">A few questions from Rupert</h2>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        {open > 0
          ? "Your answers sharpen the pitch and the investor emails. A line or two each is plenty."
          : "Thank you. Rupert has your answers."}
      </p>
      <ol className="mt-md grid gap-md">
        {items.map((item, index) => (
          <li key={item.id}>
            <p className="text-body text-heading">
              {index + 1}. {item.question}
            </p>
            {item.answer ? (
              <p className="mt-xs whitespace-pre-wrap text-body-sm text-secondary">{item.answer}</p>
            ) : (
              <>
                <AutoTextarea
                  className="mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
                  value={drafts[item.id] ?? ""}
                  aria-label={item.question}
                  disabled={readOnly}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <button
                  type="button"
                  className="mt-xs rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                  disabled={readOnly || saving !== null || !(drafts[item.id] ?? "").trim()}
                  onClick={() => void save(item.id)}
                >
                  {saving === item.id ? "Sending…" : "Send answer"}
                </button>
                {errors[item.id] ? <p role="alert" className="mt-xs text-body-sm text-error">{errors[item.id]}</p> : null}
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
