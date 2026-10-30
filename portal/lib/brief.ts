// The Company Brief: Rupert's working document for one client, built after
// the intake and refined with Dori in the Framing Room. The founder never
// sees it; they get the narrative, the deck feedback and the questions made
// from it. Pure module (no server code), shared by the server and the admin.
// See claude/rupert-company-brief-spec.md in the project.

export const BRIEF_SECTIONS = [
  {
    key: "matching",
    title: "Matching inputs",
    hint: "Sector (core and secondary), stage and round size, HQ, markets, the investor types to target, exclusions.",
  },
  {
    key: "facts",
    title: "Fact sheet",
    hint: "Every pitchable fact with its source. The founder's record as company, role, outcome. Mark what not to use and what is missing.",
  },
  {
    key: "framing",
    title: "Framing",
    hint: "The lead angle, what each investor type hears first, tone, what to hold back.",
  },
  {
    key: "objections",
    title: "Objections and answers",
    hint: "What investors will push on, and the honest answer to each.",
  },
  {
    key: "questions",
    title: "Questions for the founder",
    hint: "Only the ones that change the pitch. One per line, starting with \"- \".",
  },
  {
    key: "fit",
    title: "Fit read",
    hint: "How fundable this is by cold outreach right now, and what to expect.",
  },
] as const;

export type BriefSectionKey = (typeof BRIEF_SECTIONS)[number]["key"];

export const BRIEF_SECTION_KEYS: BriefSectionKey[] = BRIEF_SECTIONS.map((section) => section.key);

export type BriefSections = Record<BriefSectionKey, string>;

// ---------------------------------------------------------------------------
// Deck feedback: a library of topics with a playbook each. Rupert scores the
// deck on every topic, picks the three that matter most (Dori can swap), and
// writes those three for the founder, using the playbook and the deck.

export type DeckTopic = {
  id: string;
  title: string;
  /** What good looks like, the references, the common mistakes and the checklist. Given to the AI. */
  playbook: string;
};

