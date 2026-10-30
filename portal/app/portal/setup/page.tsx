import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Checklist } from "@/components/checklist";
import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDate } from "@/lib/format";
import { getPortalSetup } from "@/lib/portal-setup";
import { SETUP_TOTAL, isSetupOpen } from "@/lib/setup";

export default async function SetupPage() {
  const { client, items } = await getPortalSetup();
  const open = isSetupOpen(client?.stage);
  const complete = items.filter((item) => item.status === "done").length;
  const yourTurn = items.find((item) => item.status === "your_turn");
  const rupertsTurn = items.find((item) => item.status === "waiting");

  return (
    <>
      <PageHeader
        title="Setup"
        description={
          open
            ? `${complete} of ${SETUP_TOTAL} complete. Rupert writes, you confirm.`
            : "Opens once your Client Intake is complete."
        }
      />

      {!open ? null : yourTurn ? (
        <TurnBanner
          owner="client"
          title={yourTurn.title}
          detail={yourTurn.detail}
          href={yourTurn.href}
          cta="Review now"
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
          detail="Rupert will follow up shortly to launch your campaign."
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
            item.status === "your_turn" || item.visible,
          dimmed: item.status === "open",
        }))}
      />

      {open ? (
        <p className="mt-lg text-body-sm text-muted">
          Have an updated deck or something new?{" "}
          <Link
            href="/portal/what-rupert-knows?open=files#files"
            className="text-primary no-underline hover:text-primary-hover"
          >
            Add it to your company files
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
