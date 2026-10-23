import { formatDateAtTime } from "@/lib/format";
import type { SetupQuestion } from "@/lib/setup";

/**
 * The client's questions on a review step and Rupert's answers, oldest
 * first. Asking never blocks confirming.
 */
export function QuestionThread({
  questions,
  adminName = "Rupert",
}: {
  questions: SetupQuestion[];
  adminName?: string;
}) {
  if (questions.length === 0) return null;
  return (
    <section aria-labelledby="question-thread-title" className="mt-lg rounded-card border border-border bg-surface">
      <h2 id="question-thread-title" className="border-b border-border px-lg py-md text-h4 text-heading">
        Your Questions
      </h2>
      <ul className="divide-y divide-border">
        {questions.map((item) => (
          <li key={item.id} className="px-lg py-md">
            <p className="text-label uppercase tracking-label text-muted">
              You asked{item.asked_at ? ` · ${formatDateAtTime(item.asked_at)}` : ""}
            </p>
            <p className="mt-xs whitespace-pre-wrap text-body-sm text-heading">{item.question}</p>
            {item.answer ? (
              <div className="mt-sm rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
                <p className="text-label uppercase tracking-label text-primary">
                  {adminName}&apos;s answer{item.answered_at ? ` · ${formatDateAtTime(item.answered_at)}` : ""}
                </p>
                <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{item.answer}</p>
              </div>
            ) : (
              <p className="mt-sm text-body-sm text-muted">
                {item.resolved_at
                  ? `${adminName} has followed up with you on this.`
                  : `${adminName} will answer soon. You can still confirm meanwhile.`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
