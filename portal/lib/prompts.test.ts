import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROMPTS, PROMPT_MAX, promptDefinition, promptSystem, promptTextProblems, resolvePrompts, type PromptRow } from "./prompts.ts";

const portal = fileURLToPath(new URL("..", import.meta.url));
// Line endings normalised: Windows checkouts turn them into CRLF.
const read = (path: string) => readFileSync(join(portal, path), "utf8").replace(/\r\n/g, "\n");

const row = (slug: string, content: string | null, version: number | null): PromptRow => ({ slug, content, active_version: version });
const slug = (key: Parameters<typeof promptDefinition>[0]) => promptDefinition(key).slug;

test("the registry: 22 prompts, each stored once, each starting text usable", () => {
  assert.equal(PROMPTS.length, 22);
  assert.equal(new Set(PROMPTS.map((p) => p.key)).size, 22);
  assert.equal(new Set(PROMPTS.map((p) => p.slug)).size, 22);
  for (const prompt of PROMPTS) {
    // The database only accepts these slugs as prompts.
    assert.ok(prompt.slug === "intake_prompt" || prompt.slug.startsWith("agent_prompt:"), prompt.slug);
    assert.deepEqual(promptTextProblems(prompt.defaultText), [], prompt.key);
    assert.ok(prompt.usedBy && prompt.fixed, prompt.key);
  }
});

test("each AI call gets the active version from the database", () => {
  const rows = [row(slug("nudge_email"), "Write a short nudge email.", 3), row(slug("email_copy"), "Write the copy.", 1)];
  const loaded = resolvePrompts(rows, ["nudge_email", "email_copy"]);
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.value.nudge_email, { key: "nudge_email", text: "Write a short nudge email.", version: 3 });
  assert.equal(loaded.value.email_copy.version, 1);
  // The managed prompt comes first; the code's fixed parts follow; empty parts are left out.
  assert.equal(promptSystem(loaded.value.nudge_email, "## Facts", "", null, false, "x"), "Write a short nudge email.\n\n## Facts\n\nx");
});

test("an admin edit changes the next generation, with no deploy", () => {
  const before = resolvePrompts([row(slug("nudge_email"), "Old wording.", 1)], ["nudge_email"]);
  const after = resolvePrompts([row(slug("nudge_email"), "New wording.", 2)], ["nudge_email"]);
  assert.ok(before.ok && after.ok);
  assert.equal(before.value.nudge_email.text, "Old wording.");
  assert.deepEqual(after.value.nudge_email, { key: "nudge_email", text: "New wording.", version: 2 });
});

test("a missing or invalid prompt fails safely, naming it; the built-in text is never used", () => {
  const missing = resolvePrompts([], ["investor_list_email"]);
  assert.ok(!missing.ok);
  assert.match(missing.error, /"Investor list email" prompt can't be used: it isn't set up yet/);
  const noVersion = resolvePrompts([row(slug("investor_list_email"), "Text", null)], ["investor_list_email"]);
  assert.ok(!noVersion.ok);
  const blank = resolvePrompts([row(slug("investor_list_email"), "   ", 4)], ["investor_list_email"]);
  assert.ok(!blank.ok);
  assert.match(blank.error, /empty/);
  const long = resolvePrompts([row(slug("investor_list_email"), "x".repeat(PROMPT_MAX + 1), 4)], ["investor_list_email"]);
  assert.ok(!long.ok);
  // One bad prompt fails the whole call, even when the others are fine.
  const mixed = resolvePrompts([row(slug("narrative_email"), "Fine.", 2)], ["narrative_email", "narrative_email_revision"]);
  assert.ok(!mixed.ok);
  assert.match(mixed.error, /Narrative email: reply to changes/);
});

