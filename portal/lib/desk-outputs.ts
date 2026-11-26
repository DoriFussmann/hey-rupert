import type { SetupStepState } from "@/lib/setup";

/**
 * Pages of a client's portal Rupert can share on the Desk: only what has
 * already been published to them.
 */
export function portalOutputs(rows: SetupStepState[] | undefined, intakeDone: boolean) {
  const sent = (step: string) => (rows ?? []).some((row) => row.step === step && row.version > 0);
  return [
    sent("framing") ? { label: "Outreach Narrative", url: "/portal/setup/framing" } : null,
    sent("investor_list") ? { label: "Investor List", url: "/portal/setup/investor-list" } : null,
    sent("email_copy") ? { label: "Email Copy", url: "/portal/setup/email-copy" } : null,
    intakeDone ? { label: "What Rupert Knows", url: "/portal/what-rupert-knows" } : null,
  ].filter((output): output is { label: string; url: string } => output !== null);
}
