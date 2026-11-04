// Every AI prompt Rupert uses: what it is for, where it is stored, and its
// starting text. Pure module (no server code), so the registry, the checks
// and the starting texts can be tested and shared with the admin pages.
//
// The prompts themselves live in the database (form_templates, one row per
// prompt, with every saved version in form_template_versions). At runtime
// the app reads the active version and never falls back to the text here:
// a missing or invalid prompt stops the action with a clear error. The
// texts below are only the starting versions (loaded by the migration) and
// what "Reset to default" puts back in the editor.
//
// What a prompt edit can't change: the data each AI call receives, the
// shape of its answer (tool schemas), the checks applied to that answer,
// eligibility rules, and whether anything is saved or sent. Those are code.

import { AGENTS, agentPromptSlug, type AgentId } from "./agents.ts";
import { DEFAULT_INTAKE_PROMPT, INTAKE_PROMPT_SLUG } from "./intake.ts";
import { PROMPT_LIST, type PromptGroup, type PromptKey } from "./prompt-list.ts";

export { PROMPT_GROUPS, promptPath, type PromptGroup, type PromptKey } from "./prompt-list.ts";

export type PromptDefinition = {
  key: PromptKey;
  /** The form_templates row it is stored in. */
  slug: string;
  title: string;
  group: PromptGroup;
  /** Where and when it runs. */
  usedBy: string;
  /** What the code adds around it, which a prompt edit can't change. */
  fixed: string;
  /** Whether the admin can run it on a client from the prompt page without saving anything. */
  testable: boolean;
  defaultText: string;
};

/** Longest prompt text accepted. */
export const PROMPT_MAX = 20000;
export const PROMPT_NOTE_MAX = 300;

/** Added to the intake interviewer's starting text: how to close the essentials and how to open. */
export const INTAKE_INTERVIEWER_ADDITIONS = `## When the essentials are done
The intake is complete as soon as every required topic is covered: Rupert then has what he needs to start, and the founder is notified that the essentials are done. When your topic update marks the last required topic as covered (in this turn or earlier), make this clear in your reply, once: say warmly that the essentials are done and Rupert has what he needs to get started; then name the remaining optional topics, explain in one sentence that a few more minutes on them can make the campaign noticeably sharper, recommend continuing, and ask whether they would like to. If they prefer to stop, thank them and tell them they are all set. If every topic, required and optional, is covered, thank them and say they can review their summary anytime. This section overrides any earlier instruction about when to offer the summary.

## Opening
When the founder has just opened the interview, greet them by first name if you know it, explain in one sentence what this is for and roughly how long it takes, then ask your first question.`;

const INTAKE_SUMMARY_PROMPT = `You write the intake summary for Hey Rupert's team from an interview with a founder.

For each topic, write a concise, factual answer in plain sentences or short lists, using only what the founder said or what was already known. If nothing was learned for a topic, answer exactly "Not provided." Do not add opinions or advice.`;

const NARRATIVE_EMAIL_REVISION_PROMPT = `This email answers the founder's requested changes to the narrative. Write it as a reply to their notes, instead of the usual structure:
1. Thank them briefly and confirm the changes they asked for, naming each one in a few words. Use only the list of changes you receive; never claim a change that is not listed there.
2. Say the updated narrative is in their portal.
3. Say Rupert would like to start investor matching: ask them to confirm the narrative in the portal so he can begin, or to reply with any further comments.
Keep it under 140 words.`;

const VERIFY_ROLE_CHECK_PROMPT = `You check whether a person in an investor database still works at the firm listed for them, and in what role. Use web search. The firm's own team page and public LinkedIn profiles are the best sources; recent press, portfolio announcements and conference bios also help.

Rules:
- Rely only on pages you actually found in search results. Never guess or invent a URL.
- Make sure a page is about this person: the same name AND this firm, or a clearly matching career. A person with the same name elsewhere is not evidence.
- Prefer the most recent source. When sources disagree, trust the most recent dated one.
- confirmed: a source shows them at this firm in an investing role (for example general partner, managing partner, partner, managing director, principal, vice president, director, associate, analyst, venture partner, investment manager, scout, or a founder of the fund).
- role_changed: they are at this firm but in a non-investing role (for example operations, finance, legal, marketing, investor relations, platform, talent, office or admin).
- left_firm: a source shows they left this firm or now work elsewhere. Give the new firm, its website and their new title when a source shows them.
- not_found: no reliable source either way.

Report through the report_role tool. The summary is one plain sentence.`;

