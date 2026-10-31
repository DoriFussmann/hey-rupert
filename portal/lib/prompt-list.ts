// The AI prompts Rupert uses, by name and area only: small enough for the
// admin nav. Their texts and details are in lib/prompts.ts. Pure module.

export type PromptGroup = "Intake" | "Company and narrative" | "Emails to founders" | "Matching" | "Taxonomy" | "Test Pilot";

export const PROMPT_GROUPS: PromptGroup[] = ["Intake", "Company and narrative", "Emails to founders", "Matching", "Taxonomy", "Test Pilot"];

export const PROMPT_LIST = [
  { key: "intake_interviewer", title: "Intake interviewer", group: "Intake" },
  { key: "intake_summary", title: "Intake summary (founder reviews)", group: "Intake" },
  { key: "intake_brief", title: "Intake brief (for Rupert)", group: "Intake" },
  { key: "company_brief", title: "Company brief", group: "Company and narrative" },
  { key: "framing_room", title: "Framing Room chat", group: "Company and narrative" },
  { key: "selling_points", title: "Selling points", group: "Company and narrative" },
  { key: "deck_feedback", title: "Deck feedback", group: "Company and narrative" },
  { key: "brief_narrative", title: "Narrative from the brief", group: "Company and narrative" },
  { key: "materials_analysis", title: "Materials analysis (before the brief)", group: "Company and narrative" },
  { key: "outreach_narrative", title: "Outreach narrative (before the brief)", group: "Company and narrative" },
  { key: "email_copy", title: "Email copy", group: "Company and narrative" },
  { key: "email_copy_typed", title: "Email copy by fund type", group: "Company and narrative" },
  { key: "core_quick_facts", title: "Core: Quick Facts research", group: "Company and narrative" },
  { key: "core_email", title: "Core: personal emails", group: "Company and narrative" },
  { key: "warm_intro_blurb", title: "Warm intro blurb", group: "Company and narrative" },
  { key: "reply_triage", title: "Reply triage", group: "Company and narrative" },
  { key: "match_profile", title: "Match profile", group: "Company and narrative" },
  { key: "narrative_email", title: "Narrative email", group: "Emails to founders" },
  { key: "narrative_email_revision", title: "Narrative email: reply to changes", group: "Emails to founders" },
  { key: "investor_list_email", title: "Investor list email", group: "Emails to founders" },
  { key: "email_copy_email", title: "Email copy email", group: "Emails to founders" },
  { key: "nudge_email", title: "Nudge email", group: "Emails to founders" },
  { key: "verify_role_check", title: "Verify emails: role check", group: "Matching" },
  { key: "match_options", title: "Thin match: sector options", group: "Matching" },
  { key: "list_audit", title: "Investor list audit", group: "Matching" },
  { key: "competitor_search", title: "Step 2: funded competitors", group: "Matching" },
  { key: "taxonomy_mapping", title: "Taxonomy: map raw labels", group: "Taxonomy" },
  { key: "taxonomy_relationships", title: "Taxonomy: suggest relationships", group: "Taxonomy" },
  { key: "test_pilot_intake", title: "Test Pilot: intake answers", group: "Test Pilot" },
  { key: "test_pilot_materials", title: "Test Pilot: materials form", group: "Test Pilot" },
] as const satisfies readonly { key: string; title: string; group: PromptGroup }[];

export type PromptKey = (typeof PROMPT_LIST)[number]["key"];

/** The admin page of one prompt. */
export function promptPath(key: PromptKey) {
  return `/admin/forms/agents/${key}`;
}
