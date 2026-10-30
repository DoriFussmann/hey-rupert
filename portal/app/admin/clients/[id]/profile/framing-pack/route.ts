import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { companyProfileMarkdown, profileFileName } from "@/lib/company-profile/markdown";
import { validateProfile } from "@/lib/company-profile/core";
import { currentProfile } from "@/lib/company-profile/server";
import { getIntakeInterview } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { intakeMessageText } from "@/lib/intake";
import { loadProfileState } from "@/lib/match/profile-server";
import { loadSetupSteps } from "@/lib/setup-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";

// Everything Rupert knows about one client, in one Markdown file, for a
// framing session: the company profile, the intake (summary, brief and the
// full transcript), the company materials, and the analysis and narrative
// as they stand. Admin only.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

function json(value: unknown) {
  return ["```json", JSON.stringify(value ?? null, null, 2), "```"].join("\n");
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });

  const supabase = createServiceClient();
  const { data: client, error } = await supabase.from("clients").select("*").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const [state, interview, taxonomy, steps] = await Promise.all([
    loadProfileState(supabase, params.id),
    getIntakeInterview(params.id),
    loadTaxonomy(supabase),
    loadSetupSteps(supabase, [params.id]),
  ]);
  if (!state.ok) return NextResponse.json({ error: state.error }, { status: 500 });

  let classification = null;
  if (state.value && taxonomy.ok) {
    const current = await currentProfile(supabase, params.id, state.value, taxonomy.value);
    if (current.ok) {
      const { issues, readiness } = validateProfile(current.value.profile, taxonomy.value, current.value.buildProblems);
      classification = { profile: current.value.profile, readiness, issues };
    }
  }

  const company = String(client.company_name ?? "");
  const exportedAt = new Date().toISOString();
  const rows = steps.get(params.id) ?? [];
  const step = (id: string) => rows.find((row) => row.step === id) ?? null;

  const parts: string[] = [
    `# Framing pack: ${company || "client"}`,
    `Exported ${exportedAt}. Everything Rupert knows, for a framing session.`,
    "",
    "## Client record",
    json({
      company_name: client.company_name,
      founder: [client.first_name, client.last_name].filter(Boolean).join(" ") || client.founder_name,
      website: client.website,
      stage: client.stage,
      raise_stage: client.raise_stage,
      vertical: client.vertical,
      sector: client.sector,
      geography: client.geography,
    }),
    "",
    "## Company profile",
    companyProfileMarkdown({ company, exportedAt, brief: interview?.admin_brief ?? null, answers: state.value?.answers ?? {}, classification }),
    "",
    "## Intake summary (confirmed by the founder)",
    ...(interview?.summary?.length ? interview.summary.map((item) => `### ${item.title}\n${item.answer}`) : ["(none)"]),
    "",
    "## Intake brief (for Rupert)",
    interview?.admin_brief ? json(interview.admin_brief) : "(none)",
    "",
    "## Where the files and the founder's answers disagreed",
    interview?.conflicts?.length ? json(interview.conflicts) : "(none)",
    "",
    "## Intake transcript",
    ...(interview?.messages?.length
      ? interview.messages.map((message) => `**${message.role === "user" ? "Founder" : "Rupert"}** (${message.at}):\n${intakeMessageText(message)}`)
      : ["(no interview)"]),
    "",
    "## Company materials",
    json({ status: step("materials")?.status ?? null, submitted: step("materials")?.published ?? null, draft: step("materials")?.draft ?? null }),
    "",
    "## Analysis and Outreach Narrative (as they stand)",
    json({ status: step("framing")?.status ?? null, version: step("framing")?.version ?? 0, published: step("framing")?.published ?? null, draft: step("framing")?.draft ?? null }),
    "",
    "## Earlier materials feedback (if any)",
    json(step("deck_review")?.published ?? step("deck_review")?.draft ?? null),
  ];

  return new NextResponse(parts.join("\n\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${profileFileName(company).replace(/\.md$/, "")}-framing-pack.md"`,
      "Cache-Control": "no-store",
    },
  });
}
