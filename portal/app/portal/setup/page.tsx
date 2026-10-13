import { PageHeader } from "@/components/page-header";
import { Checklist } from "@/components/checklist";
import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDate } from "@/lib/format";
import { getPortalSetup } from "@/lib/portal-setup";
import { SETUP_TOTAL, isSetupOpen } from "@/lib/setup";

export default async function SetupPage() {
  const { client, items } = await getPortalSetup();
  const open = isSetupOpen(client?.stage) || Boolean(client?.intake_completed_at);
  const complete = items.filter((item) => item.status === "done").length;
  const yourTurn = items.find((item) => item.status === "your_turn");
  const rupertsTurn = items.find((item) => item.status === "waiting");

  return (
    <>
      <PageHeader
        title="Setup"
        description={
          open
            ? `${complete} of ${SETUP_TOTAL} complete. We prepare your campaign together: you share your materials, Rupert writes, you confirm.`
            : "Opens once your Client Intake is complete."
        }
      />

      {!open ? null : yourTurn ? (
        <TurnBanner
          owner="client"
          title={yourTurn.title}
          detail={yourTurn.detail}
          href={yourTurn.href}
          cta={yourTurn.id === "materials" ? "Share materials" : "Review now"}
        />
      ) : rupertsTurn ? (
        <TurnBanner
          owner="rupert"
          title={rupertsTurn.detail}
          detail="Nothing for you to do right now. We'll email you as soon as it's your turn."
        />
      ) : complete === SETUP_TOTAL ? (
        <TurnBanner
          owner="done"
          title="Setup is complete."
          detail="Rupert will send your first monthly invoice. Your campaign launches once it is paid."
        />
      ) : null}

      <Checklist
        items={items.map((item) => ({
          id: item.id,
          title: item.title,
          detail:
            item.status === "done" && item.completedAt
              ? `${item.detail} · ${formatDate(item.completedAt)}`
              : item.detail,
          href: item.href,
          status: item.status,
          clickable:
            item.status === "your_turn" ||
            item.visible ||
            (item.id === "materials" && item.status === "done"),
          dimmed: item.status === "open",
        }))}
      />
    </>
  );
}