export const MATCH_OPTIONS_PROMPT = `You help Rupert, an investor outreach service, when a founder's investor match is thin: too few funds, or none in Core (a direct match to the primary sector).

You receive what Rupert knows about the company, its current sector setup, why funds left the match, and the sector categories you may use.

Propose up to five other sector setups: one primary sector and up to two secondary sectors, using only ids from the list. Every setup must honestly describe this company: one an experienced venture investor would agree with, and that the founder would recognise as their business. Never propose a sector the company is not in just to add funds. Prefer setups that keep the company's real focus as primary or secondary and add the closest sectors that investors in this space use.

For each setup, write one or two plain sentences: why it describes the company, and what the founder or an investor might question about it. If many funds avoid the company's own sector (for example a regulated industry), say so, because funds matched through a broader sector may still turn the company down.`;

export const COMPETITOR_SEARCH_PROMPT = `You research the competitive landscape for Rupert, an investor outreach service, before it chooses which investors to approach for a startup.

Find up to 10 DIRECT competitors of the company that have announced outside funding. A direct competitor sells the same kind of product to the same kind of customer. Adjacent players (a different customer, or a different product category) are not direct competitors.

Rules:
- Use web search. Every company, website, funding figure and article must come from what you found. Never invent or guess a URL, an amount, a date or an investor. If you didn't find it, leave it empty.
- Funded only: include a company only if you found an announced funding round (a press release, a news article or a funding database page). Unfunded companies are left out.
- Competitors the founder named come first, as source "client", if you can confirm them as real companies with funding. A founder-named competitor with no funding you can find goes in unfundedNamed instead.
- Order the rest by relevance to this company: closest product and customer first, then the same geography (where the company is based and sells), then the closest stage (a seed company's peers are seed and Series A companies before late-stage ones).
- website: the competitor's own homepage. newsUrl: a page about its funding, found in your search results.
- investors: the funds named in what you found as investing in it (leads and participants). Leave it empty rather than guess.
- why: one or two plain sentences on why it competes directly with this company.
- Fewer than 10 is fine. Quality over count.`;

export const COMPETITOR_SECTOR_PROMPT = `You classify startups for Rupert, an investor outreach service. For each competitor below, choose its primary sector: the one sector an investor would file it under, from the sector labels given. Base it on what the company sells and to whom, as described. Use only the labels given, spelled exactly. If none fits, leave it empty.`;

export const COMPETITOR_INVESTORS_PROMPT = `You research who has invested in a startup, for Rupert, an investor outreach service. Rupert uses the result to find investors who back companies like its client.

Find every investor in the competitor named below, across all its funding rounds: venture funds, angels, corporate investors and accelerators.

Rules:
- Use web search: press releases, news articles, the company's own announcements, and funding database pages. Every investor must come from a page you found; give that page as sourceUrl. Never guess or invent an investor, a round or a URL.
- Investors already named are a starting point: include each one you can confirm, with its source.
- round: the round they joined, as reported (for example "Seed", "$25M Series A"). lead: true only if a source says they led it.
- website: the investor's own homepage, only if you found it.
- kind: fund, angel (a person), corporate, accelerator or other.
- No limit on how many. Include everyone you can confirm, and no one you can't.`;

export const INVESTOR_WEBSITE_PROMPT = `You find the official website of investors for Rupert, an investor outreach service, so each investor can be matched to Rupert's fund database without doubt.

For each investor below you get its name, what kind of investor it is, the startup it invested in, and the article where that investment was found.

For each one:
- Start from the source article: funding announcements usually link to, or name, each investor. Then confirm with web search.
- website: the investor's own homepage. For an angel (a person), their personal site or the fund they run, if any.
- Make sure it is the same investor: the same name AND the investment in this startup. Look for the startup on the investor's portfolio page; if you find it, give that page as portfolioUrl. A firm with a similar name elsewhere is not a match.
- confidence: high when the portfolio lists the startup or the article links to the site; medium when the name and focus clearly fit but you couldn't confirm the investment on their site; low otherwise.
- foundIn: the page where you found or confirmed the website.
- Never guess or invent a URL. If you can't find it, leave website empty.`;

