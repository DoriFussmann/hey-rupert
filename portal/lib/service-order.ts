// Service Order: default template, client-field merge and the rules shared by
// the admin generator, the client signing flow and onboarding progress.

/** Default Setup Fee, used only when a Service Order doesn't state its own. */
export const SETUP_FEE_LABEL = "$250";

/** Reads "**Setup Fee:** $200" (Service Order) or "**Setup Fee:** $200" (SOW). */
function feeAfter(content: string | null | undefined, label: string) {
  if (!content) return null;
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(\\$(?:[0-9][0-9,]*[0-9]|[0-9])(?:\\.[0-9]{2})?)`, "i");
  return content.match(pattern)?.[1] ?? null;
}

/** The Setup Fee this document states, e.g. "$200". */
export function setupFeeOf(content: string | null | undefined) {
  return feeAfter(content, "Setup Fee");
}

/** The Monthly Campaign Fee this document states, e.g. "$600". */
export function monthlyFeeOf(content: string | null | undefined) {
  return feeAfter(content, "Monthly Campaign Fee");
}

/** The Setup Fee to show the client: the document's own, else the default. */
export function setupFeeLabel(content: string | null | undefined) {
  return setupFeeOf(content) ?? SETUP_FEE_LABEL;
}

/** "$200" → 20000 cents. */
export function feeCents(label: string | null | undefined) {
  if (!label) return null;
  const value = Number(label.replace(/[$,]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export const RUPERT_SIGNATORY = {
  company: "The Night Ventures, LLC, d/b/a Hey Rupert",
  name: "Dori Fussmann",
  title: "Owner & CEO",
} as const;

export const CLIENT_TOKENS = {
  company_name: "[CLIENT_COMPANY_NAME]",
  signer_email: "[CLIENT_EMAIL]",
} as const;

export type ServiceOrderFields = {
  company_name: string;
  signer_name: string;
  signer_email: string;
  signer_title: string;
};

export const SERVICE_ORDER_FIELD_LABELS: Record<keyof ServiceOrderFields, string> =
  {
    company_name: "Company name",
    signer_name: "Signer name",
    signer_email: "Email",
    signer_title: "Title",
  };

const FIELD_MAX_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client-entered text is placed inside markdown, so markdown syntax is escaped
// and renders as the literal characters the client typed.
function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_{}[\]()<>#+!|~]/g, "\\$&");
}

/**
 * Fills the client tokens in a Service Order. Blank values are shown as a
 * bracketed label so an unsigned preview still reads clearly.
 */
export function mergeServiceOrder(
  content: string,
  fields: Partial<ServiceOrderFields>,
) {
  const company = fields.company_name?.trim();
  const email = fields.signer_email?.trim();

  return content
    .replaceAll(
      CLIENT_TOKENS.company_name,
      company ? escapeMarkdown(company) : "[Company name]",
    )
    .replaceAll(
      CLIENT_TOKENS.signer_email,
      email ? escapeMarkdown(email) : "[Email]",
    );
}

export type FieldErrors = Partial<Record<keyof ServiceOrderFields, string>>;

export function validateServiceOrderFields(
  fields: ServiceOrderFields,
): { ok: true; value: ServiceOrderFields } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const value = {} as ServiceOrderFields;

  for (const key of Object.keys(SERVICE_ORDER_FIELD_LABELS) as (keyof ServiceOrderFields)[]) {
    const trimmed = String(fields[key] ?? "").trim();
    const label = SERVICE_ORDER_FIELD_LABELS[key];
    if (!trimmed) {
      errors[key] = `${label} is required.`;
    } else if (trimmed.length > FIELD_MAX_LENGTH) {
      errors[key] = `${label} is too long.`;
    }
    value[key] = trimmed;
  }

  if (!errors.signer_email && !EMAIL_PATTERN.test(value.signer_email)) {
    errors.signer_email = "Enter a valid email address.";
  }

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, value };
}

export const STRIPE_INVOICE_LINK_ERROR =
  "Paste the Stripe invoice link (invoice.stripe.com/…). Payment links and checkout links aren't recognised when paid.";

/** Accepts a Stripe hosted invoice link. The webhook matches invoice.paid against this URL. */
export function isStripeInvoiceLink(value: string) {
  try {
    const url = new URL(value.trim());
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "invoice.stripe.com" &&
      url.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/** Kick-off happens once the Service Order is signed and the Setup Fee is paid. */
export function isKickoffReady(source: {
  service_order_agreed_at?: string | null;
  payment_received_at?: string | null;
}) {
  return Boolean(source.service_order_agreed_at && source.payment_received_at);
}

export function kickoffDate(source: {
  service_order_agreed_at?: string | null;
  payment_received_at?: string | null;
}) {
  if (!source.service_order_agreed_at || !source.payment_received_at) {
    return null;
  }
  return source.service_order_agreed_at > source.payment_received_at
    ? source.service_order_agreed_at
    : source.payment_received_at;
}

export const DEFAULT_SERVICE_ORDER = `# Hey Rupert - Service Order

This Service Order is a binding agreement between the parties below for a Hey Rupert investor outreach engagement. It becomes effective on the date of the last signature (the "Effective Date").

## Parties

**Provider:** The Night Ventures, LLC, a California limited liability company, doing business as Hey Rupert ("Rupert"), 230 Frankel Ln, Sebastopol, CA 95472.

**Client:** ${CLIENT_TOKENS.company_name} ("Client").

**Client notice email:** ${CLIENT_TOKENS.signer_email}

**Rupert notice email:** dori@thenightventures.com

## Commercial Summary

- **Setup Fee:** $250, one-time, non-refundable, due on signing
- **Setup Period:** Typically 2 to 4 weeks from Kick-off; extended by any Client delay
- **Monthly Campaign Fee:** $1,000 per Service Month, invoiced and paid in advance
- **First Monthly Invoice:** Issued with the Launch Confirmation when Setup is complete; confirming it and paying is the Client's decision to launch
- **Basic package:** One Client-approved inbox. Up to 15 emails per Business Day for the first 10 Business Days, then up to 30 per Business Day, including one follow-up per contact
- **Term:** Month-to-month after Launch
- **Cancellation by the Client:** Written notice at least 7 days before the next Renewal Date; effective at that Renewal Date
- **Ending by Rupert:** At any time by written notice; unused days of the current Service Month are refunded unless the ending is for cause
- **Refunds:** None otherwise. All fees are non-refundable
- **Payment method:** Stripe invoice with payment link
- **Data access after the engagement ends:** 30 days through the Rupert Client Portal after Launch; 14 days, fund names only, if the engagement ends before Launch
- **Disputes:** Binding arbitration, California law

If this summary conflicts with the sections below, the sections below control.

## 1. Agreement and Kick-off

1.1 **Entire agreement.** This Service Order, together with the Launch Confirmation once the Client confirms it, is the entire agreement between the parties for the services. It supersedes the Statement of Work and all prior proposals, emails and discussions. The Statement of Work is not part of this agreement.

1.2 **NDA.** The parties will sign a separate non-disclosure agreement (the "NDA") after this Service Order and before Client Intake. The NDA governs the Client's confidential information. Section 9.1 governs Rupert's proprietary information. If the NDA conflicts with this Service Order on any other subject, this Service Order controls.

1.3 **Kick-off.** Rupert's obligations begin on the date both of the following have occurred: (a) the Client has signed this Service Order, and (b) Rupert has received the Setup Fee in full ("Kick-off"). Rupert has no obligation to perform any work before Kick-off.

1.4 **Sequence.** After Kick-off: NDA, then Client Intake, then Setup, then Client approvals, then Launch Confirmation and First Monthly Invoice, then Launch on payment.

1.5 **Business Day.** A "Business Day" is Monday to Friday, excluding United States federal holidays.

## 2. Services

2.1 **Setup Services.** During Setup, Rupert will:

- review the Client's pitch deck and provide comments for the Client to implement;
- review and refine the Client's fundraising messaging and positioning;
- define the investor strategy by vertical, stage and geography;
- research and match relevant investors and funds;
- prepare the investor target list and available fund information;
- draft the outreach messaging and any variants.

2.2 **Campaign Services.** After Launch, Rupert will run the approved campaign from the Approved Inbox under the Sending Plan in Section 4, monitor it, and give the Client access to campaign analytics and investor communications through the Rupert Client Portal.

2.3 **Investor handoff.** When an investor expresses relevant interest, Rupert will pass the response and available investor information to the Client. From that point the Client owns the relationship, including meetings, follow-up, diligence, negotiation and closing.

2.4 **Discretionary support.** Rupert may, at its discretion, provide additional investor research or a consultation of up to 30 minutes before an investor meeting generated by the campaign. This is not an obligation and has no fixed frequency.

2.5 **Volume and pace.** Rupert prioritizes investor relevance over volume. Rupert does not commit to a minimum number of investors contacted, emails sent, responses, or meetings. The Monthly Campaign Fee pays for a Service Month of campaign management under the Sending Plan. It does not pay for a number of emails or contacts.

2.6 **What Rupert does not do.** Rupert is not a broker-dealer, placement agent, finder, investment adviser, or legal, tax or financial advisor. Rupert does not:

- receive any compensation based on whether, how much, or from whom the Client raises;
- recommend, value, or advise on any security or investment;
- negotiate, structure, or take part in closing any transaction;
- handle or hold any investor funds or securities;
- take part in investor meetings, diligence or negotiations;
- verify the status or accreditation of any investor.

2.7 **Fees are fixed.** Rupert's only compensation is the fixed fees in Section 5. No fee is tied to the success, size or completion of any financing.

## 3. Setup, Approvals and Launch

3.1 **Timing.** Setup typically takes 2 to 4 weeks after Kick-off. This is an estimate, not a deadline. The Setup Period extends day for day for any delay by the Client in providing information, materials, access or approvals.

3.2 **Approvals required.** Before Launch, the Client must approve the investor target list, campaign positioning and outreach messaging. Approval may be given in writing by email or through the Rupert Client Portal. Rupert will not launch any campaign without these approvals.

3.3 **Launch Confirmation.** When Setup is complete and the approvals in Section 3.2 are given, Rupert will issue a Launch Confirmation and the first Monthly Campaign Fee invoice. The Launch Confirmation names the Approved Inbox and the postal address for the campaign emails, and confirms the Sending Plan. The Client may choose whether to confirm it and pay. Confirming it in the Rupert Client Portal and paying is the Client's decision to launch. No signature is needed.

3.4 **Launch.** The campaign launches only after all of (a) the approvals in Section 3.2, (b) the Launch Confirmation confirmed by the Client, and (c) payment of the first Monthly Campaign Fee. The date the campaign first sends is the "Launch Date."

3.5 **On Hold.** Before Launch, the engagement is "On Hold" whenever Rupert is waiting for the Client to provide information, materials, access, an approval, the confirmed Launch Confirmation, or payment of the first Monthly Campaign Fee. While the engagement is On Hold, Rupert has no obligation to perform any work and is not in breach. The Client may resume by providing what is outstanding, subject to Sections 3.6 and 3.7.

3.6 **Refresh after 45 days.** If the engagement is On Hold for more than 45 consecutive days, investor data and campaign materials may be out of date. Before resuming, Rupert may require a refresh fee equal to the Setup Fee and may apply its then-current Monthly Campaign Fee.

3.7 **Ending while On Hold.** Either party may end this Service Order by written notice at any time while the engagement is On Hold. The Setup Fee is not refunded.

3.8 **Changes after approval.** The Client may request changes to approved materials. Rupert will make reasonable changes within the scope of this Service Order. Material changes require new Client approval before they go live.

## 4. Sending Plan

4.1 **Basic package.** The campaign is sent from one Client inbox approved by both parties (the "Approved Inbox"). Additional inboxes are not included. They are available only by written agreement and at an additional fee.

4.2 **Pace.** Emails are sent on Business Days only. For the first 10 Business Days after the Launch Date, Rupert sends up to 15 emails per Business Day (the warm-up). After that, Rupert sends up to 30 emails per Business Day. The warm-up is part of the first Service Month.

4.3 **What counts.** Each contact receives a first email and at most one follow-up. The follow-up is sent 5 Business Days after the first email, unless the contact has replied or opted out. First emails and follow-ups both count toward the daily limits.

4.4 **Rupert controls the pace.** Rupert decides the order, timing and daily volume of sending within these limits. The limits are maximums, not commitments. Rupert may send less to protect the deliverability or reputation of the Approved Inbox. The Client may not require Rupert to exceed the limits, to compress the campaign into a shorter period, or to send faster than this Sending Plan.

4.5 **No carry-over.** Unused sending capacity does not roll over and is not credited. Sending stops at the end of the last paid Service Month. Any email not sent by then, including a pending follow-up, is not sent.

4.6 **Pauses and inbox problems.** The Service Month continues to run, with no credit or extension, if sending pauses because (a) the Client asks for a pause, (b) the Approved Inbox is unavailable, restricted or suspended, or (c) the Client changes or removes Rupert's access.

4.7 **Use of the Approved Inbox.** During the campaign, the Client will keep Rupert's access to the Approved Inbox working and will not use it for other bulk or automated sending.

4.8 **Plans are illustrations.** Any campaign plan, timeline or contact count Rupert shares, including a plan covering several months, is an estimate to help the Client plan. It is not a commitment by Rupert to any volume or duration, or by the Client to any month beyond the one it has paid for.

## 5. Fees and Payment

5.1 **Setup Fee.** $250, one-time, invoiced on signing and due on receipt.

5.2 **Monthly Campaign Fee.** $1,000 per Service Month. The first Service Month begins on the Launch Date. Each later Service Month begins on the same day of each following month (each a "Renewal Date").

5.3 **Invoicing.** All invoices are issued through Stripe with a payment link and are due on receipt. Each renewal invoice is issued before its Renewal Date and must be paid in advance of the Service Month it covers.

5.4 **Non-payment.** If a renewal invoice is unpaid on its Renewal Date, Rupert may pause all campaigns until payment is received. If it remains unpaid 7 days after the Renewal Date, this Service Order terminates automatically. Paused time is not credited or extended.

5.5 **No refunds.** All fees are earned when paid and are non-refundable, including for partial months, paused campaigns, termination by the Client, or results. The only exception is the refund in Section 6.3.

5.6 **Chargebacks.** The Client will not dispute or reverse any payment for services provided under this Service Order. An unjustified chargeback is a material breach, and the Client will reimburse any related fees.

5.7 **Taxes.** Fees exclude taxes. The Client pays any applicable sales, use or similar taxes, other than taxes on Rupert's income.

5.8 **Client accounts.** The Client provides and pays for the Approved Inbox, its domain and its email account.

5.9 **Fee changes.** Rupert may change the Monthly Campaign Fee by giving at least 30 days' written notice. The change takes effect on the next Renewal Date after the notice period.

## 6. Term and Termination

6.1 **Term.** This Service Order starts on the Effective Date. After Launch it continues month to month until terminated under this Section.

6.2 **Termination by the Client.** The Client may terminate by written notice (email is sufficient) given at least 7 days before the next Renewal Date. Termination takes effect on that Renewal Date. Rupert will continue to provide the services through the end of the paid Service Month. Before Launch, the Client may terminate at any time; the Setup Fee is not refunded.

6.3 **Termination by Rupert at any time.** Rupert may terminate this Service Order at any time, for any reason or no reason, by written notice. Termination takes effect immediately or on the date stated in the notice. If Rupert terminates after Launch and not under Section 6.4, Rupert will refund the part of the current Service Month's fee that covers the days after the termination date. That refund is the Client's only remedy for termination under this Section.

6.4 **Suspension or termination by Rupert for cause.** Rupert may suspend the campaign immediately, or terminate this Service Order immediately by written notice, if the Client:

- breaches this Service Order, including any payment obligation;
- provides information that is false, misleading or incomplete;
- uses the services for any unlawful purpose, or Rupert reasonably believes continuing would expose Rupert to legal, regulatory or reputational risk;
- receives repeated spam complaints, or its email provider restricts or suspends the Approved Inbox;
- repeats demands that fall outside this Service Order or the Sending Plan after Rupert has declined them;
- is abusive or hostile toward Rupert, its personnel or investors.

No fees are refunded on suspension or termination for cause.

6.5 **Effect of termination.** On termination, all campaigns stop. If termination is after Launch, the Client keeps access to the Rupert Client Portal for 30 days after the termination date, during which it may download its campaign results, investor responses, the details of investors who replied, and the Fund List. Contact Data for anyone who has not replied is never included. If this Service Order ends before Launch, the Client keeps access for 14 days to the Fund List only, and keeps Rupert's comments on its pitch deck and messaging. After those periods Rupert may delete or archive the data. All unpaid fees for services already provided become due immediately.

6.6 **Survival.** Sections 5.5, 5.6, 6.5, 7, 8, 9, 10 and 11 survive termination.

## 7. Client Responsibilities

7.1 **Accurate information.** The Client will provide information and materials that are accurate, complete and not misleading, and will keep them current. Rupert relies on everything the Client provides or approves and has no duty to verify it.

7.2 **Client approval of content.** The Client approves all investor-facing content before it is sent. Approved content is the Client's statement, made in the Client's name, to investors.

7.3 **Authority.** The Client represents that it is validly organized, has authority to sign this Service Order, and is authorized to raise the capital described to Rupert.

7.4 **Securities compliance.** The Client is solely responsible for its offering and its compliance with all securities laws, including:

- the structure of the offering and the exemption it relies on (for example, Rule 506(b) or 506(c) of Regulation D);
- the effect of investor outreach on that exemption, including whether the campaign is "general solicitation";
- any Form D and state securities filings;
- verifying investor accreditation where required;
- all offering documents and representations made to investors.

The Client acknowledges that it has had the opportunity to consult its own securities counsel before signing.

7.5 **Email compliance.** All campaign emails are sent from the Approved Inbox, in the Client's name, promoting the Client's offering. The Client is the sender of those emails for the purposes of the CAN-SPAM Act and any similar law. Each campaign email will include an opt-out line and the Client's valid physical postal address. The Client will give Rupert that address before Launch, and Rupert will not launch without it. The Client remains responsible for:

- the accuracy of the postal address;
- honoring opt-outs within 10 business days, including opt-outs it receives directly;
- compliance with the laws of any country outside the United States where a recipient is located, for any non-US investors on the approved list.

7.6 **Sending accounts.** The Client authorizes Rupert to access and send from the Approved Inbox for the campaign. The Client owns that account. The Client acknowledges that outbound email carries inherent risks to domain and account reputation, deliverability, and account restrictions by email providers. Rupert is not responsible for those outcomes.

7.7 **After handoff.** Once an investor is handed off, all communications, meetings, diligence, negotiations and decisions are solely the Client's. Rupert has no responsibility for them.

7.8 **Independent decisions.** The Client makes its own decisions about its fundraising, investors and terms. The Client does not rely on Rupert for legal, tax, financial or investment advice.

## 8. Rupert's Commitment, Disclaimers and Ownership

8.1 **Commitment.** Rupert will perform the services in good faith, using professional judgment and commercially reasonable efforts. This is Rupert's only commitment about the services.

8.2 **No guarantee of results.** Rupert does not guarantee any investor response, meeting, term sheet, investment, amount raised, or any other fundraising outcome. Fees are owed regardless of results.

8.3 **Disclaimer.** Except as stated in Section 8.1, the services, the Rupert Client Portal and all data are provided "as is." Rupert disclaims all other warranties, express or implied, including merchantability, fitness for a particular purpose, and the accuracy or completeness of fund or investor data.

8.4 **Rupert property.** Rupert owns, and keeps all rights in, its fund and investor database, fund data, Contact Data, matching methods, templates, processes, know-how and the Rupert Client Portal ("Rupert Property"). "Contact Data" means the names, email addresses, titles and other details of individuals at funds, in any form and wherever they appear, including in the Rupert Client Portal and in the Approved Inbox. Nothing in this Service Order transfers ownership of Rupert Property to the Client.

8.5 **Client materials.** The Client owns its pitch deck, company information and other materials it provides. The Client grants Rupert a license to use them for the services during the term and for 30 days after it.

8.6 **Fund List.** The names of the funds on the approved investor target list (the "Fund List") are the Client's to keep and to use for its own fundraising, including after this Service Order ends. The Fund List does not include Contact Data or any other fund information.

8.7 **Contact Data and fund information.** Rupert uses Contact Data and fund information only to run the campaign under this Service Order. The Client receives no license to them outside that campaign. The Client will not:

- extract, export, copy or compile Contact Data from the Rupert Client Portal, the Approved Inbox or anywhere else;
- contact anyone using Contact Data outside the campaign Rupert runs;
- sell, share, publish or give Contact Data or fund information to any third party;
- use them to build or add to any database, list or product;
- use them for any other company or on behalf of anyone else.

8.8 **Responding investors.** When an investor replies to the campaign, that reply, that person's contact details and the relationship that follows belong to the Client. The Client may download them as described in Section 6.5.

8.9 **Aggregate data.** Rupert may use anonymized, aggregated campaign data that does not identify the Client to operate and improve its services.

## 9. Confidentiality, Indemnity and Liability

9.1 **Rupert's confidential information.** The Client will keep Rupert Property, fund information, pricing and the terms of this Service Order confidential, and will use them only as allowed by Section 8. This obligation lasts during the term and for 3 years after it, and indefinitely for Contact Data and fund data. It does not apply to the Fund List.

9.2 **Indemnity by the Client.** The Client will defend, indemnify and hold harmless The Night Ventures, LLC and its members, managers, employees and contractors from all third-party claims, losses, penalties, fines and costs (including reasonable attorneys' fees) arising from:

- information or materials the Client provided or approved;
- the Client's offering, or its compliance with securities laws;
- campaign emails sent in the Client's name, including any claim under the CAN-SPAM Act or any similar law;
- the Client's dealings with any investor, before or after handoff;
- the Client's breach of this Service Order.

9.3 **No indirect damages.** Rupert is not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, lost investment, failed or delayed financing, loss of data, or damage to domain or email reputation, even if advised that they were possible.

9.4 **Liability cap.** Rupert's total liability arising from or relating to this Service Order, the NDA or the services, under any theory, will not exceed the fees the Client actually paid to Rupert in the 3 months before the event giving rise to the claim.

9.5 **Client obligations not capped.** Sections 9.3 and 9.4 do not limit the Client's payment obligations, its obligations under Sections 8.7, 9.1 and 9.2, or its liability for misuse of Rupert Property.

## 10. Disputes

10.1 **Governing law.** California law governs this Service Order, without regard to its conflict-of-law rules.

10.2 **Arbitration.** Any dispute arising from or relating to this Service Order, the NDA or the services will be resolved by final, binding arbitration administered by JAMS under its Streamlined Arbitration Rules, before a single arbitrator, seated in Sonoma County, California. Judgment on the award may be entered in any court with jurisdiction.

10.3 **Exceptions.** Either party may (a) bring a claim in small claims court, and (b) seek an injunction in court to protect its confidential information or intellectual property, including Rupert Property.

10.4 **Individual claims only.** Claims may be brought only individually, not as part of any class or representative action.

10.5 **Attorneys' fees.** The prevailing party in any arbitration or action to enforce this Service Order, including to collect unpaid fees, may recover its reasonable attorneys' fees and costs.

## 11. General

11.1 **Independent contractor.** Rupert is an independent contractor. Rupert acts on the Client's behalf only to send approved campaign emails, and has no authority to make any commitment for the Client.

11.2 **Notices.** Notices must be in writing and sent to the notice emails above. A notice is effective when sent, unless the sender receives a delivery failure.

11.3 **Assignment.** The Client may not assign this Service Order without Rupert's written consent. Rupert may assign it to an affiliate or a successor to its business.

11.4 **Subcontractors.** Rupert may use contractors and service providers to perform the services and remains responsible for their work under this Service Order.

11.5 **Publicity.** Rupert will not name the Client publicly as a client without the Client's written consent.

11.6 **Force majeure.** Neither party is liable for delays caused by events beyond its reasonable control, including outages of email providers or third-party platforms. This does not excuse payment obligations.

11.7 **Amendments and waiver.** This Service Order may be changed only in writing signed by both parties, including a Launch Confirmation accepted electronically. A failure to enforce a term is not a waiver of it.

11.8 **Severability.** If any term is unenforceable, it will be enforced to the maximum extent allowed and the rest of this Service Order remains in effect.

11.9 **Signatures.** This Service Order may be signed electronically and in counterparts. Each is an original.
`;
