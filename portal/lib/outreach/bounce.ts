// After a bounce: what Rupert does with the contact. Pure module (bounce-server.ts acts on it).
//
// A contact passed by the web search alone (a page showed the address; Hunter never ran) gets one
// more try: Hunter looks the person up at the fund's domain, and a different address Hunter rates
// valid goes back in line for the next batch. Anything else is removed for good, and the next
// contact at the same fund takes its place.

import type { CheckSteps } from "../match/verify.ts";

export type BounceRecord = {
  /** The address that bounced. */
  email: string;
  at: string;
  action: "new_address" | "removed";
  new_email?: string;
  replaced_by?: string;
  note: string;
};

/** Whether the bounced address had passed on the web search alone, so Hunter gets a try. */
export function passedOnWebOnly(steps: CheckSteps | null | undefined) {
  return Boolean(steps?.public?.result === "found" && !steps.mailbox);
}

const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof|sir)\.?\s+/i;

/** First and last name for Hunter's finder, without "Mr." and the like. */
export function splitName(name: string, firstName?: string | null): { first: string; last: string } {
  const parts = name.replace(HONORIFIC, "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const first = (firstName ?? "").replace(HONORIFIC, "").trim() || parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1].replace(/[.,]$/, "") : "";
  return { first, last };
}

/** The domain an address is at. */
export function domainOf(email: string) {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/** A Hunter result worth sending to again: a different address Hunter's verifier rates valid. */
export function usableNewAddress(bounced: string, found: string | null, status: string | null) {
  if (!found) return false;
  if (found.trim().toLowerCase() === bounced.trim().toLowerCase()) return false;
  return status === "valid";
}

/** The Comments cell for a bounced contact (analytics). */
export function bounceComment(bounce: BounceRecord | null | undefined) {
  if (!bounce) return "";
  if (bounce.action === "new_address") return `New address found (${bounce.new_email}); back in the next batch.`;
  return bounce.replaced_by ? `Removed. Replaced by ${bounce.replaced_by}.` : "Removed. No other contact at this fund.";
}