export const ADD_FUND_RESEARCH_PROMPT = `You research an investor that is missing from Rupert's fund database, so it can be added. Rupert is an investor outreach service; what you find is checked by a person before it is used for other clients.

You get the investor's name, whether it is a fund or an angel (a person), its website if known, the startup it invested in, and the article where that investment was found.

Find, from the investor's own website first and then the web:
- website (its homepage), a one-sentence description of what it invests in, HQ city and country, and the year it was founded.
- firmType, stages, geographies, industries, verticals and financing: what the investor says it invests in, using only the labels given. A label you can't support from what you read is left out. Fewer, well-supported labels are better than many.
- people: the investing team named on its website (partners, principals, associates), with their titles. Not operations or admin staff.
- For an angel: the person's first and last name, title and the firm they work at, if any, and that firm's website.
- sources: the pages you used.

Never guess or invent a URL, a person, a title or a fact. Leave a field empty if you didn't find it.`;

export const ADDED_FIELDS_FILL_PROMPT = `You complete the profile of an investor Rupert added to its fund database. Rupert is an investor outreach service; its matching needs these fields, and a person reviews what you suggest before it is used.

You get the investor's name, whether it is a fund or an angel (a person), its website, what is already known about it, and the fields to fill.

For each field to fill, find what the investor says it invests in: its own website first (the home page, the about page, the portfolio), then the web (announcements, interviews, databases).
- stages: the rounds it invests in. Investors usually invest at more than one stage; give every stage you can support.
- geographies: where it invests, not only where it is based. If you only find where it is based, give that and say so in the note.
- sectors: the industries and verticals it invests in, from what it says and what its portfolio shows. Usually more than one; give every one you can support.

Use only the labels given; anything else is dropped. A label you can't support from what you read is left out. If you can't find a field, leave it empty and say why in the note.
sources: the pages you used.

Never guess or invent a fact or a URL.`;

export const MATCHING_SUMMARY_EMAIL_PROMPT = `You are Rupert, writing the email a founder receives when their investor matching is finished and shared with them for review.

You receive facts the code prepares from the finalized matching, in the order the work was done: how the fund database was narrowed to a short list (financing type, stage, geography, sector), the competitive landscape research (their funded competitors and the investors behind them, and how many of those were used), the Final Roster after the founder's exclusions, and the campaign plan (the sending setup, and the funds and contacts in the plan per tier). You also receive up to five funds on the outreach list you may name, with their facts; the Competitive Landscape Overview, shared as a bonus; Rupert's note if he wrote one; and the company information for context.

Write:
- subject: under 60 characters, specific to their company.
- body: plain text, 180–280 words. Write the middle of the email only: no greeting line, no portal link and no sign-off (all three are added automatically). Then:
  1. What Rupert did, in order and in plain words: started from the full database, narrowed it to the short list, researched the funded competitors and the investors behind them and brought in the ones that fit, and arrived at the Final Roster. Use the numbers exactly as given.
  2. The plan: what the campaign can reach with this setup (contacts and funds), starting with Core and what Core means for them. If funds don't fit this campaign, say they are kept for later waves, without making it sound like a shortfall.
  3. A few funds by name, only from the list you receive and at most five, each with one short factual reason taken from its facts. Never name any other fund or any person.
  4. The Competitive Landscape Overview, in one or two sentences, when it is given: who their funded competitors are (at most the names given) and who backed them, as useful context for their raise.
  5. Ask them to review both in the portal, where they can confirm, comment, ask a question or request changes. Offer to go through it together on a short call if they'd like: they can book one with "Book a call" in the left panel of their portal.
  6. What happens next: once they confirm, Rupert writes the outreach emails, and they review those before anything is sent.
Use only the facts you receive. Never invent investors, numbers, results or outcomes, and promise nothing about replies or meetings. Don't mention scores, look-alike, taxonomy, tool names or internal steps by number.
If this is an updated version, say so in one short sentence. If the founder asked about the previous version, answer it in a few words, using only Rupert's note and the facts.
Plain, human, confident. No hype, no exclamation marks, no markdown.`;