export const DECK_TOPICS: DeckTopic[] = [
  {
    id: "structure",
    title: "Structure",
    playbook: `The point: don't reinvent the wheel. Investors read hundreds of decks in a familiar order; a deck that follows it gets understood, one that doesn't gets skimmed.
Reference structures:
- Sequoia (sequoiacap.com/article/writing-a-business-plan): company purpose (one declarative sentence), problem, solution, why now, market potential, competition and alternatives, business model, team, financials, vision.
- Y Combinator: title and one-liner, problem, solution, traction, market, competition, vision, team, use of funds.
- 500 Startups: elevator pitch, problem, solution, how it works, traction (right after the product if you have it), business model, competition, market, progress to date, team.
- Guy Kawasaki: title, problem or opportunity, value proposition, product, business model, go-to-market, competitive analysis, team, financial projections, use of funds.
- Founder Institute: cover, summary, problem, solution, product, business model, market, competition, growth, traction, financials, team, funding, summary.
Common mistakes: no one-liner on the cover; product before the problem; traction buried at the back; no ask slide; invented section orders.
Checklist: one-liner on slide 1; problem before solution; strongest proof in the first third; an ask at the end; 10 to 15 slides.`,
  },
  {
    id: "investment_thesis",
    title: "No investment thesis",
    playbook: `The point: a deck describes a company; an investor needs a reason to invest. What makes this an interesting investment? What is the insight others miss? Why will this team win, and how big can it get?
Common mistakes: a product description with no "why this is a great investment"; no insight, only a market; the return case left for the investor to imagine.
Checklist: one sentence on the insight; one on why this team wins; one on how big it gets and why now is the time to back it. Put it up front.`,
  },
  {
    id: "problem",
    title: "No clear problem",
    playbook: `The point: what specific problem, for whom? Don't make the investor guess. Describe the pain from the customer's point of view, how they handle it today, and what that costs.
Common mistakes: the problem stated as a market statistic; a vague "inefficiency"; no current workaround described; several problems at once.
Checklist: who feels the pain; how often; what it costs (time, money, risk); today's workaround and why it fails. One problem.`,
  },
  {
    id: "why_now",
    title: "Why now",
    playbook: `The point: the best companies almost always have a clear why now. Nature hates a vacuum: why hasn't this been built before? Name the specific change (technology, regulation, behaviour, cost curve, distribution) that makes it possible or necessary today.
Common mistakes: no why now; "AI" with nothing specific; a trend that has been true for ten years.
Checklist: the change, when it happened, and why it opens the door now and not five years ago or five years from now.`,
  },
  {
    id: "differentiation",
    title: "No differentiation",
    playbook: `The point: why you? Why can't someone else do it? What does this team know, have or do that a well-funded competitor or an incumbent can't easily copy?
Common mistakes: "we're faster, cheaper, better" with no proof; differentiation that is a feature list; nothing about the team's unfair advantage.
Checklist: the one real difference customers care about; the unfair advantage (founder experience, data, distribution, relationships); why it lasts.`,
  },
  {
    id: "competition",
    title: "Competition and moat",
    playbook: `The point: name direct and indirect competitors and the status quo honestly, then show a plan to win and what gets harder to copy over time (data, integrations, distribution, network effects, switching costs).
Common mistakes: "no direct competitors" (never believed); a 2x2 rigged so the company sits alone; a moat asserted, not shown.
Checklist: the real alternatives, including doing nothing or doing it by hand; the reason customers pick you; evidence the moat is building.`,
  },
  {
    id: "evidence",
    title: "Claims without evidence",
    playbook: `The point: stop telling the investor how great things are; show them. Traction, numbers, customers, outcomes, dated and honest. Early companies show the best leading indicator they have and say what it is.
Common mistakes: "proven", "de-risked", "loved by customers" on thin data; charts without dates or axes; pipeline value presented as revenue; list price instead of what customers pay; logos without permission.
Checklist: every claim has a number or a named proof next to it; real numbers with dates; customer outcomes in their terms (cash collected, hours saved); pipeline stages defined.`,
  },
  {
    id: "feature_dumping",
    title: "Feature dumping",
    playbook: `The point: a list of features is not a product strategy. Show the value, not the functionality: what the customer gets, in their terms, and how the product delivers it in a few simple steps.
Common mistakes: slides of feature names; screenshots with no story; roadmap longer than the product.
Checklist: the workflow in three steps; the outcome for the customer; real screenshots or a demo link; what is live today versus planned.`,
  },
  {
    id: "market",
    title: "Market opportunity",
    playbook: `The point: show a credible path to a venture-scale outcome. Not too small, not poorly defined, not inflated with meaningless TAM figures. Bottom-up (number of target customers times what each pays), sourced, with the first segment and the expansion path.
Common mistakes: placeholder numbers; a serviceable market larger than is credible for the geography; unsourced trillion-dollar figures; TAM, SAM, SOM with no method.
Checklist: who the customer is, how many there are, what each pays; sources; first segment; path to a large outcome.`,
  },
  {
    id: "business_model",
    title: "Missing business model",
    playbook: `The point: how do you actually make money? Who pays, how much, and why? Average contract size, gross margin, sales motion and cycle, and how revenue per customer grows.
Common mistakes: no pricing; contract values that don't match the revenue targets; ignoring costs (such as AI usage) that change margins.
Checklist: price and pricing unit; who pays; average contract value; margin and its drivers; sales motion; expansion.`,
  },
  {
    id: "the_ask",
    title: "No clear ask",
    playbook: `The point: what are you raising, how much, and what will the money achieve? The amount, the instrument (SAFE, note or priced), what is committed and from whom, whether a lead is needed, use of funds tied to milestones, and the runway it buys.
Common mistakes: no amount; a use-of-funds pie with no milestones; committed money not mentioned; milestones that don't follow from the money.
Checklist: amount and instrument; committed and lead; use of funds with milestones; months of runway; what the next round needs to show.`,
  },
  {
    id: "financials",
    title: "Bad financials",
    playbook: `The point: numbers that don't add up, unrealistic assumptions and hockey sticks with no explanation kill trust. Projections should follow from inputs an investor can check: customers, contract value, conversion, hiring.
Common mistakes: revenue targets that don't follow from pricing; growth with no driver; costs that ignore the plan; three conflicting scenarios.
Checklist: one clean model; targets recomputed from their inputs; the two or three assumptions that matter, stated; runway and burn.`,
  },
  {
    id: "team",
    title: "Team",
    playbook: `The point: why these people will win this market. Named prior companies, roles and outcomes (exits, acquirers, scale run), and the experience that fits this problem. Gaps addressed honestly.
Common mistakes: no team slide; "multiple exits" without naming them; titles without outcomes; a missing technical co-founder left unaddressed.
Checklist: founders with named companies, roles and outcomes; why this team for this problem; the plan for the obvious gap; advisors only if they matter here.`,
  },
  {
    id: "narrative",
    title: "Inconsistent narrative",
    playbook: `The point: the deck should read as one story, not separate documents stitched together. Each slide answers the question the previous one raised, in one voice, building to the ask.
Common mistakes: slides from different decks; the problem on slide 2 not the one the product solves; a tone that changes halfway; an ending that doesn't follow.
Checklist: read only the slide titles in order; they should tell the whole story. One voice, one problem, one arc to the ask.`,
  },
  {
    id: "consistency",
    title: "Inconsistencies",
    playbook: `The point: numbers, claims, timelines and assumptions that contradict each other across slides. Nothing kills credibility faster.
Common mistakes: different ranges on different slides; targets that don't follow from contract values; use of funds that differs between the deck and the model; dates that don't line up.
Checklist: list every number and date in the deck and check each against the others and the model; one source for each number; fix or remove what disagrees.`,
  },
  {
    id: "verbose",
    title: "Too verbose",
    playbook: `The point: too much text, too many words, too much explaining. Less is more. Get to the point. A slide should make one point that a reader gets in a few seconds.
Common mistakes: paragraphs on slides; three messages per slide; explaining what the chart already shows.
Checklist: one message per slide, in its title; cut every slide's text by half; move detail to an appendix or the conversation.`,
  },
  {
    id: "prioritization",
    title: "No prioritization",
    playbook: `The point: everything seems equally important. It isn't. The deck should make clear what matters most: the one insight, the strongest proof, the biggest risk being solved.
Common mistakes: twelve equally weighted bullet points; the strongest number in small print; every feature and every customer given the same space.
Checklist: rank the points; lead with the strongest; give the most space to what matters most; cut the rest.`,
  },
  {
    id: "ai_slop",
    title: "AI slop",
    playbook: `The point: it reads like the thinking was outsourced to ChatGPT: generic phrasing, buzzwords, balanced-sounding sentences that say nothing specific. Investors notice immediately. Print it, pick up a pen, think, rewrite. AI is not a substitute for intellectual work.
Signs: "revolutionizing", "seamless", "leveraging cutting-edge AI", "empower", triplets of adjectives, every sentence the same length, no specific numbers, names or opinions.
Checklist: replace every generic sentence with a specific fact, number or opinion only this founder could write; read it aloud; if it could describe any company, rewrite it.`,
  },
  {
    id: "design_substance",
    title: "Pretty but meaningless",
    playbook: `The point: beautiful slides don't compensate for weak thinking. Substance before design. Design should make the point clearer, not decorate it.
Common mistakes: stock images instead of evidence; animated diagrams with no data; visual polish on slides that make no point.
Checklist: for each slide, ask what the reader should conclude; if the design doesn't help that, simplify; replace decoration with a number, a quote or a screenshot.`,
  },
  {
    id: "cold_read",
    title: "Doesn't work without you",
    playbook: `The point: in investor outreach the deck is read cold, usually in under three minutes, with no founder in the room to explain. It must stand on its own.
Common mistakes: slides that only make sense with a voice-over; jargon and acronyms; no contact details; placeholders and template leftovers; a file too large to open on a phone.
Checklist: give it to someone who doesn't know the company for two minutes, then ask what it does, for whom, and what you're raising; add contact details on the last slide; remove placeholders; send a PDF under 10 MB.`,
  },
];

