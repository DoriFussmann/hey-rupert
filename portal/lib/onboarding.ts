import { SETUP_FEE_LABEL, isKickoffReady } from "@/lib/service-order";

export type OnboardingTimestamps = {
  sow_confirmed_at?: string | null;
  service_order_content?: string | null;
  service_order_agreed_at?: string | null;
  setup_invoice_url?: string | null;
  payment_received_at?: string | null;
  nda_signed_at?: string | null;
  intake_completed_at?: string | null;
};

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

export const ONBOARDING_TOTAL = 5;

export const SERVICE_ORDER_HREF = "/portal/service-order";
export const SETUP_FEE_HREF = "/portal/service-order#setup-fee";

/**
 * Client onboarding, in order:
 * SoW → Service Order + Setup Fee (either order) → kick-off → NDA → Intake.
 */
export function getOnboardingItems(
  source: OnboardingTimestamps | null | undefined,
): OnboardingItem[] {
  const sowAt = source?.sow_confirmed_at ?? null;
  const orderAt = source?.service_order_agreed_at ?? null;
  const paymentAt = source?.payment_received_at ?? null;
  const ndaAt = source?.nda_signed_at ?? null;
  const intakeAt = source?.intake_completed_at ?? null;

  const sowDone = Boolean(sowAt);
  const orderIssued = Boolean(source?.service_order_content?.trim());
  const invoiceIssued = Boolean(source?.setup_invoice_url?.trim());
  const kickedOff = isKickoffReady({
    service_order_agreed_at: orderAt,
    payment_received_at: paymentAt,
  });

  return [
    {
      id: "sow",
      title: "Statement of Work",
      detail: sowDone ? "Confirmed" : "Review and confirm",
      href: "/portal/statement-of-work",
      status: sowDone ? "done" : "your_turn",
      completedAt: sowAt,
    },
    {
      id: "service_order",
      title: "Service Order",
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
    },
    {
      id: "payment",
      title: "Setup Fee",
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
    },
    {
      id: "nda",
      title: "NDA",
      detail: ndaAt
        ? "Signed"
        : kickedOff
          ? "Rupert is preparing your NDA"
          : "After the Service Order and Setup Fee",
      status: ndaAt ? "done" : kickedOff ? "waiting" : "open",
      completedAt: ndaAt,
    },
    {
      id: "intake",
      title: "Client Intake Form",
      detail: intakeAt
        ? "Completed"
        : kickedOff && ndaAt
          ? "Rupert will send the intake form"
          : "After the NDA",
      status: intakeAt ? "done" : kickedOff && ndaAt ? "waiting" : "open",
      completedAt: intakeAt,
    },
  ];
}

export function onboardingProgress(
  source: OnboardingTimestamps | null | undefined,
) {
  const complete = getOnboardingItems(source).filter(
    (item) => item.status === "done",
  ).length;
  return { complete, total: ONBOARDING_TOTAL };
}