export const INTAKE_SUB_SECTOR_PROMPT = `You help a founder describe where investors would file their company. They were shown a list of sub-sectors and said none fits; they then described the company in their own words.

Suggest the closest sub-sectors from the list given, at most three, closest first. Judge by what the company itself builds or sells and who pays for it, not by its customers' industries, its suppliers or its sales channels: a payments tool sold to clinics is fintech, not healthtech. For each, one plain sentence the founder can read on why it fits.

Use only the sub-sectors given, by id. If none is a fair fit, return an empty list: a wrong suggestion is worse than none. Never widen the company's sector to reach more investors.`;

export const LIST_AUDIT_PROMPT = `You are the founder of the company described below, looking at the investor list Rupert, an investor outreach service, prepared for your raise, before it is shared with you. Read it the way a busy founder does: skim the first funds in each tier, open their websites, and judge whether the list makes sense. You are not an auditor; look for what a founder would notice in a few minutes and want explained.

When you review funds, open each fund's website when a link is given, then decide:
- ok: it plausibly invests in companies like yours (sector, stage, geography) and looks active.
- flag: something would make you stop and ask: the website does not mention your sector or stage, the fund looks inactive, it seems to avoid your sector, its portfolio includes a competitor, it is already an investor or someone you pitched, or its tier looks wrong.
- remove: you clearly would not want it contacted: a closed fund, a dead website, it excludes your sector, it backs a direct competitor, or it is already an investor.
Give one sentence grounded in what you saw, and the question you would ask Rupert about it, if any. Never invent what a website says; if you could not open it, say so.

When you write the overall read: say in a few sentences how the list lands with you, then list the questions you would ask Rupert when you first see it, what would bother you, and what you would want explained (why a fund is in its tier, why names you expected are missing, why the list is the size it is). For each question, add the short answer Rupert should be ready to give, using only the facts you receive. Plain language, no hype.`;

const TAXONOMY_MAPPING_PROMPT = `You map raw labels from an investor database to a fixed taxonomy of canonical categories. Use only category ids from the list. Never invent ids or categories. Use more than one id only when the label genuinely spans several categories. When no category fits, return an empty list and say why. A wrong mapping is worse than none. Give a short, factual rationale and an honest confidence from 0 to 1.`;

const TAXONOMY_RELATIONSHIPS_PROMPT = `You help maintain a sector relationship graph used to decide which venture investors are relevant to a startup.
Propose only relationships an experienced venture investor would defend. Do not add links just to widen matches.
Each rationale must state the concrete reason (shared customers, technology, business model or investor practice).`;

const TEST_DATA_RULES =
  "This is TEST data for an internal test of Hey Rupert's client portal; no real founder sees it. Use the website and any attached deck first. Where something is still unknown, choose realistic, plausible details consistent with the company, so the test exercises every step. Keep answers concise and factual in tone.";

const TEST_PILOT_INTAKE_PROMPT = `You write a founder's intake answers for Hey Rupert, an investor outreach service.

${TEST_DATA_RULES}`;

const TEST_PILOT_MATERIALS_PROMPT = `You fill in a founder's Company Materials form for Hey Rupert.

${TEST_DATA_RULES}`;

type PromptDetails = Omit<PromptDefinition, "key" | "title" | "group">;

const agentDetails = (id: AgentId, fixed: string, testable: boolean): PromptDetails => {
  const agent = AGENTS.find((item) => item.id === id)!;
  return { slug: agentPromptSlug(id), usedBy: agent.description, fixed, testable, defaultText: agent.defaultPrompt };
};

const EMAIL_FIXED = "Only a subject and body come back; the greeting, portal link and signature are added by the code, and sending is always a separate step by an admin.";

