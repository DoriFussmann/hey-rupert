import { CLIENT_TOKENS } from "@/lib/service-order";

// Launch Confirmation: signed with the first Monthly Campaign Fee invoice,
// before Go Live. It names the Approved Inbox and postal address, restates the
// Sending Plan, and moves a client who signed an earlier Service Order onto
// the current one. The bracketed fields other than the client tokens are
// filled in per client before it is sent.
export const DEFAULT_LAUNCH_CONFIRMATION = `# Hey Rupert - Launch Confirmation

This Launch Confirmation is between The Night Ventures, LLC, doing business as Hey Rupert ("Rupert"), and ${CLIENT_TOKENS.company_name} ("Client"), under the Service Order between them. Setup is complete. By signing, Client confirms its decision to launch on the terms below. Terms defined in the Service Order mean the same here.

**1. What Client has approved.** Client has approved the investor target list ([FUND_COUNT] funds, [CONTACT_COUNT] contacts), the campaign positioning and the outreach messaging, as shown in the Rupert Client Portal on the date of signature.

**2. Approved Inbox.** The campaign is sent from one inbox: [APPROVED_INBOX]. Client owns it, authorizes Rupert to access and send from it, will keep that access working, and will not use it for other bulk or automated sending during the campaign.

**3. Postal address.** Each campaign email carries an opt-out line and this postal address for Client: [CLIENT_POSTAL_ADDRESS]. Client confirms the address is valid and its own.

**4. Sending Plan.** Client confirms it understands and accepts how the campaign is sent:

- Emails are sent on Business Days only (Monday to Friday, excluding US federal holidays).
- For the first 10 Business Days: up to 15 emails per Business Day.
- After that: up to 30 emails per Business Day.
- Each contact receives a first email and at most one follow-up, 5 Business Days later. Both count toward the daily limits.
- Rupert decides the order, timing and daily volume. The limits are maximums, not commitments.
- Client may not require faster sending, or the campaign compressed into a shorter period.
- Unused capacity does not carry over. Sending stops at the end of the last paid Service Month, including any pending follow-up.
- A pause requested by Client, or caused by a problem with the Approved Inbox, does not extend or credit the Service Month.

**5. Illustrative plan.** At this pace, as an estimate and not a commitment:

- Month 1 (includes warm-up): about 510 emails, reaching about 255 contacts
- Month 2: about 660 emails, about 585 contacts reached in total
- Month 3: about 660 emails, about 915 contacts reached in total

Client's approved list of [CONTACT_COUNT] contacts would take about [PLAN_MONTHS] months at this pace. This plan commits neither party beyond the Service Month Client has paid for.

**6. Month to month.** The Monthly Campaign Fee is [MONTHLY_FEE] per Service Month, paid in advance. The first Service Month begins on the Launch Date. The fee pays for a Service Month of campaign management, not for a number of emails or contacts. Client decides each month whether to continue, by paying the next invoice or giving notice under the Service Order.

**7. Fund names and contact details.** The names of the funds on the approved list are Client's to keep. The contact details of individuals at those funds are Rupert's property and are used only inside the campaign Rupert runs; Client will not extract or use them outside it. When an investor replies, that reply and that contact belong to Client.

**8. Launch.** The campaign launches after Client signs this Launch Confirmation and pays the first Monthly Campaign Fee invoice.

**9. Part of the Service Order.** This Launch Confirmation is part of the Service Order. Rupert issues it through the Rupert Client Portal, which is Rupert's signature to it.

**10. Current terms.** [Include only for a Client who signed an earlier Service Order version.] Service Order version [SERVICE_ORDER_VERSION], available in the Rupert Client Portal, replaces the Service Order Client signed on [SERVICE_ORDER_SIGNED_DATE]. The Setup Fee and Monthly Campaign Fee stay as Client signed them. The NDA between the parties is unchanged.
`;
