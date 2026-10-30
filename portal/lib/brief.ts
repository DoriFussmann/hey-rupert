// The Company Brief: Rupert's working document for one client, built after
// the intake and refined with Dori in the Framing Room. The founder never
// sees it; they get the narrative, the deck feedback and the questions made
// from it. Pure module (no server code), shared by the server and the admin.
// See claude/rupert-company-brief-spec.md in the project.

// ---------------------------------------------------------------------------
// Topics: the brief summarises the company topic by topic, in the order of a
// classic pitch deck (YC, Sequoia, 500, Guy Kawasaki, Founder Institute).
// Dori controls the list in the admin (on/off, title, guidance); these are
// the defaults. Each topic's guidance tells the AI exactly what to summarise.

export type BriefTopic = { id: string; title: string; guidance: string; enabled: boolean };

export const BRIEF_TOPICS_SLUG = "brief_topics";
export const BRIEF_TOPICS_MAX = 20;

export const DEFAULT_BRIEF_TOPICS: BriefTopic[] = [
  { id: "purpose", title: "Company purpose", guidance: "One sentence: what the company does and for whom. No adjectives.", enabled: true },
  { id: "problem", title: "Problem", guidance: "Whose pain, how often, how they handle it today, and what that costs them (time, money, risk).", enabled: true },
  { id: "solution", title: "Solution", guidance: "What the product does for the customer, the value in their terms, and the insight behind it.", enabled: true },
  { id: "why_now", title: "Why now", guidance: "The specific change (technology, regulation, behaviour, cost) that makes this possible or necessary now, and why it wasn't built before.", enabled: true },
  { id: "market", title: "Market", guidance: "The target customer, how many there are, what each pays, a bottom-up size, the first segment, and the sources. Flag top-down or unsourced figures.", enabled: true },
  { id: "competition", title: "Competition", guidance: "Direct and indirect competitors and the status quo, named, with their funding where known; why customers pick this company.", enabled: true },
  { id: "product", title: "Product", guidance: "What is live today, how it works in a few steps, integrations, and what's next. Mark what is planned versus shipped.", enabled: true },
  { id: "business_model", title: "Business model", guidance: "Who pays, pricing and pricing unit, average contract size, margin and its main costs, how revenue per customer grows.", enabled: true },
  { id: "go_to_market", title: "Go-to-market", guidance: "Channels, sales motion and cycle, pipeline (with stages if known), partnerships.", enabled: true },
  { id: "traction", title: "Traction", guidance: "Revenue (MRR or ARR, what customers actually pay), customers, growth, retention, customer outcomes. Dated, exact numbers.", enabled: true },
  { id: "team", title: "Team", guidance: "Each founder's record as company, role, years and outcome (checked against dates: did the exit happen on their watch?). Key hires, advisors, and the obvious gaps.", enabled: true },
  { id: "financials", title: "Financials", guidance: "Cash, burn and runway if known; projections and whether they follow from the inputs; numbers that don't add up.", enabled: true },
  { id: "round", title: "The round", guidance: "Amount, instrument, valuation or cap, committed and from whom, lead or not, use of funds, milestones it buys, target close.", enabled: true },
  { id: "vision", title: "Vision", guidance: "What the company becomes in five years if it works, as the founder describes it.", enabled: true },
];

const TOPIC_ID = /^[a-z][a-z0-9_]{0,39}$/;

export function topicIdFor(title: string) {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(id) ? id : `t_${id}`.slice(0, 40);
}

/** Saved topics, or null when they can't be used. */
export function parseBriefTopics(value: unknown): BriefTopic[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const topics: BriefTopic[] = [];
  for (const item of value) {
    const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 80) : "";
    if (!title) return null;
    let id = typeof raw.id === "string" && TOPIC_ID.test(raw.id) ? raw.id : topicIdFor(title);
    if (RESERVED_KEYS.includes(id)) id = `${id}_topic`;
    if (seen.has(id)) return null;
    seen.add(id);
    topics.push({
      id,
      title,
      guidance: typeof raw.guidance === "string" ? raw.guidance.trim().slice(0, 1000) : "",
      enabled: raw.enabled !== false,
    });
  }
  return topics.length > 0 && topics.length <= BRIEF_TOPICS_MAX ? topics : null;
}

