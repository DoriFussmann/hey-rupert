// Service Order: default template, client-field merge and the rules shared by
// the admin generator, the client signing flow and onboarding progress.

export const SETUP_FEE_LABEL = "$250";

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

/** Accepts https links on stripe.com (invoice, payment link and checkout pages). */
export function isStripePaymentLink(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host === "stripe.com" || host.endsWith(".stripe.com"))
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

export const DEFAULT_SERVICE_ORDER = `# Hey Rupert — Service Order

This Service Order is a binding agreement between the parties below for a Hey Rupert investor outreach engagement. It becomes effective on the date of the last signature (the "Effective Date").

## Parties

**Provider:** The Night Ventures, LLC, a California limited liability company, doing business as Hey Rupert ("Rupert"), 230 Frankel Ln, Sebastopol, CA 95472.

**Client:** ${CLIENT_TOKENS.company_name} ("Client").

**Client notice email:** ${CLIENT_TOKENS.signer_email}

**Rupert notice email:** dori@thenightventures.com

## Commercial Summary

- **Setup Fee:** $250, one-time, non-refundable, due on signing
- **Setup Period:** Target 2 to 4 weeks from Kick-off; extended by any Client delay
- **Monthly Campaign Fee:** $1,000 per Service Month, invoiced and paid in advance
- **First Monthly Invoice:** Issued when Setup is complete; payment is the Client's decision to launch
- **Term:** Month-to-month after Launch
- **Cancellation:** Written notice at least 7 days before the next Renewal Date; effective at that Renewal Date
- **Refunds:** None. All fees are non-refundable
- **Payment method:** Stripe invoice with payment link
- **Post-termination data access:** 30 days through the Rupert Client Portal
- **Disputes:** Binding arbitration, California law

If this summary conflicts with the sections below, the sections below control.

## 1. Agreement and Kick-off

1.1 **Entire agreement.** This Service Order is the entire agreement between the parties for the services. It supersedes the Statement of Work and all prior proposals, emails and discussions. The Statement of Work is not part of this agreement.

1.2 **NDA.** The parties will sign a separate non-disclosure agreement (the "NDA") after this Service Order and before Client Intake. The NDA governs the Client's confidential information. Section 8.1 governs Rupert's proprietary information. If the NDA conflicts with this Service Order on any other subject, this Service Order controls.

1.3 **Kick-off.** Rupert's obligations begin on the date both of the following have occurred: (a) the Client has signed this Service Order, and (b) Rupert has received the Setup Fee in full ("Kick-off"). Rupert has no obligation to perform any work before Kick-off.

1.4 **Sequence.** After Kick-off: NDA, then Client Intake, then Setup, then Client approvals, then First Monthly Invoice, then Launch on payment.

## 2. Services

2.1 **Setup Services.** During Setup, Rupert will:

- review the Client's pitch deck and provide comments for the Client to implement;
- review and refine the Client's fundraising messaging and positioning;
- define the investor strategy by vertical, stage and geography;
- research and match relevant investors and funds;
- prepare the investor target list and available fund information;
- draft the outreach messaging and any variants.

2.2 **Campaign Services.** After Launch, Rupert will run the approved campaign from the Client's approved sending inboxes, monitor it, and give the Client access to campaign analytics and investor communications through the Rupert Client Portal.

2.3 **Investor handoff.** When an investor expresses relevant interest, Rupert will pass the response and available investor information to the Client. From that point the Client owns the relationship, including meetings, follow-up, diligence, negotiation and closing.

2.4 **Discretionary support.** Rupert may, at its discretion, provide additional investor research or a consultation of up to 30 minutes before an investor meeting generated by the campaign. This is not an obligation and has no fixed frequency.

2.5 **Volume.** Rupert prioritizes investor relevance over volume. Rupert does not commit to a minimum number of investors contacted, emails sent, responses, or meetings.

2.6 **What Rupert does not do.** Rupert is not a broker-dealer, placement agent, finder, investment adviser, or legal, tax or financial advisor. Rupert does not:

- receive any compensation based on whether, how much, or from whom the Client raises;
- recommend, value, or advise on any security or investment;
- negotiate, structure, or take part in closing any transaction;
- handle or hold any investor funds or securities;
- take part in investor meetings, diligence or negotiations;
- verify the status or accreditation of any investor.

2.7 **Fees are fixed.** Rupert's only compensation is the fixed fees in Section 4. No fee is tied to the success, size or completion of any financing.

## 3. Setup, Approvals and Launch

3.1 **Timing.** Rupert targets completing Setup within 2 to 4 weeks after Kick-off. This is an estimate, not a deadline. The Setup Period extends day for day for any delay by the Client in providing information, materials, access or approvals.

3.2 **Approvals required.** Before Launch, the Client must approve the investor target list, campaign positioning and outreach messaging. Approval may be given in writing by email or through the Rupert Client Portal. Rupert will not launch any campaign without these approvals.

3.3 **Client delay.** If the Client does not provide required information or approvals, Rupert has no obligation to proceed and is not in breach. If the Client is unresponsive for 60 consecutive days, Rupert may terminate this Service Order by written notice and keep the Setup Fee.

3.4 **First Monthly Invoice.** When Setup is complete, Rupert will issue the first Monthly Campaign Fee invoice. The Client may choose whether to pay it. Paying it confirms the Client's decision to launch. If the Client does not pay within 14 days of issue, this Service Order ends automatically at the end of that period, with no further obligation on either party except under Sections 7, 8 and 9.

3.5 **Launch.** The campaign launches only after both (a) the approvals in Section 3.2 and (b) payment of the first Monthly Campaign Fee. The date the campaign first sends is the "Launch Date."

3.6 **Changes after approval.** The Client may request changes to approved materials. Rupert will make reasonable changes within the scope of this Service Order. Material changes require new Client approval before they go live.

## 4. Fees and Payment

4.1 **Setup Fee.** $250, one-time, invoiced on signing and due on receipt.

4.2 **Monthly Campaign Fee.** $1,000 per Service Month. The first Service Month begins on the Launch Date. Each later Service Month begins on the same day of each following month (each a "Renewal Date").

4.3 **Invoicing.** All invoices are issued through Stripe with a payment link and are due on receipt. Each renewal invoice is issued before its Renewal Date and must be paid in advance of the Service Month it covers.

4.4 **Non-payment.** If a renewal invoice is unpaid on its Renewal Date, Rupert may pause all campaigns until payment is received. If it remains unpaid 7 days after the Renewal Date, this Service Order terminates automatically. Paused time is not credited or extended.

4.5 **No refunds.** All fees are earned when paid and are non-refundable, including for partial months, paused campaigns, early termination, or results.

4.6 **Chargebacks.** The Client will not dispute or reverse any payment for services provided under this Service Order. An unjustified chargeback is a material breach, and the Client will reimburse any related fees.

4.7 **Taxes.** Fees exclude taxes. The Client pays any applicable sales, use or similar taxes, other than taxes on Rupert's income.

4.8 **Client accounts.** The Client provides and pays for its own sending inboxes, domains and email accounts used for the campaign.

4.9 **Fee changes.** Rupert may change the Monthly Campaign Fee by giving at least 30 days' written notice. The change takes effect on the next Renewal Date after the notice period.

## 5. Term and Termination

5.1 **Term.** This Service Order starts on the Effective Date. After Launch it continues month to month until terminated under this Section.

5.2 **Termination by the Client.** The Client may terminate by written notice (email is sufficient) given at least 7 days before the next Renewal Date. Termination takes effect on that Renewal Date. Rupert will continue to provide the services through the end of the paid Service Month. Before Launch, the Client may terminate at any time; the Setup Fee is not refunded.

5.3 **Termination by Rupert for convenience.** Rupert may terminate by written notice given at least 7 days before the next Renewal Date, effective on that Renewal Date.

5.4 **Suspension or termination by Rupert for cause.** Rupert may suspend the campaign immediately, or terminate this Service Order immediately by written notice, if the Client:

- breaches this Service Order, including any payment obligation;
- provides information that is false, misleading or incomplete;
- uses the services for any unlawful purpose, or Rupert reasonably believes continuing would expose Rupert to legal, regulatory or reputational risk;
- receives repeated spam complaints, or its email provider restricts or suspends a sending account;
- is abusive toward Rupert or toward investors.

No fees are refunded on suspension or termination for cause.

5.5 **Effect of termination.** On termination, all campaigns stop. The Client keeps access to the Rupert Client Portal for 30 days after the termination date, during which it may download its campaign data, investor responses and leads. After that period Rupert may delete or archive that data. All unpaid fees for services already provided become due immediately.

5.6 **Survival.** Sections 4.5, 4.6, 5.5, 6, 7, 8, 9 and 10 survive termination.

## 6. Client Responsibilities

6.1 **Accurate information.** The Client will provide information and materials that are accurate, complete and not misleading, and will keep them current. Rupert relies on everything the Client provides or approves and has no duty to verify it.

6.2 **Client approval of content.** The Client approves all investor-facing content before it is sent. Approved content is the Client's statement, made in the Client's name, to investors.

6.3 **Authority.** The Client represents that it is validly organized, has authority to sign this Service Order, and is authorized to raise the capital described to Rupert.

6.4 **Securities compliance.** The Client is solely responsible for its offering and its compliance with all securities laws, including:

- the structure of the offering and the exemption it relies on (for example, Rule 506(b) or 506(c) of Regulation D);
- the effect of investor outreach on that exemption, including whether the campaign is "general solicitation";
- any Form D and state securities filings;
- verifying investor accreditation where required;
- all offering documents and representations made to investors.

The Client acknowledges that it has had the opportunity to consult its own securities counsel before signing.

6.5 **Email compliance.** All campaign emails are sent from the Client's approved inboxes, in the Client's name, promoting the Client's offering. The Client is the sender of those emails for the purposes of the CAN-SPAM Act and any similar law. Rupert will build the campaign using its standard practices designed to meet CAN-SPAM, including accurate sender information, honest subject lines, a physical postal address and an opt-out. The Client remains responsible for:

- providing a valid physical postal address for inclusion in every email;
- honoring opt-outs within 10 business days, including opt-outs it receives directly;
- compliance with the laws of any country outside the United States where a recipient is located, for any non-US investors on the approved list.

6.6 **Sending accounts.** The Client authorizes Rupert to access and send from the approved inboxes for the campaign. The Client owns those accounts. The Client acknowledges that outbound email carries inherent risks to domain and account reputation, deliverability, and account restrictions by email providers. Rupert is not responsible for those outcomes.

6.7 **After handoff.** Once an investor is handed off, all communications, meetings, diligence, negotiations and decisions are solely the Client's. Rupert has no responsibility for them.

6.8 **Independent decisions.** The Client makes its own decisions about its fundraising, investors and terms. The Client does not rely on Rupert for legal, tax, financial or investment advice.

## 7. Rupert's Commitment, Disclaimers and Ownership

7.1 **Commitment.** Rupert will perform the services in good faith, using professional judgment and commercially reasonable efforts. This is Rupert's only commitment about the services.

7.2 **No guarantee of results.** Rupert does not guarantee any investor response, meeting, term sheet, investment, amount raised, or any other fundraising outcome. Fees are owed regardless of results.

7.3 **Disclaimer.** Except as stated in Section 7.1, the services, the Rupert Client Portal and all data are provided "as is." Rupert disclaims all other warranties, express or implied, including merchantability, fitness for a particular purpose, and the accuracy or completeness of fund or investor data.

7.4 **Rupert property.** Rupert owns, and keeps all rights in, its fund and investor database, fund data, matching methods, templates, processes, know-how and the Rupert Client Portal ("Rupert Property"). Nothing in this Service Order transfers ownership of Rupert Property to the Client.

7.5 **Client materials.** The Client owns its pitch deck, company information and other materials it provides. The Client grants Rupert a license to use them for the services during the term and for 30 days after it.

7.6 **License to the Client.** Rupert grants the Client a limited, non-exclusive, non-transferable license to use the investor target list, fund information and approved outreach messaging solely for the Client's own fundraising. The Client will not:

- sell, share, publish or give any of it to any third party, other than its own legal and financial advisors bound by confidentiality;
- use it to build or add to any database, list or product;
- use it for any other company or on behalf of anyone else.

7.7 **Leads and relationships.** Investor responses and the relationships that follow belong to the Client. The Client may download leads and campaign data as described in Section 5.5.

7.8 **No launch, no list.** If this Service Order ends before Launch, the Client receives no copy of, and no further access to, the investor target list or fund information. The Client keeps Rupert's comments on its pitch deck and messaging.

7.9 **Aggregate data.** Rupert may use anonymized, aggregated campaign data that does not identify the Client to operate and improve its services.

## 8. Confidentiality, Indemnity and Liability

8.1 **Rupert's confidential information.** The Client will keep Rupert Property, the investor target list, fund information, pricing and the terms of this Service Order confidential, and will use them only as allowed by Section 7.6. This obligation lasts during the term and for 3 years after it, and indefinitely for fund and investor data.

8.2 **Indemnity by the Client.** The Client will defend, indemnify and hold harmless The Night Ventures, LLC and its members, managers, employees and contractors from all third-party claims, losses, penalties, fines and costs (including reasonable attorneys' fees) arising from:

- information or materials the Client provided or approved;
- the Client's offering, or its compliance with securities laws;
- campaign emails sent in the Client's name, including any claim under the CAN-SPAM Act or any similar law;
- the Client's dealings with any investor, before or after handoff;
- the Client's breach of this Service Order.

8.3 **No indirect damages.** Rupert is not liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, lost investment, failed or delayed financing, loss of data, or damage to domain or email reputation, even if advised that they were possible.

8.4 **Liability cap.** Rupert's total liability arising from this Service Order, under any theory, will not exceed the fees the Client actually paid to Rupert in the 3 months before the event giving rise to the claim.

8.5 **Client obligations not capped.** Sections 8.3 and 8.4 do not limit the Client's payment obligations, its obligations under Sections 7.6, 8.1 and 8.2, or its liability for misuse of Rupert Property.

## 9. Disputes

9.1 **Governing law.** California law governs this Service Order, without regard to its conflict-of-law rules.

9.2 **Arbitration.** Any dispute arising from or relating to this Service Order will be resolved by final, binding arbitration administered by JAMS under its Streamlined Arbitration Rules, before a single arbitrator, seated in Sonoma County, California. Judgment on the award may be entered in any court with jurisdiction.

9.3 **Exceptions.** Either party may (a) bring a claim in small claims court, and (b) seek an injunction in court to protect its confidential information or intellectual property, including Rupert Property.

9.4 **Individual claims only.** Claims may be brought only individually, not as part of any class or representative action.

9.5 **Attorneys' fees.** The prevailing party in any arbitration or action to enforce this Service Order, including to collect unpaid fees, may recover its reasonable attorneys' fees and costs.

## 10. General

10.1 **Independent contractor.** Rupert is an independent contractor. Rupert acts on the Client's behalf only to send approved campaign emails, and has no authority to make any commitment for the Client.

10.2 **Notices.** Notices must be in writing and sent to the notice emails above. A notice is effective when sent, unless the sender receives a delivery failure.

10.3 **Assignment.** The Client may not assign this Service Order without Rupert's written consent. Rupert may assign it to an affiliate or a successor to its business.

10.4 **Subcontractors.** Rupert may use contractors and service providers to perform the services and remains responsible for their work under this Service Order.

10.5 **Publicity.** Rupert will not name the Client publicly as a client without the Client's written consent.

10.6 **Force majeure.** Neither party is liable for delays caused by events beyond its reasonable control, including outages of email providers or third-party platforms. This does not excuse payment obligations.

10.7 **Amendments and waiver.** This Service Order may be changed only in writing signed by both parties. A failure to enforce a term is not a waiver of it.

10.8 **Severability.** If any term is unenforceable, it will be enforced to the maximum extent allowed and the rest of this Service Order remains in effect.

10.9 **Signatures.** This Service Order may be signed electronically and in counterparts. Each is an original.
`;
