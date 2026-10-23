import { SETUP_FEE_LABEL, isKickoffReady } from "./service-order.ts";

export type OnboardingTimestamps = {
  sow_confirmed_at?: string | null;
  service_order_content?: string | null;
  service_order_agreed_at?: string | null;
  setup_invoice_url?: string | null;
  payment_received_at?: string | null;
  nda_sent_at?: string | null;
  nda_signed_at?: string | null;
  intake_completed_at?: string | null;
};

/** Enough of a setup row to know whether Company Materials is submitted. */
export type MaterialsStepSnapshot = {
  step: string;
  status: string;
  version: number;
  completed_at: string | null;
};

export type OnboardingSource = OnboardingTimestamps & {
  setup_steps?: MaterialsStepSnapshot[] | null;
};

/**
 * Whose turn a step is:
 * - "your_turn": the client's (shown to the client as "Your turn")
 * - "waiting":   Rupert's (shown to the client as "Waiting on Rupert")
 * - "done" / "open" (not reachable yet)
 */
export type OnboardingStatus = "done" | "your_turn" | "waiting" | "open";

export type OnboardingItemId =
  | "sow"
  | "service_order"
  | "payment"
  | "nda"
  | "intake";

export type OnboardingItem = {
  id: OnboardingItemId;
  title: string;
  detail: string;
  href?: string;
  status: OnboardingStatus;
  completedAt: string | null;
};

/**
 * One definition per step: how it is named for the client, what the admin
 * has to do when it is Rupert's turn, and the short label used in
 * "Waiting on client: …". Every screen and email reads from here.
 */
export const ONBOARDING_STEPS: Record<
  OnboardingItemId,
  { title: string; short: string; adminAction: string }
> = {
  sow: {
    title: "Statement of Work",
    short: "Statement of Work",
    adminAction: "Send Statement of Work",
  },
  service_order: {
    title: "Service Order",
    short: "Service Order",
    adminAction: "Issue Service Order",
  },
  payment: {
    title: "Setup Fee",
    short: "Setup Fee",
    adminAction: "Issue Setup Fee invoice",
  },
  nda: { title: "NDA", short: "NDA", adminAction: "Issue NDA" },
  intake: {
    title: "Client Intake",
    short: "Client Intake",
    adminAction: "Review Client Intake",
  },
};

export const ONBOARDING_TOTAL = Object.keys(ONBOARDING_STEPS).length;

export const SERVICE_ORDER_HREF = "/portal/service-order";
export const SETUP_FEE_HREF = "/portal/service-order#setup-fee";
export const NDA_HREF = "/portal/nda";
export const INTAKE_HREF = "/portal/intake";
export const MATERIALS_HREF = "/portal/materials";

/**
 * Company Materials, as part of the intake. New clients share them inside
 * the intake, and they are submitted when it completes. A client whose
 * intake completed before that (or whose materials Rupert sent back) still
 * submits them on the Company Materials page.
 */
export function materialsStatus(source: OnboardingSource | null | undefined): {
  status: OnboardingStatus;
  detail: string;
  completedAt: string | null;
} {
  const intakeAt = source?.intake_completed_at ?? null;
  const row = source?.setup_steps?.find((entry) => entry.step === "materials") ?? null;
  if (row?.status === "submitted") {
    return { status: "done", detail: "Submitted", completedAt: row.completed_at };
  }
  if (!intakeAt) {
    return { status: "open", detail: "Shared in the Client Intake", completedAt: null };
  }
  return {
    status: "your_turn",
    detail:
      row && row.version > 0
        ? "Rupert asked for a few more things"
        : "Share your deck and materials",
    completedAt: null,
  };
}

/**
 * Client onboarding, in order:
 * SoW → Service Order + Setup Fee (either order) → kick-off → NDA →
 * Intake (with the company materials). Onboarding ends when the client has
 * given Rupert everything. Setup starts when the intake completes.
 */
