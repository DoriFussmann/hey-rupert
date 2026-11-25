// The AI prompts Rupert uses, by name and area only: small enough for the
// admin nav. Their texts and details are in lib/prompts.ts. Pure module.

export type PromptGroup = "Prospects" | "Intake" | "Company and Narrative" | "Emails to Founders" | "Matching" | "Taxonomy" | "Test Pilot";

export const PROMPT_GROUPS: PromptGroup[] = ["Prospects", "Intake", "Company and Narrative", "Emails to Founders", "Matching", "Taxonomy", "Test Pilot"];

export const PROMPT_LIST = [
  { key: "prospect_brief", title: "Prospect Brief (Before a Call)", group: "Prospects" },
  { key: "prospect_follow_up", title: "Prospect Follow-Up Email", group: "Prospects" },
  { key: "intake_interviewer", title: "Intake Interviewer", group: "Intake" },
  { key: "intake_summary", title: "Intake Summary (Founder Reviews)", group: "Intake" },
  { key: "intake_brief", title: "Intake Brief (For Rupert)", group: "Intake" },
  { key: "intake_sub_sector", title: "Intake: Closest Sub-Sectors", group: "Intake" },
  { key: "client_feedback_summary", title: "Client Feedback Summary", group: "Intake" },
  { key: "company_brief", title: "Company Brief", group: "Company and Narrative" },
  { key: "framing_room", title: "Framing Room Chat", group: "Company and Narrative" },
  { key: "selling_points", title: "Selling Points", group: "Company and Narrative" },
  { key: "deck_feedback", title: "Deck Feedback", group: "Company and Narrative" },
  { key: "brief_narrative", title: "Narrative from the Brief", group: "Company and Narrative" },
  { key: "materials_analysis", title: "Materials Analysis (Before the Brief)", group: "Company and Narrative" },
  { key: "outreach_narrative", title: "Outreach Narrative (Before the Brief)", group: "Company and Narrative" },
  { key: "email_copy", title: "Email Copy", group: "Company and Narrative" },
  { key: "email_copy_typed", title: "Email Copy by Fund Type", group: "Company and Narrative" },
  { key: "core_quick_facts", title: "Core: Quick Facts Research", group: "Company and Narrative" },
  { key: "core_email", title: "Core: Personal Emails", group: "Company and Narrative" },
  { key: "warm_intro_blurb", title: "Warm Intro Blurb", group: "Company and Narrative" },
  { key: "reply_triage", title: "Reply Triage", group: "Company and Narrative" },
  { key: "match_profile", title: "Match Profile", group: "Company and Narrative" },
  { key: "narrative_email", title: "Narrative Email", group: "Emails to Founders" },
  { key: "narrative_email_revision", title: "Narrative Email: Reply to Changes", group: "Emails to Founders" },
  { key: "investor_list_email", title: "Investor List Email", group: "Emails to Founders" },
  { key: "matching_summary_email", title: "Matching Summary Email", group: "Emails to Founders" },
  { key: "email_copy_email", title: "Email Copy Email", group: "Emails to Founders" },
  { key: "nudge_email", title: "Nudge Email", group: "Emails to Founders" },
  { key: "verify_role_check", title: "Verify Emails: Role Check", group: "Matching" },
  { key: "verify_presend_check", title: "Pre-Send Email Check", group: "Matching" },
  { key: "match_options", title: "Thin Match: Sector Options", group: "Matching" },
  { key: "list_audit", title: "Investor List Audit", group: "Matching" },
  { key: "competitor_search", title: "Step 2: Funded Competitors", group: "Matching" },
  { key: "comparables_search", title: "Step 3: Companies Like You", group: "Matching" },
  { key: "competitor_sector", title: "Step 2: Competitors' Primary Sub-Sector", group: "Matching" },
  { key: "competitor_investors", title: "Step 2: Competitors' Investors", group: "Matching" },
  { key: "investor_website", title: "Step 2: Investors' Websites", group: "Matching" },
  { key: "add_fund_research", title: "Step 2: Research a Fund to Add", group: "Matching" },
  { key: "added_fields_fill", title: "Step 3: Fill an Added Investor's Missing Fields", group: "Matching" },
  { key: "taxonomy_mapping", title: "Taxonomy: Map Raw Labels", group: "Taxonomy" },
  { key: "taxonomy_relationships", title: "Taxonomy: Suggest Relationships", group: "Taxonomy" },
  { key: "test_pilot_intake", title: "Test Pilot: Intake Answers", group: "Test Pilot" },
  { key: "test_pilot_materials", title: "Test Pilot: Materials Form", group: "Test Pilot" },
] as const satisfies readonly { key: string; title: string; group: PromptGroup }[];

export type PromptKey = (typeof PROMPT_LIST)[number]["key"];

/** The admin page of one prompt. */
export function promptPath(key: PromptKey) {
  return `/admin/forms/agents/${key}`;
}
