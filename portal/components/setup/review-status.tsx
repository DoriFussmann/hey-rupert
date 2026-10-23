import { CollapsiblePanel } from "@/components/setup/collapsible-panel";
import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDateAtTime } from "@/lib/format";
import type { SetupItem, SetupStepState } from "@/lib/setup";

/** The one turn banner on a review step (framing, investor list, email copy). */
export function ReviewStatus({
  item,
  row,
  clientTitle,
  waitingTitle,
  waitingDetail,
}: {
  item: SetupItem | null;
  row: SetupStepState | null;
  /** What the client is asked to do while it is their turn. */
  clientTitle?: string;
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
        title={clientTitle ?? item.detail}
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
          <div className="mb-lg">
            <CollapsiblePanel
              title="What You Sent"
              meta={row.response.at ? `Sent ${formatDateAtTime(row.response.at)}` : undefined}
            >
              <p className="whitespace-pre-wrap text-body-sm text-body">{row.response.note}</p>
            </CollapsiblePanel>
          </div>
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