export function getOnboardingItems(
  source: OnboardingSource | null | undefined,
): OnboardingItem[] {
  const sowAt = source?.sow_confirmed_at ?? null;
  const orderAt = source?.service_order_agreed_at ?? null;
  const paymentAt = source?.payment_received_at ?? null;
  const ndaAt = source?.nda_signed_at ?? null;
  const intakeAt = source?.intake_completed_at ?? null;
  const materials = materialsStatus(source);

  const sowDone = Boolean(sowAt);
  const orderIssued = Boolean(source?.service_order_content?.trim());
  const invoiceIssued = Boolean(source?.setup_invoice_url?.trim());
  const ndaIssued = Boolean(source?.nda_sent_at);
  const kickedOff = isKickoffReady({
    service_order_agreed_at: orderAt,
    payment_received_at: paymentAt,
  });

  const item = (
    id: OnboardingItemId,
    fields: Omit<OnboardingItem, "id" | "title">,
  ): OnboardingItem => ({ id, title: ONBOARDING_STEPS[id].title, ...fields });

  return [
    item("sow", {
      detail: sowDone ? "Confirmed" : "Review and confirm",
      href: "/portal/statement-of-work",
      status: sowDone ? "done" : "your_turn",
      completedAt: sowAt,
    }),
    item("service_order", {
      detail: orderAt
        ? "Signed"
        : orderIssued
          ? "Review and sign"
          : "Rupert will issue",
      href: orderAt || orderIssued ? SERVICE_ORDER_HREF : undefined,
      status: orderAt
        ? "done"
        : sowDone && orderIssued
          ? "your_turn"
          : sowDone
            ? "waiting"
            : "open",
      completedAt: orderAt,
    }),
    item("payment", {
      detail: paymentAt
        ? "Paid"
        : invoiceIssued
          ? `Pay the ${SETUP_FEE_LABEL} setup invoice`
          : "Rupert will issue",
      href: invoiceIssued ? SETUP_FEE_HREF : undefined,
      status: paymentAt
        ? "done"
        : sowDone && invoiceIssued
          ? "your_turn"
          : sowDone
            ? "waiting"
            : "open",
      completedAt: paymentAt,
    }),
    item("nda", {
      detail: ndaAt
        ? "Signed"
        : kickedOff && ndaIssued
          ? "Review and sign"
          : kickedOff
            ? "Rupert is preparing your NDA"
            : "After the Service Order and Setup Fee",
      href: ndaAt || (kickedOff && ndaIssued) ? NDA_HREF : undefined,
      status: ndaAt
        ? "done"
        : kickedOff && ndaIssued
          ? "your_turn"
          : kickedOff
            ? "waiting"
            : "open",
      completedAt: ndaAt,
    }),
    // Done once the intake and the materials are both with Rupert. An intake
    // completed without them sends the client to Company Materials.
    intakeAt && materials.status !== "done"
      ? item("intake", {
          detail: materials.detail,
          href: MATERIALS_HREF,
          status: "your_turn",
          completedAt: null,
        })
      : item("intake", {
          detail: intakeAt
            ? "Completed"
            : kickedOff && ndaAt
              ? "A short interview with Rupert, with your deck"
              : "After the NDA",
          href: intakeAt || (kickedOff && ndaAt) ? INTAKE_HREF : undefined,
          status: intakeAt ? "done" : kickedOff && ndaAt ? "your_turn" : "open",
          completedAt: intakeAt ? latestOf(intakeAt, materials.completedAt) : null,
        }),
  ];
}

function latestOf(a: string, b: string | null) {
  return b && Date.parse(b) > Date.parse(a) ? b : a;
}

export function onboardingProgress(
  source: OnboardingSource | null | undefined,
) {
  const complete = getOnboardingItems(source).filter(
    (entry) => entry.status === "done",
  ).length;
  return { complete, total: ONBOARDING_TOTAL };
}
