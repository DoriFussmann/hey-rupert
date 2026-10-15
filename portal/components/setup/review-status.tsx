import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDateAtTime } from "@/lib/format";
import type { SetupItem, SetupStepState } from "@/lib/setup";

/** The turn banner for a review step (framing, investor list, email copy). */
export function ReviewStatus({
  item,
  row,
  waitingTitle,
  waitingDetail,
}: {
  item: SetupItem | null;
  row: SetupStepState | null;
  /** Replaces the generic "working on your feedback" copy. */
  waitingTitle?: string;
  waitingDetail?: string;
}) {
  if (!item || item.status === "open") {
    return (
      <TurnBanner owner="rupert" title={item?.detail ?? "Not open yet."} />
    );
  }

  if (row?.status === "with_client") {
    return (
      <TurnBanner
        owner="client"
        title={item.detail}
        detail={
          row.published_at
            ? `Shared ${formatDateAtTime(row.published_at)}${row.version > 1 ? ` · version ${row.version}` : ""}`
            : undefined
        }
      />
    );
  }

  if (row?.status === "confirmed") {
    return (
      <TurnBanner
        owner="done"
        title={`You confirmed this${row.response?.at ? ` on ${formatDateAtTime(row.response.at)}` : ""}.`}
      />
    );
  }

  if (row?.status === "changes_requested") {
    return (
      <>
        <TurnBanner
          owner="rupert"
          title={waitingTitle ?? "Rupert is working on your feedback."}
          detail={waitingDetail ?? "We'll email you when the updated version is ready."}
        />
        {row.response?.note ? (
          <section className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
            <p className="text-label uppercase tracking-label text-muted">
              What you sent{row.response.at ? ` · ${formatDateAtTime(row.response.at)}` : ""}
            </p>
            <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">
              {row.response.note}
            </p>
          </section>
        ) : null}
      </>
    );
  }

  return (
    <TurnBanner
      owner="rupert"
      title={item.detail}
      detail="We'll email you as soon as it's ready for you."
    />
  );
}
