/** Topic hubs: one page per core keyword. `name` must match articles' pillarKeyword exactly. */
export const TOPICS = [
  {
    "name": "how to find investors",
    "slug": "finding-investors",
    "pillar": "how-to-find-investors",
    "title": "How to Find Investors: Guides for Startup Founders | Rupert",
    "h1": "Finding investors",
    "description": "Guides for founders on finding the right investors: building an investor list, using databases and CRMs, angels vs. VCs, and investors near you.",
    "intro": "Everything on finding investors who fit your stage, sector and check size, from building a qualified list to choosing between angels and venture capital."
  },
  {
    "name": "investor outreach",
    "slug": "investor-outreach",
    "pillar": "where-to-find-startup-investors-warm-intros-vs-cold-outreach",
    "title": "Investor Outreach Guides: Warm Intros, Cold Email | Rupert",
    "h1": "Investor outreach",
    "description": "How founders reach investors: warm introductions vs. cold outreach, follow-up sequences, and investor updates that keep relationships warm between raises.",
    "intro": "How to reach investors once you know who they are: warm introductions, personalized cold outreach, follow-up, and the updates that keep investors engaged."
  },
  {
    "name": "capital raising services",
    "slug": "capital-raising-services",
    "pillar": "capital-raising-services",
    "title": "Capital Raising Services: Consultants and Fees | Rupert",
    "h1": "Capital raising services",
    "description": "What founders should know before hiring help to raise capital: fundraising consultants, advisors vs. broker-dealers, and what capital raising really costs.",
    "intro": "What to know before you hire help to raise: the types of capital raising services, how consultants and advisors differ, and what they cost."
  },
  {
    "name": "startup funding stages",
    "slug": "funding-stages",
    "pillar": "startup-funding-stages",
    "title": "Startup Funding Stages: Pre-Seed to Series A Guides | Rupert",
    "h1": "Startup funding stages",
    "description": "Guides to each startup funding stage, from pre-seed and seed to Series A: what investors expect, typical round sizes, instruments like SAFEs, and timing.",
    "intro": "What each funding stage looks like, from pre-seed through Series A: what investors expect, which instruments are used, and how to know which round you are ready for."
  },
  {
    "name": "pitch deck",
    "slug": "pitch-deck",
    "pillar": "pitch-deck",
    "title": "Pitch Deck Guides: Templates, Examples, Structure | Rupert",
    "h1": "Pitch decks",
    "description": "How to build a pitch deck investors read: slide-by-slide templates, real examples, seed deck guidance, and how the Sequoia, YC and Kawasaki formats compare.",
    "intro": "How to build a pitch deck that gets read: the slides investors expect, a slide-by-slide template, real examples, and how the main deck formats compare."
  }
] as const;

export type Topic = (typeof TOPICS)[number];

export function topicByName(name: string | undefined): Topic | undefined {
  if (!name) return undefined;
  return TOPICS.find((topic) => topic.name === name.trim());
}