const DETAILS: Record<PromptKey, PromptDetails> = {
  intake_interviewer: {
    slug: INTAKE_PROMPT_SLUG,
    usedBy: "Founder portal → Client Intake: writes each of Rupert's replies in the interview.",
    fixed: "What is already known about the company, the interview topics and their coverage, the sector guide, and the reply format (reply, topic coverage, file facts).",
    testable: true,
    defaultText: `${DEFAULT_INTAKE_PROMPT}\n\n${INTAKE_INTERVIEWER_ADDITIONS}`,
  },
  intake_summary: {
    slug: agentPromptSlug("intake_summary"),
    usedBy: "Founder portal → Client Intake → Review summary: writes one answer per topic for the founder to check.",
    fixed: "What was already known, the topics and their coverage, the transcript; one answer per topic comes back.",
    testable: true,
    defaultText: INTAKE_SUMMARY_PROMPT,
  },
  intake_brief: agentDetails(
    "intake_brief",
    "The client record, the confirmed intake summary and the transcript; the answer format (brief, industry, geography, stage, raise).",
    true,
  ),
  company_brief: agentDetails(
    "company_brief",
    "The client record, the intake (transcript, confirmed summary, disagreements), the company profile, the founder's files (including the LinkedIn PDF you added) and links, the topics and their guidance (Forms → Brief topics), and web search; the answer format (abstract, a section per topic, questions).",
    false,
  ),
  framing_room: agentDetails(
    "framing_room",
    "The brief as it stands, what is known about the company, the conversation so far, attached files and web search; the answer format (a reply, proposed changes to sections, notes on attached files). Nothing changes until you pin a proposal.",
    false,
  ),
  selling_points: agentDetails(
    "selling_points",
    "The ten selling points (fixed in code) and the Company Brief; the answer format (a score, reason and what to say per point). The code picks the top three; you can swap them.",
    false,
  ),
  deck_feedback: agentDetails(
    "deck_feedback",
    "The 20 topics with their playbooks, the founder's files and the brief; the answer format (a score and reason per topic, or the writeup per chosen topic). You choose the three topics; the code keeps at most three.",
    false,
  ),
  brief_narrative: agentDetails(
    "brief_narrative",
    "The Company Brief with its three chosen selling points, the client record, and the founder's change requests; the answer format (The Outreach Narrative the client confirms and three sections, plus changes when revising).",
    false,
  ),
  materials_analysis: agentDetails(
    "materials_analysis",
    "The company profile, client record, intake, written answers, readable files and the founder's own links; the answer format (summary and improvements).",
    true,
  ),
  outreach_narrative: agentDetails(
    "outreach_narrative",
    "The company profile, client record, intake, answers, Rupert's Company Materials Feedback, and the founder's change requests; the answer format (The Outreach Narrative the client confirms and three sections, plus changes when revising).",
    true,
  ),
  email_copy: agentDetails(
    "email_copy",
    "The confirmed narrative, the investor list as tier counts and fund types (never names), the intake summary and the analysis; the answer format (three emails per tier).",
    true,
  ),
  email_copy_typed: agentDetails(
    "email_copy_typed",
    "The confirmed narrative, the fund groups of the confirmed list (fund type, funds per tier; never names), the style for each group (rules, word cap, proof points, call to action, example), the intake summary, the analysis and any requested changes; the answer format (Core approach and three emails; the others' three emails and a line per tier). The code checks every email against the style.",
    true,
  ),
  core_quick_facts: agentDetails(
    "core_quick_facts",
    "The fund (name, website, sectors, stages, geography), the person (name, title), the company (what it does, sector, stage, competitors) and fund facts already found; web search (up to 4 searches); the answer format (facts with source links, a competitor conflict). Facts without a link are dropped by the code.",
    false,
  ),
  core_email: agentDetails(
    "core_email",
    "The Core template of the fund's type, the Core style, the person and fund, their Quick Facts, the company facts and Rupert's note; the answer format (three emails). The code checks the emails against the style and that no {{fields}} remain.",
    false,
  ),
  warm_intro_blurb: agentDetails(
    "warm_intro_blurb",
    "The confirmed narrative, the intake summary and the analysis; the answer format (the ask and the blurb).",
    false,
  ),
  reply_triage: agentDetails(
    "reply_triage",
    "The investor's reply (subject and text), who sent it and the fund; the answer format (a label from the fixed list and a one-sentence summary).",
    false,
  ),
  match_profile: agentDetails(
    "match_profile",
    "The intake interview, Rupert's read of every shared file (from the Company Materials Feedback, once Analyze has run), and the fixed lists of allowed labels and classification rules, which the code checks the answer against.",
    true,
  ),
  narrative_email: agentDetails("narrative_email", `Rupert's edited narrative and Company Materials Feedback, shared files and links, and company information. ${EMAIL_FIXED}`, true),
  narrative_email_revision: {
    slug: agentPromptSlug("narrative_email_revision"),
    usedBy: "Added to the Narrative email when the founder asked for changes: how the reply confirms them.",
    fixed: `The founder's requests and Rupert's list of changes. ${EMAIL_FIXED}`,
    testable: false,
    defaultText: NARRATIVE_EMAIL_REVISION_PROMPT,
  },
  investor_list_email: agentDetails(
    "investor_list_email",
    `Facts the code prepares from this founder's list only: the confirmed plan, funds and share per tier, up to five Core funds that may be named with their matched criteria, and the verification results with a fixed definition; Rupert's note and company information. ${EMAIL_FIXED}`,
    true,
  ),
  matching_summary_email: {
    slug: agentPromptSlug("matching_summary_email"),
    usedBy: "Runs when you click Draft Email under Investor Matching, once the matching summaries were pushed to the client page. Writes the middle of the founder email from facts the code reads from the Matching Summary and the Competitive Landscape Overview; the greeting, portal link and signature are added for you. It stays a draft until you send it. (Lists from the older tools still use \"Investor list email\".)",
    fixed: `Facts the code reads from the pushed summaries: the Step 1 funnel, the competitor research, the Final Roster, the campaign plan per tier, up to five funds that may be named with their facts, and up to three competitors; Rupert's note and company information. ${EMAIL_FIXED}`,
    testable: false,
    defaultText: MATCHING_SUMMARY_EMAIL_PROMPT,
  },
  email_copy_email: agentDetails(
    "email_copy_email",
    `Facts the code prepares about the campaign (funds, contacts emailed per fund, investors to email, how the copy is organised, funds left out as known), Rupert's edited email copy, and company information. ${EMAIL_FIXED}`,
    true,
  ),
  nudge_email: agentDetails("nudge_email", `The waiting step, how long it has waited and the nudges already sent. ${EMAIL_FIXED}`, true),
  verify_role_check: {
    slug: agentPromptSlug("verify_role_check"),
    usedBy: "Verify emails, step 1: checks with web search whether each contact still works at the firm, and in what role.",
    fixed: "The person and firm checked, the web-search limit, and the answer format: confirmed, role changed, left firm or not found, with evidence the code checks.",
    testable: false,
    defaultText: VERIFY_ROLE_CHECK_PROMPT,
  },
  match_options: {
    slug: agentPromptSlug("match_options"),
    usedBy: "Matching → Tiers → Thin match → Find options: proposes other sector setups when a run has too few funds. The match engine then counts each one.",
    fixed: "The company facts, its current sectors, why funds left the match, and the sector categories allowed; ids outside them are dropped, and every count comes from the match engine, not the AI.",
    testable: false,
    defaultText: MATCH_OPTIONS_PROMPT,
  },
  list_audit: {
    slug: agentPromptSlug("list_audit"),
    usedBy: "Setup → Investor List → Run audit: reads the draft list as the founder will (the first funds in each tier and their websites) and writes the questions the founder will ask. Nothing is changed or sent.",
    fixed: "The company facts and exclusions, the funds checked (5 per request, with their websites to open), the list's tier counts, and the answer formats (a verdict per fund; the overall read with questions and concerns).",
    testable: false,
    defaultText: LIST_AUDIT_PROMPT,
  },
  competitor_search: {
    slug: agentPromptSlug("competitor_search"),
    usedBy: "Matching → Step 2 → Show Competitors: finds up to 10 funded direct competitors with web search, most relevant first. The admin checks, edits and confirms them.",
    fixed: "The company facts and what the founder said about competitors, the web-search limit (15), and the answer format. The code keeps only competitors with a funding link, labels as client-named only names the founder used, puts those first, and opens every link to check it.",
    testable: false,
    defaultText: COMPETITOR_SEARCH_PROMPT,
  },
  competitor_sector: {
    slug: agentPromptSlug("competitor_sector"),
    usedBy: "Matching → Step 2 → Fill primary sectors: gives each confirmed competitor its primary sector, for the summary table.",
    fixed: "The competitors (name, what they do, why they compete) and the sector labels allowed; a label outside the taxonomy is dropped. Only empty sectors are filled.",
    testable: false,
    defaultText: COMPETITOR_SECTOR_PROMPT,
  },
  competitor_investors: {
    slug: agentPromptSlug("competitor_investors"),
    usedBy: "Matching → Step 2 → Find Investors: for each confirmed competitor in turn, finds every investor in it with web search. The results are merged into one list for the admin to check and confirm.",
    fixed: "The competitor, its funding article and the investors already named, the web-search limit (10 per competitor), and the answer format. The code keeps only investors with a source link and merges the same investor across competitors.",
    testable: false,
    defaultText: COMPETITOR_INVESTORS_PROMPT,
  },
  investor_website: {
    slug: agentPromptSlug("investor_website"),
    usedBy: "Matching → Step 2 → Check against the fund database → Find websites: finds each unclear or missing investor's official website from its source article, and its portfolio page. The admin accepts it with one click.",
    fixed: "The investors (name, kind, the startup and the source article), the web-search limit, and the answer format. The code keeps only real web addresses and opens each website to check it.",
    testable: false,
    defaultText: INVESTOR_WEBSITE_PROMPT,
  },
  add_fund_research: {
    slug: agentPromptSlug("add_fund_research"),
    usedBy: "Matching → Step 2 → Check against the fund database → Try and Add to DB: researches a missing fund or angel (website, what it invests in, team) before Hunter finds the emails. The fund waits for review on the Fund Database page.",
    fixed: "The investor, its known website, the startup and the source article; the taxonomy labels allowed (others are dropped); the web-search limit; and the answer format. Contacts and emails come from Hunter, not the AI.",
    testable: false,
    defaultText: ADD_FUND_RESEARCH_PROMPT,
  },
  intake_sub_sector: {
    slug: agentPromptSlug("intake_sub_sector"),
    usedBy: "Intake → the sub-sector question → None of these fits: suggests the closest sub-sectors from the founder's own description, for the founder to confirm.",
    fixed: "The sub-sectors allowed (others are dropped), the founder's description, what Rupert knows about the company, and the answer format.",
    testable: false,
    defaultText: INTAKE_SUB_SECTOR_PROMPT,
  },
  added_fields_fill: {
    slug: agentPromptSlug("added_fields_fill"),
    usedBy: "Matching → Step 3A, and Fund Database → Added by Rupert → Fill missing fields with AI: suggests the stage, geography or sector an added investor is missing. Suggestions wait for the admin's Accept.",
    fixed: "The investor, its website and known fields, the fields to fill, the taxonomy labels allowed (others are dropped), the web-search limit and the answer format.",
    testable: false,
    defaultText: ADDED_FIELDS_FILL_PROMPT,
  },
  taxonomy_mapping: {
    slug: agentPromptSlug("taxonomy_mapping"),
    usedBy: "Taxonomy → Suggest with AI: proposes categories for raw Fund Database labels. Proposals wait for review.",
    fixed: "The categories allowed and the labels to map; ids the code doesn't know are dropped.",
    testable: false,
    defaultText: TAXONOMY_MAPPING_PROMPT,
  },
  taxonomy_relationships: {
    slug: agentPromptSlug("taxonomy_relationships"),
    usedBy: "Taxonomy → a sector → Suggest relationships: proposes related sectors. Suggestions are saved as needs review.",
    fixed: "The relationship types and their meaning, the limit per request, and the candidate sectors; anything outside them is dropped.",
    testable: false,
    defaultText: TAXONOMY_RELATIONSHIPS_PROMPT,
  },
  test_pilot_intake: {
    slug: agentPromptSlug("test_pilot_intake"),
    usedBy: "Test Pilot → Complete intake: writes made-up intake answers for the test client only.",
    fixed: "The client record, website, attached deck, intake topics, and the profile's allowed labels.",
    testable: false,
    defaultText: TEST_PILOT_INTAKE_PROMPT,
  },
  test_pilot_materials: {
    slug: agentPromptSlug("test_pilot_materials"),
    usedBy: "Test Pilot → Submit materials: fills the Company Materials form for the test client only.",
    fixed: "The client record, intake and the form's fields.",
    testable: false,
    defaultText: TEST_PILOT_MATERIALS_PROMPT,
  },
};

