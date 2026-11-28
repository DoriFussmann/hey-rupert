import "server-only";
import { sendAdminEmail } from "@/lib/email";
import { findEmail, isHunterConfigured, verifyEmail } from "@/lib/hunter";
import { emailKey, type CheckSteps } from "@/lib/match/verify";
import { emailsHash } from "@/lib/outreach/core";
import type { OutreachMessageView } from "@/lib/outreach/core-server";
import { bounceComment, domainOf, passedOnWebOnly, splitName, usableNewAddress, type BounceRecord } from "@/lib/outreach/bounce";
import { PORTAL_URL } from "@/lib/portal-url";
import type { createServiceClient } from "@/lib/supabase/admin";

type ServiceClient = ReturnType<typeof createServiceClient>;

function writtenFor(message: OutreachMessageView) {
  return message.emails.some((e) => e.body.trim()) && !message.emails.some((e) => /\{\{[^}]*\}\}/.test(`${e.subject}\n${e.body}`));
}

async function storedSteps(supabase: ServiceClient, firmId: string, email: string): Promise<CheckSteps | null> {
  const { data } = await supabase
    .from("contact_checks")
    .select("steps, email")
    .eq("firm_id", firmId)
    .eq("email_key", emailKey(email))
    .maybeSingle<{ steps: CheckSteps | null }>();
  if (data) return data.steps ?? null;
  const { data: byEmail } = await supabase.from("contact_checks").select("steps").eq("firm_id", firmId).ilike("email", email.trim()).limit(1);
  return ((byEmail?.[0] as { steps?: CheckSteps } | undefined)?.steps ?? null) as CheckSteps | null;
}

/** Hunter's address for the person at the fund's domain, when it is a different one Hunter rates valid. */
async function hunterAddress(message: OutreachMessageView): Promise<{ email: string; note: string } | { email: null; note: string }> {
  if (!isHunterConfigured()) return { email: null, note: "Hunter is not set up." };
  const bounced = message.person.email.trim();
  const { first, last } = splitName(message.person.name, message.person.first_name);
  const found = await findEmail({ domain: domainOf(bounced), firstName: first, lastName: last });
  if (!found.ok) return { email: null, note: `Hunter failed: ${found.reason}` };
  if (!found.value) return { email: null, note: "Hunter found no address for this person." };
  if (found.value.email.trim().toLowerCase() === bounced.toLowerCase()) return { email: null, note: "Hunter has the same address that bounced." };
  const verified = await verifyEmail(found.value.email);
  const status = verified.ok ? verified.value.status : null;
  if (!usableNewAddress(bounced, found.value.email, status)) {
    return { email: null, note: `Hunter suggested ${found.value.email}, but rates it ${status ?? "unknown"}.` };
  }
  return { email: found.value.email.trim(), note: `Hunter found ${found.value.email} and rates it valid.` };
}

/** The next contact at the same fund takes the bounced one's place (checked before it is added, as always). */
async function promoteReserve(supabase: ServiceClient, bounced: OutreachMessageView, messages: OutreachMessageView[]): Promise<string | null> {
  const reserve = messages
    .filter((m) => m.firm_id === bounced.firm_id && m.slot === "reserve" && m.send_check !== "fail" && !m.pushed_at && writtenFor(m))
    .sort((a, b) => a.position - b.position)[0];
  if (!reserve) return null;
  const { error } = await supabase
    .from("outreach_messages")
    .update({
      slot: "active",
      status: "approved",
      approved_by: `replacement for ${bounced.person.name} (bounced)`,
      approved_at: new Date().toISOString(),
      approved_hash: emailsHash(reserve.emails),
      replaces_message_id: bounced.id,
    })
    .eq("id", reserve.id);
  return error ? null : reserve.person.name;
}

/**
 * After an email bounces (the Instantly webhook): passed on the web search alone → Hunter gets one
 * try, and a different valid address goes back in line for the next batch (the fund database is
 * corrected too). Otherwise the contact is removed for good (flagged in the fund database), and the
 * next contact at the same fund takes its place. Runs once per contact. Best effort: a failure here
 * leaves the bounce recorded, as before.
 */
export async function recoverBounce(
  supabase: ServiceClient,
  clientId: string,
  message: OutreachMessageView & { bounce?: BounceRecord | null },
  messages: OutreachMessageView[],
  at: string,
): Promise<BounceRecord | null> {
  if (message.bounce) return null;
  const bounced = message.person.email.trim();
  const steps = await storedSteps(supabase, message.firm_id, bounced);
  const tryHunter = passedOnWebOnly(steps);
  const found = tryHunter ? await hunterAddress(message) : { email: null, note: "It had passed Hunter's check, so there is nothing more to try." };

  let record: BounceRecord;
  const now = new Date().toISOString();
  if (found.email) {
    record = { email: bounced, at, action: "new_address", new_email: found.email, note: found.note };
    const { error } = await supabase
      .from("outreach_messages")
      .update({
        person: { ...message.person, email: found.email },
        bounce: record,
        pushed_at: null,
        instantly_lead_id: null,
        sent_at: null,
        last_step: null,
        opened_at: null,
        bounced_at: null,
        send_check: "pass",
        send_check_at: now,
        send_check_note: `New address after a bounce: ${found.note}`,
      })
      .eq("id", message.id);
    if (error) return null;
    // The fund database: the person's address for every client from now on.
    await supabase.from("contact_corrections").upsert(
      {
        firm_id: message.firm_id,
        email_key: emailKey(bounced),
        firm_name: message.fund_name,
        person_name: message.person.name,
        email: found.email,
        note: `Bounced ${at.slice(0, 10)}; ${found.note}`,
        from_client: clientId,
        updated_by: "bounce",
        updated_at: now,
      },
      { onConflict: "firm_id,email_key" },
    );
  } else {
    const replacedBy = await promoteReserve(supabase, message, messages);
    record = { email: bounced, at, action: "removed", ...(replacedBy ? { replaced_by: replacedBy } : {}), note: found.note };
    await supabase.from("outreach_messages").update({ bounce: record }).eq("id", message.id);
    await supabase.from("contact_corrections").upsert(
      {
        firm_id: message.firm_id,
        email_key: emailKey(bounced),
        firm_name: message.fund_name,
        person_name: message.person.name,
        flag: "removed",
        flag_reason: `Bounced ${at.slice(0, 10)}. ${found.note}`.slice(0, 500),
        from_client: clientId,
        updated_by: "bounce",
        updated_at: now,
      },
      { onConflict: "firm_id,email_key" },
    );
  }

  await sendAdminEmail(
    `Bounce: ${message.person.name} (${message.fund_name})`,
    [
      `${message.person.name} <${bounced}> at ${message.fund_name} bounced.`,
      `${tryHunter ? "It had passed on the web search alone, so Hunter got a try." : "It had passed Hunter's check."} ${found.note}`,
      bounceComment(record),
      `Analytics: ${PORTAL_URL}/admin/clients/${clientId}/analytics#who-we-sent-to`,
    ].join("\n\n"),
  ).catch(() => undefined);
  return record;
}