/** The brief's parts besides the topics. */
const RESERVED_KEYS = ["abstract", "questions"];

export const ABSTRACT_HINT = "5 to 8 bullet points, each written as \"Short title: one line\" (for example \"Founder: former CEO of a collections company\"): what the company is, the strongest facts, the biggest gaps. Short and punchy.";
export const QUESTIONS_HINT = "Only the questions for the founder whose answers would change the pitch. One per line, starting with \"- \".";

/** The keys a brief holds with these topics, in reading order. */
export function briefKeys(topics: BriefTopic[]) {
  return ["abstract", ...topics.filter((topic) => topic.enabled).map((topic) => topic.id), "questions"];
}

export function sectionTitle(key: string, topics: BriefTopic[]) {
  if (key === "abstract") return "Abstract";
  if (key === "questions") return "Questions for the founder";
  return topics.find((topic) => topic.id === key)?.title ?? key.replace(/_/g, " ");
}

export type BriefSections = Record<string, string>;

/** One abstract bullet as a card: "Title: text" splits into its title and text. */
export function abstractCard(bullet: string): { title: string; text: string } {
  const match = bullet.match(/^\*{0,2}([^:*]{2,40}?)\*{0,2}\s*:\s*\*{0,2}\s*(.+)$/);
  return match ? { title: match[1].trim(), text: match[2].trim() } : { title: "", text: bullet };
}

/** The abstract as bullets, one per line. */
export function abstractBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Selling points: Rupert scores a set list of ten for this raise, picks the
// three strongest (Dori can swap) and says what to say about each.

export type SellingPoint = { id: string; title: string; guidance: string };

export const SELLING_POINTS_SLUG = "selling_points";
export const SELLING_POINTS_MAX = 20;

/** The default list. Dori edits it under Agents → Selling points. */
export const SELLING_POINTS: SellingPoint[] = [
  { id: "founder_fit", title: "Founder-market fit and track record", guidance: "The founders have done this before or know this problem from the inside: companies run, outcomes, years in the industry." },
  { id: "traction", title: "Traction", guidance: "Revenue, paying customers, growth or usage that proves demand, stated honestly." },
  { id: "customers", title: "Notable customers", guidance: "Recognisable or strategic customers, pilots or partners that lend credibility." },
  { id: "why_now", title: "Why now", guidance: "A specific change that makes this the moment, which investors can see too." },
  { id: "category_momentum", title: "Category momentum", guidance: "The space is being funded: comparable companies raised recently, so investors are looking." },
  { id: "product_edge", title: "Product or technical edge", guidance: "Something built that is hard to copy: technology, data, integrations, IP." },
  { id: "capital_efficiency", title: "Capital efficiency", guidance: "A lot achieved with little money: product shipped, customers won, on a small budget." },
  { id: "backers", title: "Backers already in", guidance: "Investors, studios, angels or advisors already committed whose names carry weight." },
  { id: "business_model", title: "Business model and unit economics", guidance: "Pricing, contract size, margins or expansion that make the economics attractive." },
  { id: "distribution", title: "Distribution advantage", guidance: "A channel, network or audience that gets customers cheaper or faster than rivals." },
];

export const SELLING_POINTS_CHOSEN = 3;

export type PointScore = { point: string; title: string; score: number; reason: string; pitch: string };

export type SellingPoints = { scores: PointScore[]; chosen: string[]; scored_at: string | null };

/** Saved selling points, or null when they can't be used. */
export function parseSellingPoints(value: unknown): SellingPoint[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const points: SellingPoint[] = [];
  for (const item of value) {
    const raw = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 100) : "";
    if (!title) return null;
    const id = typeof raw.id === "string" && TOPIC_ID.test(raw.id) ? raw.id : topicIdFor(title);
    if (seen.has(id)) return null;
    seen.add(id);
    points.push({ id, title, guidance: typeof raw.guidance === "string" ? raw.guidance.trim().slice(0, 1000) : "" });
  }
  return points.length >= SELLING_POINTS_CHOSEN && points.length <= SELLING_POINTS_MAX ? points : null;
}

export function emptyPoints(): SellingPoints {
  return { scores: [], chosen: [], scored_at: null };
}