export const DECK_TOPIC_IDS = DECK_TOPICS.map((topic) => topic.id);

export function deckTopic(id: string) {
  return DECK_TOPICS.find((topic) => topic.id === id) ?? null;
}

/** How much a topic needs work in this deck: 0 (fine) to 10 (most important to fix). */
export type DeckScore = { topic: string; score: number; reason: string };

export type DeckFeedback = {
  scores: DeckScore[];
  /** The topics chosen for the founder, at most three. */
  chosen: string[];
  /** What Rupert writes for each chosen topic (markdown). */
  writeups: Record<string, string>;
  scored_at: string | null;
};

export const DECK_TOPICS_PER_CLIENT = 3;

/** The top three topics by score, most in need first. */
export function topTopics(scores: DeckScore[], count = DECK_TOPICS_PER_CLIENT) {
  return [...scores]
    .filter((item) => deckTopic(item.topic))
    .sort((a, b) => b.score - a.score || DECK_TOPIC_IDS.indexOf(a.topic) - DECK_TOPIC_IDS.indexOf(b.topic))
    .slice(0, count)
    .map((item) => item.topic);
}

/** The chosen topics' writeups as one markdown document, in the order chosen. */
export function deckFeedbackMarkdown(deck: DeckFeedback) {
  return deck.chosen
    .map((id, index) => {
      const topic = deckTopic(id);
      const body = (deck.writeups[id] ?? "").trim();
      return topic && body ? `### ${index + 1}. ${topic.title}\n\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// The brief as stored: one row per version.

export type CompanyBrief = {
  version: number;
  sections: BriefSections;
  deck: DeckFeedback;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

export const SECTION_MAX = 20000;

export function emptySections(): BriefSections {
  return Object.fromEntries(BRIEF_SECTION_KEYS.map((key) => [key, ""])) as BriefSections;
}

export function emptyDeck(): DeckFeedback {
  return { scores: [], chosen: [], writeups: {}, scored_at: null };
}

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function asSections(value: unknown): BriefSections {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const sections = emptySections();
  for (const key of BRIEF_SECTION_KEYS) sections[key] = str(raw[key], SECTION_MAX);
  return sections;
}

export function asDeck(value: unknown): DeckFeedback {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const scores: DeckScore[] = Array.isArray(raw.scores)
    ? raw.scores
        .map((item) => {
          const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const score = Math.round(Number(entry.score));
          return {
            topic: str(entry.topic, 60),
            score: Number.isFinite(score) ? Math.min(10, Math.max(0, score)) : 0,
            reason: str(entry.reason, 600),
          };
        })
        .filter((item) => deckTopic(item.topic))
    : [];
  const chosen = Array.isArray(raw.chosen)
    ? Array.from(new Set(raw.chosen.map((id) => str(id, 60)).filter((id) => deckTopic(id)))).slice(0, DECK_TOPICS_PER_CLIENT)
    : [];
  const writeupsRaw = (raw.writeups && typeof raw.writeups === "object" ? raw.writeups : {}) as Record<string, unknown>;
  const writeups: Record<string, string> = {};
  for (const [id, body] of Object.entries(writeupsRaw)) if (deckTopic(id)) writeups[id] = str(body, SECTION_MAX);
  return { scores, chosen, writeups, scored_at: str(raw.scored_at, 40) || null };
}

/** The questions section as a list: one question per "- " line (or per line). */
export function briefQuestions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 3)
    .slice(0, 12);
}

/** The brief as text, for the AI calls that read it. */
export function briefText(sections: BriefSections) {
  return BRIEF_SECTIONS.map((section) => `## ${section.title}\n${sections[section.key].trim() || "(empty)"}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// Framing Room: Rupert proposes changes to sections; Dori pins them.

export type BriefProposal = {
  id: string;
  section: BriefSectionKey;
  /** replace: the section's new full text. append: added at the end. */
  mode: "replace" | "append";
  content: string;
  why: string;
};

export function isSectionKey(value: unknown): value is BriefSectionKey {
  return typeof value === "string" && (BRIEF_SECTION_KEYS as string[]).includes(value);
}

export function asProposals(value: unknown): BriefProposal[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        id: str(raw.id, 40) || `p${index + 1}`,
        section: raw.section,
        mode: raw.mode === "append" ? "append" : "replace",
        content: str(raw.content, SECTION_MAX).trim(),
        why: str(raw.why, 600).trim(),
      };
    })
    .filter((item): item is BriefProposal => isSectionKey(item.section) && Boolean(item.content))
    .slice(0, 8);
}

/** The sections after pinning a proposal. */
export function applyProposal(sections: BriefSections, proposal: BriefProposal): BriefSections {
  const current = sections[proposal.section].trim();
  const next =
    proposal.mode === "append" && current ? `${current}\n\n${proposal.content.trim()}` : proposal.content.trim();
  return { ...sections, [proposal.section]: next.slice(0, SECTION_MAX) };
}

export type FramingMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposals: BriefProposal[];
  /** Ids of proposals already pinned. */
  pinned: string[];
  attachments: { name: string; path: string; size: number; type: string }[];
  createdBy: string | null;
  createdAt: string;
};

/** A question Rupert asked the founder with the narrative, and their answer. */
export type FounderQuestion = { id: string; question: string; answer: string; answeredAt: string | null };