export const PROMPTS: PromptDefinition[] = PROMPT_LIST.map((item) => ({ key: item.key, title: item.title, group: item.group, ...DETAILS[item.key] }));

export function isPromptKey(value: unknown): value is PromptKey {
  return PROMPTS.some((prompt) => prompt.key === value);
}

export function promptDefinition(key: PromptKey): PromptDefinition {
  return PROMPTS.find((prompt) => prompt.key === key)!;
}

/** A prompt as an AI call uses it. Version 0 is unsaved text being tested from the admin. */
export type ActivePrompt = { key: PromptKey; text: string; version: number };

/** Unsaved text the admin is testing, used instead of the active version of that one prompt. */
export type PromptOverride = { key: PromptKey; text: string };

/** One stored prompt row, as read from the database. */
export type PromptRow = { slug: string; content: string | null; active_version: number | null };

/** Problems with prompt text before it is saved or used. Empty when it is fine. */
export function promptTextProblems(text: string): string[] {
  const problems: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) problems.push("The prompt is empty.");
  if (trimmed.length > PROMPT_MAX) problems.push(`Keep the prompt under ${PROMPT_MAX.toLocaleString("en-US")} characters.`);
  return problems;
}

/** The error an action shows when a prompt it needs can't be used. */
export function promptUnavailable(definition: PromptDefinition, why: string) {
  return `The "${definition.title}" prompt can't be used: ${why} Open Agents → ${definition.title} to fix it.`;
}