export function asPoints(value: unknown): SellingPoints {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const scores: PointScore[] = Array.isArray(raw.scores)
    ? raw.scores
        .map((item) => {
          const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
          const score = Math.round(Number(entry.score));
          return {
            point: typeof entry.point === "string" ? entry.point : "",
            title: typeof entry.title === "string" ? entry.title.slice(0, 100) : "",
            score: Number.isFinite(score) ? Math.min(10, Math.max(0, score)) : 0,
            reason: stripCitations(typeof entry.reason === "string" ? entry.reason.slice(0, 800) : ""),
            pitch: stripCitations(typeof entry.pitch === "string" ? entry.pitch.slice(0, 2000) : ""),
          };
        })
        .filter((item) => TOPIC_ID.test(item.point))
    : [];
  const chosen = Array.isArray(raw.chosen)
    ? Array.from(new Set(raw.chosen.map(String).filter((id) => TOPIC_ID.test(id)))).slice(0, SELLING_POINTS_CHOSEN)
    : [];
  return { scores, chosen, scored_at: typeof raw.scored_at === "string" ? raw.scored_at : null };
}

/** The strongest points by score, ties in list order. */
export function topPoints(scores: PointScore[], count = SELLING_POINTS_CHOSEN) {
  const order = scores.map((item) => item.point);
  return [...scores]
    .sort((a, b) => b.score - a.score || order.indexOf(a.point) - order.indexOf(b.point))
    .slice(0, count)
    .map((item) => item.point);
}

/** The chosen points with what to say, for the narrative. */
export function chosenPointsText(points: SellingPoints) {
  return points.chosen
    .map((id, index) => {
      const score = points.scores.find((item) => item.point === id);
      return score ? `${index + 1}. ${score.title || id.replace(/_/g, " ")}: ${score.pitch || score.reason}`.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

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
  points: SellingPoints;
  deck: DeckFeedback;
  note: string;
  createdBy: string | null;
  createdAt: string;
};

export const SECTION_MAX = 20000;

export function emptySections(): BriefSections {
  return {};
}

export function emptyDeck(): DeckFeedback {
  return { scores: [], chosen: [], writeups: {}, scored_at: null };
}

function str(value: unknown, max: number) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Stored sections: any well-formed key (topics can change), citation markup removed. */
export function asSections(value: unknown): BriefSections {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const sections: BriefSections = {};
  for (const [key, text] of Object.entries(raw)) {
    if (TOPIC_ID.test(key) && typeof text === "string") sections[key] = stripCitations(text.slice(0, SECTION_MAX));
  }
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
export function briefText(sections: BriefSections, topics: BriefTopic[], points?: SellingPoints) {
  const parts = briefKeys(topics).map((key) => `## ${sectionTitle(key, topics)}\n${(sections[key] ?? "").trim() || "(empty)"}`);
  const chosen = points ? chosenPointsText(points) : "";
  if (chosen) parts.splice(1, 0, `## The three strongest selling points (decided)\n${chosen}`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Framing Room: Rupert proposes changes to sections; Dori pins them.

export type BriefProposal = {
  id: string;
  /** "abstract", a topic id, or "questions". */
  section: string;
  /** replace: the section's new full text. append: added at the end. */
  mode: "replace" | "append";
  content: string;
  why: string;
};

export function isSectionKey(value: unknown): value is string {
  return typeof value === "string" && TOPIC_ID.test(value);
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
        content: stripCitations(str(raw.content, SECTION_MAX)).trim(),
        why: stripCitations(str(raw.why, 600)).trim(),
      };
    })
    .filter((item): item is BriefProposal => isSectionKey(item.section) && Boolean(item.content))
    .slice(0, 8);
}

/** The sections after pinning a proposal. */
export function applyProposal(sections: BriefSections, proposal: BriefProposal): BriefSections {
  const current = (sections[proposal.section] ?? "").trim();
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

/** Web search answers can carry citation markup (<cite index="…">…</cite>): keep the text, drop the tags. */
export function stripCitations(value: string) {
  return value.replace(/<\/?cite\b[^>]*>/gi, "").replace(/[ \t]{2,}/g, " ");
}
