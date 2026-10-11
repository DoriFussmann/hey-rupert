import { formatDateAtTime } from "@/lib/format";
import {
  intakeProgress,
  topicCoverage,
  type IntakeInterview,
  type IntakeTopic,
} from "@/lib/intake";

function statusLine(
  interview: IntakeInterview | null,
  completedAt: string | null,
  percent: number,
) {
  if (completedAt) {
    const when = `Completed ${formatDateAtTime(completedAt)}`;
    if (!interview || interview.messages.length === 0) return when;
    return interview.status === "completed"
      ? `${when} · summary confirmed by the client`
      : `${when} (essentials covered) · the client may still add extras`;
  }
  if (!interview || interview.messages.length === 0) return "Not started";
  if (interview.status === "review") return "Client is reviewing the summary";
  return `In progress · ${percent}% of required topics`;
}

export function IntakePanel({
  interview,
  topics,
  completedAt,
}: {
  interview: IntakeInterview | null;
  topics: IntakeTopic[];
  completedAt: string | null;
}) {
  const topicStatus = interview?.topic_status ?? {};
  const { percent } = intakeProgress(topics, topicStatus);
  const summary = interview?.summary ?? null;

  return (
    <section className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h2 className="text-h4">Client Intake</h2>
        <p className="mt-xs text-body-sm text-muted">
          {statusLine(interview, completedAt, percent)}
          {interview && interview.messages.length > 0
            ? ` · ${interview.client_message_count} client messages · last activity ${formatDateAtTime(interview.updated_at)}`
            : ""}
        </p>
      </div>

      {summary ? (
        <dl className="divide-y divide-border">
          {summary.map((item) => (
            <div key={item.topic_id} className="px-lg py-md">
              <dt className="text-label uppercase tracking-label text-muted">
                {item.title}
              </dt>
              <dd className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      ) : interview && interview.messages.length > 0 ? (
        <ul className="divide-y divide-border">
          {topics.map((topic) => (
            <li key={topic.id} className="flex flex-wrap gap-x-md px-lg py-sm text-body-sm">
              <span className="w-48 shrink-0 text-heading">{topic.title}</span>
              <span className="text-muted">
                {topicCoverage(topicStatus, topic.id)}
                {topicStatus[topic.id]?.note
                  ? ` — ${topicStatus[topic.id].note}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {interview && interview.messages.length > 0 ? (
        <details className="border-t border-border px-lg py-lg">
          <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
            Full transcript ({interview.messages.length} messages)
          </summary>
          <ol className="mt-md space-y-md">
            {interview.messages.map((message, index) => (
              <li key={index} className="text-body-sm">
                <p className="text-label uppercase tracking-label text-muted">
                  {message.role === "assistant" ? "Rupert" : "Client"}
                  {message.at ? ` · ${formatDateAtTime(message.at)}` : ""}
                </p>
                <p className="mt-xs whitespace-pre-wrap text-body">
                  {message.content}
                </p>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
