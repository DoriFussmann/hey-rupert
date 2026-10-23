// Engagement timeline: key milestones per client, counted in days from
// kick-off (Day 1 = the day both the Service Order is signed and the Setup
// Fee is paid). Days are calendar days in Rupert's time zone. Pure module.

import { kickoffDate } from "@/lib/service-order";
import { getSetupItems, type SetupStepId, type SetupStepState } from "@/lib/setup";

export const TIMELINE_TIME_ZONE = "America/Los_Angeles";

export type TimelineSource = {
  stage?: string | null;
  sow_confirmed_at?: string | null;
  service_order_agreed_at?: string | null;
  payment_received_at?: string | null;
  nda_sent_at?: string | null;
  nda_signed_at?: string | null;
  intake_completed_at?: string | null;
  live_at?: string | null;
  setup_steps?: SetupStepState[] | null;
};

export type MilestoneId =
  | "sow_confirmed"
  | "service_order_signed"
  | "setup_fee_paid"
  | "nda_sent"
  | "nda_signed"
  | "intake_completed"
  // Feedback is no longer a step of its own: it goes with the narrative.
  | Exclude<SetupStepId, "deck_review">
  | "live";

export const MILESTONES: { id: MilestoneId; label: string; short: string }[] = [
  { id: "sow_confirmed", label: "Statement of Work confirmed", short: "SoW" },
  { id: "service_order_signed", label: "Service Order signed", short: "Service Order" },
  { id: "setup_fee_paid", label: "Setup Fee paid", short: "Fee paid" },
  { id: "nda_sent", label: "NDA sent", short: "NDA sent" },
  { id: "nda_signed", label: "NDA signed", short: "NDA signed" },
  { id: "intake_completed", label: "Intake completed", short: "Intake" },
  { id: "materials", label: "Materials submitted", short: "Materials" },
  { id: "framing", label: "Outreach narrative confirmed", short: "Narrative" },
  { id: "investor_list", label: "Investor list confirmed", short: "Investors" },
  { id: "email_copy", label: "Email copy confirmed", short: "Email copy" },
  { id: "live", label: "Went live", short: "Live" },
];

/** Milestones that follow kick-off (the columns of the all-clients view). */
export const POST_KICKOFF_MILESTONES = MILESTONES.filter(
  (milestone) =>
    milestone.id !== "sow_confirmed" &&
    milestone.id !== "service_order_signed" &&
    milestone.id !== "setup_fee_paid",
);

export type Milestone = {
  id: MilestoneId;
  label: string;
  short: string;
  /** When it happened; null when it has not happened (or is not recorded). */
  at: string | null;
  /** Day number from kick-off; null before kick-off or when not happened. */
  day: number | null;
  /** Happened before Day 1. */
  preKickoff: boolean;
  /** Happened, but the date was not recorded (clients live before tracking). */
  dateUnknown: boolean;
};

export type Timeline = {
  kickoffAt: string | null;
  /** Today's day number; null before kick-off. */
  today: number | null;
  milestones: Milestone[];
};

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMELINE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Days since 1970-01-01 of the calendar date in Rupert's time zone. */
function calendarDay(iso: string | Date) {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Math.round(
    Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000,
  );
}

/** "Day N" number of `at` relative to kick-off: kick-off day is Day 1. */
export function dayNumber(at: string | Date, kickoffAt: string) {
  const day = calendarDay(at);
  const start = calendarDay(kickoffAt);
  if (day === null || start === null) return null;
  return day - start + 1;
}

export function buildTimeline(
  source: TimelineSource,
  now: Date = new Date(),
): Timeline {
  const kickoffAt = kickoffDate({
    service_order_agreed_at: source.service_order_agreed_at ?? null,
    payment_received_at: source.payment_received_at ?? null,
  });

  const materialsRow =
    source.setup_steps?.find((row) => row.step === "materials") ?? null;
  const materialsSubmitted = materialsRow?.status === "submitted";

  const setupDone = new Map<string, string | null>();
  for (const item of getSetupItems({
    stage: source.stage ?? null,
    intake_completed_at: source.intake_completed_at ?? null,
    setup_steps: source.setup_steps ?? [],
  })) {
    if (item.status === "done") setupDone.set(item.id, item.completedAt);
  }

  const isLive = source.stage === "live";
  const dates: Record<MilestoneId, string | null> = {
    sow_confirmed: source.sow_confirmed_at ?? null,
    service_order_signed: source.service_order_agreed_at ?? null,
    setup_fee_paid: source.payment_received_at ?? null,
    nda_sent: source.nda_sent_at ?? null,
    nda_signed: source.nda_signed_at ?? null,
    intake_completed: source.intake_completed_at ?? null,
    materials: materialsSubmitted ? (materialsRow?.completed_at ?? null) : null,
    framing: setupDone.get("framing") ?? null,
    investor_list: setupDone.get("investor_list") ?? null,
    email_copy: setupDone.get("email_copy") ?? null,
    live: source.live_at ?? null,
  };

  const milestones = MILESTONES.map((milestone) => {
    const at = dates[milestone.id];
    const day = at && kickoffAt ? dayNumber(at, kickoffAt) : null;
    return {
      ...milestone,
      at,
      day: day !== null && day >= 1 ? day : null,
      preKickoff: Boolean(at) && (!kickoffAt || (day !== null && day < 1)),
      dateUnknown:
        !at &&
        ((milestone.id === "live" && isLive) ||
          (milestone.id === "materials" &&
            materialsSubmitted &&
            !materialsRow?.completed_at) ||
          (setupDone.has(milestone.id) && !setupDone.get(milestone.id))),
    };
  });

  return {
    kickoffAt,
    today: kickoffAt ? dayNumber(now, kickoffAt) : null,
    milestones,
  };
}

/** Short cell text: "Day 4", "Pre-kick-off", "Done (no date)" or "—". */
export function milestoneText(milestone: Milestone) {
  if (milestone.day !== null) return `Day ${milestone.day}`;
  if (milestone.preKickoff) return "Pre-kick-off";
  if (milestone.dateUnknown) return "Done (no date)";
  return "—";
}
