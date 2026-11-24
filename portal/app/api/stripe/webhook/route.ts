import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { sendAdminEmail } from "@/lib/email";
import { isServiceRoleConfigured } from "@/lib/env";
import { advanceToKickoff } from "@/lib/kickoff";
import { notifyAdmin } from "@/lib/notify";
import { PORTAL_URL } from "@/lib/portal-url";
import { matchSetupFee } from "@/lib/stripe-match";
import {
  readPaidInvoice,
  verifyStripeSignature,
  type PaidInvoice,
} from "@/lib/stripe-webhook";
import { createServiceClient } from "@/lib/supabase/admin";
import { recordCampaignInvoicePayment } from "@/lib/outreach/live-server";

export const dynamic = "force-dynamic";

type ServiceClient = ReturnType<typeof createServiceClient>;

type CandidateClient = {
  id: string;
  email: string | null;
  setup_invoice_url: string | null;
  payment_received_at: string | null;
};

function formatAmount(invoice: PaidInvoice) {
  if (invoice.amountPaid === null) return "unknown amount";
  const currency = (invoice.currency ?? "").toUpperCase();
  return `${(invoice.amountPaid / 100).toFixed(2)} ${currency}`.trim();
}

/**
 * Finds the client whose Setup Fee this invoice pays: by the invoice's
 * metadata, then its link, then the payer's email (lib/stripe-match.ts).
 */
function matchClient(candidates: CandidateClient[], invoice: PaidInvoice) {
  return matchSetupFee(candidates, invoice);
}

async function recordSetupFeePayment(
  supabase: ServiceClient,
  invoice: PaidInvoice,
): Promise<"recorded" | "already_paid" | "unmatched" | "error"> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, email, setup_invoice_url, payment_received_at")
    .not("setup_invoice_url", "is", null);

  if (error) {
    console.error(`Stripe webhook: client lookup failed: ${error.message}`);
    return "error";
  }

  const match = matchClient((data ?? []) as CandidateClient[], invoice);

  if (!match) {
    await sendAdminEmail(
      "Stripe payment received — not matched to a client",
      [
        "A Stripe invoice was paid, but it does not match any client's unpaid Setup Fee or first monthly invoice (by the invoice's portal tags, its link, or the payer's email), so nothing was changed in the portal.",
        `Invoice: ${invoice.number ?? invoice.id}`,
        `Payer: ${invoice.customerEmail ?? "unknown"}`,
        `Amount: ${formatAmount(invoice)}`,
        `If it was one of them, mark it paid on the client's page (Setup Fee: Service Order; monthly: Go Live panel): ${PORTAL_URL}/admin`,
      ].join("\n\n"),
    );
    return "unmatched";
  }

  if (match.payment_received_at) return "already_paid";

  const { data: updated, error: updateError } = await supabase
    .from("clients")
    .update({ payment_received_at: new Date().toISOString() })
    .eq("id", match.id)
    .is("payment_received_at", null)
    .select("id");

  if (updateError) {
    console.error(
      `Stripe webhook: payment update failed: ${updateError.message}`,
    );
    return "error";
  }
  if (!updated || updated.length === 0) return "already_paid";

  // Kick-off first, so the admin email reports the up-to-date next step.
  await advanceToKickoff(supabase, match.id);
  await notifyAdmin(supabase, match.id, "setup_fee_paid", { email: true });

  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/clients/${match.id}`);
  revalidatePath("/portal", "layout");
  return "recorded";
}

// Stripe → "invoice.paid". Marks the matching client's Setup Fee as paid.
// Responds 2xx for anything handled or ignored; 5xx only when a retry by
// Stripe could succeed.
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !isServiceRoleConfigured()) {
    return NextResponse.json(
      { error: "Stripe webhook is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (
    !verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      secret,
    )
  ) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const invoice = readPaidInvoice(event);
  if (!invoice) {
    return NextResponse.json({ received: true, ignored: true });
  }

  // The first monthly invoice (Go Live gate) is matched by its link first.
  const supabase = createServiceClient();
  const campaign = await recordCampaignInvoicePayment(supabase, invoice);
  if (campaign === "error") {
    return NextResponse.json({ error: "Temporary failure." }, { status: 500 });
  }
  if (campaign !== "unmatched") {
    revalidatePath("/portal", "layout");
    return NextResponse.json({ received: true, outcome: `campaign_invoice_${campaign}` });
  }

  const outcome = await recordSetupFeePayment(supabase, invoice);
  if (outcome === "error") {
    return NextResponse.json({ error: "Temporary failure." }, { status: 500 });
  }

  return NextResponse.json({ received: true, outcome });
}