/**
 * The active prompts for `keys` from the stored rows. Fails, naming the
 * prompt, when one is missing, has no active version, or is invalid. Never
 * substitutes the starting text.
 */
export function resolvePrompts<K extends PromptKey>(
  rows: PromptRow[],
  keys: K[],
  override?: PromptOverride | null,
): { ok: true; value: Record<K, ActivePrompt> } | { ok: false; error: string } {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const value = {} as Record<K, ActivePrompt>;
  for (const key of keys) {
    const definition = promptDefinition(key);
    if (override && override.key === key) {
      const problems = promptTextProblems(override.text);
      if (problems.length > 0) return { ok: false, error: promptUnavailable(definition, problems.join(" ")) };
      value[key] = { key, text: override.text.trim(), version: 0 };
      continue;
    }
    const row = bySlug.get(definition.slug);
    if (!row || row.active_version == null || row.active_version < 1) {
      return { ok: false, error: promptUnavailable(definition, "it isn't set up yet.") };
    }
    const text = String(row.content ?? "");
    const problems = promptTextProblems(text);
    if (problems.length > 0) return { ok: false, error: promptUnavailable(definition, problems.join(" ")) };
    value[key] = { key, text: text.trim(), version: Number(row.active_version) };
  }
  return { ok: true, value };
}

/**
 * The system text of an AI call: the managed prompt first, then the fixed
 * parts the code adds (data, allowed values, answer contract). Every AI call
 * builds its system text with this, so each one starts from its managed prompt.
 */
export function promptSystem(prompt: ActivePrompt, ...fixed: (string | null | undefined | false)[]) {
  return [prompt.text, ...fixed.filter((part): part is string => typeof part === "string" && part.trim() !== "")].join("\n\n");
}

/** "v3", or "unsaved draft" for a test of text that isn't saved yet. */
export function versionLabel(version: number) {
  return version > 0 ? `v${version}` : "unsaved draft";
}