test("a test run uses the unsaved text for that one prompt, as version 0", () => {
  const rows = [row(slug("narrative_email"), "Saved.", 5), row(slug("narrative_email_revision"), "Reply rules.", 2)];
  const tested = resolvePrompts(rows, ["narrative_email", "narrative_email_revision"], { key: "narrative_email", text: " Draft text. " });
  assert.ok(tested.ok);
  assert.deepEqual(tested.value.narrative_email, { key: "narrative_email", text: "Draft text.", version: 0 });
  assert.equal(tested.value.narrative_email_revision.version, 2);
  assert.ok(!resolvePrompts(rows, ["narrative_email"], { key: "narrative_email", text: " " }).ok);
});

test("the migration starts every prompt from exactly the registry's text", () => {
  const sql = read("supabase/prompt_versions.sql");
  const tag = "$rupert_prompt$";
  for (const prompt of PROMPTS) {
    assert.ok(sql.includes(`'${prompt.slug}',`), prompt.slug);
    assert.ok(sql.includes(`${tag}${prompt.defaultText}${tag}`), `${prompt.key}: starting text differs from the registry`);
  }
  // Versions can't be rewritten, and a prompt's text changes only through a saved version.
  assert.match(sql, /form_template_versions_immutable/);
  assert.match(sql, /form_templates_prompt_guard/);
});

test("the narrative-feedback migration saves exactly the registry's text for the prompts it updates", () => {
  const sql = read("supabase/narrative_feedback.sql");
  const tag = "$rupert_prompt$";
  for (const key of ["materials_analysis", "narrative_email", "narrative_email_revision"]) {
    const prompt = PROMPTS.find((item) => item.key === key)!;
    assert.ok(sql.includes(`'${prompt.slug}',`), prompt.slug);
    assert.ok(sql.includes(`${tag}${prompt.defaultText}${tag}`), `${key}: text differs from the registry`);
  }
  assert.ok(!PROMPTS.some((item) => item.key === ("feedback_email" as string)));
});

