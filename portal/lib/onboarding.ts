export type OnboardingTimestamps = {
  sow_confirmed_at?: string | null;
  service_order_agreed_at?: string | null;
  nda_signed_at?: string | null;
  intake_completed_at?: string | null;
  payment_received_at?: string | null;
};

export type OnboardingStatus = "done" | "your_turn" | "waiting" | "open";

export type OnboardingItem = {
  id: "sow" | "service_order" | "nda" | "intake" | "payment";
  title: string;
  detail: string;
  href?: string;
  status: OnboardingStatus;
  completedAt: string | null;
};

export const ONBOARDING_TOTAL = 5;

export function getOnboardingItems(
  timestamps: OnboardingTimestamps | null | undefined,
): OnboardingItem[] {
  const sowAt = timestamps?.sow_confirmed_at ?? null;
  const orderAt = timestamps?.service_order_agreed_at ?? null;
  const ndaAt = timestamps?.nda_signed_at ?? null;
  const intakeAt = timestamps?.intake_completed_at ?? null;
  const paymentAt = timestamps?.payment_received_at ?? null;

  const sowDone = Boolean(sowAt);
  const orderDone = Boolean(orderAt);
  const ndaDone = Boolean(ndaAt);
  const intakeDone = Boolean(intakeAt);
  const paymentDone = Boolean(paymentAt);

  return [
    {
      id: "sow",
      title: "Statement of Work",
      detail: "Confirmed",
      href: "/portal/statement-of-work",
      status: sowDone ? "done" : "your_turn",
      completedAt: sowAt,
    },
    {
      id: "service_order",
      title: "Service Order",
      detail: "Signed",
      href: "/portal/service-order",
      status: orderDone
        ? "done"
        : sowDone
          ? "your_turn"
          : "open",
      completedAt: orderAt,
    },
    {
      id: "nda",
      title: "NDA",
      detail: "Mutually Signed",
      href: "/portal/nda",
      status: ndaDone
        ? "done"
        : sowDone && orderDone
          ? "your_turn"
          : "open",
      completedAt: ndaAt,
    },
    {
      id: "intake",
      title: "Client Intake Form",
      detail: "Completed",
      status: intakeDone
        ? "done"
        : sowDone && orderDone && ndaDone
          ? "waiting"
          : "open",
      completedAt: intakeAt,
    },
    {
      id: "payment",
      title: "Invoice & Setup Payment",
      detail: "Received",
      status: paymentDone
        ? "done"
        : sowDone && orderDone && ndaDone && intakeDone
          ? "waiting"
          : "open",
      completedAt: paymentAt,
    },
  ];
}

export function onboardingProgress(
  timestamps: OnboardingTimestamps | null | undefined,
) {
  const complete = getOnboardingItems(timestamps).filter(
    (item) => item.status === "done",
  ).length;
  return { complete, total: ONBOARDING_TOTAL };
}
