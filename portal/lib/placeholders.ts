import type {
  Acknowledgement,
  Campaign,
  Client,
  Investor,
  InvestorReply,
} from "@/lib/types";

export const placeholderScopeOfWork = `Rupert runs investor research, targeting, personalized outreach, and follow-up for this raise. You retain ownership of every relationship and every reply.

The work covers building the investor universe, drafting outreach for your approval, sending sequences from infrastructure managed by Rupert, and tracking replies into this portal.

Rupert does not take a percentage of the raise. Outcomes are not guaranteed. The engagement continues through the live outreach period described in the service order.`;

export const placeholderServiceOrder = `This service order sits under the statement of work. It covers the current raise only and can be replaced if the round changes.

- Engagement length: 90 days from kickoff
- Fee: as agreed on the discovery call
- Included: research, matching, copy, outreach, reply handling
- Not included: legal negotiation, term-sheet counsel, placement

Work begins when this order is agreed. Pause or scope changes are handled in writing through this portal.`;

export const placeholderClients: Client[] = [
  {
    id: "lena-health",
    company_name: "Lena Health",
    founder_name: "Maya Chen",
    founder_email: "maya@lenahealth.com",
    raise_stage: "Series A",
    raise_amount: "$8m",
    sector: "Healthcare",
    status: "live",
    notes: "Outreach live across two sequences. Founder reviewing weekly replies.",
    last_activity_at: "2026-08-24T14:20:00.000Z",
    created_at: "2026-06-12T00:00:00.000Z",
  },
  {
    id: "natrion",
    company_name: "Natrion",
    founder_name: "James Okoye",
    founder_email: "james@natrion.co",
    raise_stage: "Seed",
    raise_amount: "$3.5m",
    sector: "Climate",
    status: "preparation",
    notes: "Deck comments returned. Messaging draft in review.",
    last_activity_at: "2026-08-25T09:10:00.000Z",
    created_at: "2026-07-02T00:00:00.000Z",
  },
  {
    id: "sorso",
    company_name: "Sorso",
    founder_name: "Elena Varga",
    founder_email: "elena@sorso.com",
    raise_stage: "Seed",
    raise_amount: "$2.5m",
    sector: "Consumer",
    status: "onboarding",
    notes: "Statement of Work sent. Waiting on confirmation.",
    last_activity_at: "2026-08-21T16:40:00.000Z",
    created_at: "2026-08-18T00:00:00.000Z",
  },
];

export const placeholderAcknowledgements: Acknowledgement[] = [
  {
    id: "ack-1",
    client_id: "natrion",
    company_name: "Natrion",
    type: "deck",
    title: "Pitch Deck Review acknowledged",
    body: "James Okoye acknowledged the latest deck comments and requested two wording changes on the traction slide.",
    read_at: null,
    created_at: "2026-08-25T09:12:00.000Z",
  },
  {
    id: "ack-2",
    client_id: "lena-health",
    company_name: "Lena Health",
    type: "investor_list",
    title: "Target List acknowledged",
    body: "Maya Chen confirmed the matched list and asked to hold three funds already in conversation.",
    read_at: null,
    created_at: "2026-08-24T18:04:00.000Z",
  },
  {
    id: "ack-3",
    client_id: "sorso",
    company_name: "Sorso",
    type: "scope_of_work",
    title: "Statement of Work confirmed",
    body: "Elena Varga confirmed the statement of work. Service order is next.",
    read_at: "2026-08-22T11:00:00.000Z",
    created_at: "2026-08-21T17:02:00.000Z",
  },
];

export const placeholderInvestors: Investor[] = [
  {
    id: "inv-1",
    fund: "Northline Ventures",
    partner: "Priya Shah",
    thesis: "Early healthcare infrastructure, Series A",
    check_size: "$1–3m",
    geography: "US",
    status: "replied",
  },
  {
    id: "inv-2",
    fund: "Harbor Peak",
    partner: "Daniel Cho",
    thesis: "B2B health systems and workflow software",
    check_size: "$2–5m",
    geography: "US / UK",
    status: "contacted",
  },
  {
    id: "inv-3",
    fund: "Elm & River",
    partner: "Sofia Alvarez",
    thesis: "Founder-led healthcare services, seed to A",
    check_size: "$500k–1.5m",
    geography: "US",
    status: "meeting",
  },
  {
    id: "inv-4",
    fund: "Kestrel Capital",
    partner: "Owen Blake",
    thesis: "Climate-adjacent industrials, seed",
    check_size: "$1–2m",
    geography: "US",
    status: "queued",
  },
  {
    id: "inv-5",
    fund: "Glassford Partners",
    partner: "Hannah Reed",
    thesis: "Consumer brands with repeat purchase",
    check_size: "$750k–2m",
    geography: "US",
    status: "identified",
  },
];

export const placeholderReplies: InvestorReply[] = [
  {
    id: "reply-1",
    investor: "Priya Shah",
    fund: "Northline Ventures",
    subject: "Re: Lena Health / Series A",
    preview: "Thanks for sending this through. Worth a conversation next week if you are available.",
    body: "Thanks for sending this through. The traction on provider onboarding is useful context. Worth a conversation next week if you are available — Tuesday or Thursday afternoon ET works on my side.",
    received_at: "2026-08-24T15:41:00.000Z",
    unread: true,
  },
  {
    id: "reply-2",
    investor: "Sofia Alvarez",
    fund: "Elm & River",
    subject: "Re: introduction",
    preview: "I would like to bring a principal to a first call. Can you share the data room link?",
    body: "I would like to bring a principal to a first call. Can you share the data room link and the latest monthly figures? We are focused on Series A healthcare services this quarter.",
    received_at: "2026-08-23T19:12:00.000Z",
    unread: true,
  },
  {
    id: "reply-3",
    investor: "Daniel Cho",
    fund: "Harbor Peak",
    subject: "Re: Lena Health",
    preview: "Not a fit for this fund. Passing along to a colleague who covers provider tools.",
    body: "Not a fit for this fund as we are later-stage on healthcare. Passing along to a colleague who covers provider tools. No need to follow up with me directly.",
    received_at: "2026-08-22T11:08:00.000Z",
    unread: false,
  },
];

export const placeholderCampaigns: Campaign[] = [
  {
    id: "camp-1",
    name: "Series A — healthcare funds",
    status: "active",
    stats: {
      sent: 86,
      opened: 41,
      clicked: 12,
      replied: 7,
      bounced: 2,
      meetings: 2,
    },
  },
  {
    id: "camp-2",
    name: "Series A — family offices",
    status: "paused",
    stats: {
      sent: 24,
      opened: 11,
      clicked: 3,
      replied: 1,
      bounced: 0,
      meetings: 0,
    },
  },
];