function sourceFiles(dir: string): string[] {
  return readdirSync(join(portal, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(join(portal, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

/** Every AI call's `system:` expression, per file. */
function aiCalls() {
  const calls: { file: string; system: string }[] = [];
  // lib/anthropic.ts is the AI client itself: it passes on the system text it is given.
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib")].filter((path) => path !== join("lib", "anthropic.ts"))) {
    const text = read(file);
    for (const match of text.matchAll(/callClaude(?:Tool|Agent)<[^\n]*?>\(\{\s*(?:\/\/[^\n]*\n\s*)*system(?::\s*([^\n]*))?/g)) {
      // Forward slashes on every OS, so the file names below match on Windows too.
      calls.push({ file: relative(portal, join(portal, file)).split(sep).join("/"), system: (match[1] ?? "system").trim() });
    }
  }
  return calls;
}

// The one AI call without a managed prompt: the admin's "Test Claude" connection check, which writes nothing anyone uses.
const NOT_A_WORKFLOW = new Set(["app/admin/actions.ts"]);

test("every AI call in the app starts from its managed prompt", () => {
  const calls = aiCalls();
  assert.ok(calls.length >= 14, `found ${calls.length} AI calls`);
  for (const call of calls) {
    if (NOT_A_WORKFLOW.has(call.file)) continue;
    const text = read(call.file);
    assert.match(text, /from "@\/lib\/prompts-server"/, `${call.file} must load managed prompts`);
    if (call.system.startsWith("promptSystem(")) continue;
    if (call.system.startsWith("systemPrompt(")) {
      // The intake interviewer wraps its fixed parts around the managed prompt.
      assert.match(text, /function systemPrompt\([\s\S]*?return promptSystem\(/, call.file);
      continue;
    }
    if (call.system === "system," || call.system === "system") {
      // The email drafts: every caller passes a managed prompt.
      const callers = Array.from(text.matchAll(/(?<!function )draftEmailMiddle\(\s*([^\n]*)/g)).map((m) => m[1]);
      assert.ok(callers.length > 0 && callers.every((arg) => arg.startsWith("promptSystem(") || arg === ""), `${call.file}: ${callers.join(" | ")}`);
      const multiLine = Array.from(text.matchAll(/(?<!function )draftEmailMiddle\(\s*\n\s*([^\n]*)/g)).map((m) => m[1]);
      assert.ok(multiLine.every((arg) => arg.startsWith("promptSystem(")), `${call.file}: ${multiLine.join(" | ")}`);
      continue;
    }
    assert.fail(`${call.file}: system is "${call.system}", not a managed prompt`);
  }
  // No AI call keeps instructions in a hardcoded constant any more.
  for (const file of ["lib/match/verify-server.ts", "lib/taxonomy/ai-server.ts", "lib/test-pilot-server.ts", "lib/intake-server.ts"]) {
    assert.doesNotMatch(read(file), /ROLE_SYSTEM|TEST_DATA_RULES|You map raw labels|You write the intake summary/, file);
  }
});

test("a prompt can only shape text: AI drafts can't send email or bypass approval", () => {
  // The email agents' answer is a subject and a body, nothing else.
  const agents = read("lib/agents-server.ts");
  const emailTool = agents.slice(agents.indexOf("const EMAIL_TOOL"), agents.indexOf("};\n", agents.indexOf("const EMAIL_TOOL")));
  assert.match(emailTool, /properties: \{\s*subject: \{ type: "string" \},\s*body: \{ type: "string" \},\s*\}/);
  // Code that runs AI calls, and the prompt tests, never imports anything that sends. (The Test Pilot
  // script is the one exception: it walks the test client through the portal and alerts the admin.)
  const files = [...new Set(aiCalls().map((call) => call.file))].filter((file) => !NOT_A_WORKFLOW.has(file) && file !== "lib/test-pilot-server.ts");
  assert.ok(files.includes("lib/agents-server.ts") && files.includes("lib/intake-server.ts"));
  for (const file of [...files, "app/admin/prompt-actions.ts", "lib/prompts-server.ts"]) {
    assert.doesNotMatch(read(file), /from "@\/lib\/(email|email-log|notify)"|sendClientEmail|sendAdminEmail|notifyClient/, file);
  }
  // The prompt tests run the draft functions only; saving and sending are separate admin actions.
  assert.doesNotMatch(read("app/admin/prompt-actions.ts"), /saveIntakeBrief|sendNudge|upsert|\.insert\(|\.update\(/);
});

test("the client-review migration saves exactly the registry's text for the prompts it adds or updates", () => {
  const sql = read("supabase/client_review.sql");
  const tag = "$rupert_prompt$";
  for (const key of ["email_copy_email", "outreach_narrative"] as const) {
    const prompt = PROMPTS.find((item) => item.key === key)!;
    assert.ok(sql.includes(`'${prompt.slug}'`), prompt.slug);
    assert.ok(sql.includes(`${tag}${prompt.defaultText}${tag}`), `${key}: text differs from the registry`);
  }
  // An edited narrative prompt is never replaced.
  assert.match(sql, /elsif btrim\(v_active\) <> btrim\(v_old\) then/);
});

test("the outreach migration starts the fund-type copy prompt from exactly the registry's text", () => {
  const sql = read("supabase/outreach_settings.sql");
  const prompt = PROMPTS.find((item) => item.key === "email_copy_typed")!;
  assert.ok(sql.includes(`'${prompt.slug}'`), prompt.slug);
  assert.ok(sql.includes(`$rupert_prompt$${prompt.defaultText}$rupert_prompt$`), "text differs from the registry");
});

test("the Core migration starts both Core prompts from exactly the registry's text", () => {
  const sql = read("supabase/outreach_core.sql");
  for (const key of ["core_quick_facts", "core_email"]) {
    const prompt = PROMPTS.find((item) => item.key === key)!;
    assert.ok(sql.includes(`'${prompt.slug}'`), prompt.slug);
    assert.ok(sql.includes(`$rupert_prompt$${prompt.defaultText}$rupert_prompt$`), `${key}: text differs from the registry`);
  }
});
