import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { companyProfileMarkdown, profileFileName } from "@/lib/company-profile/markdown";
import { validateProfile } from "@/lib/company-profile/core";
import { currentProfile } from "@/lib/company-profile/server";
import { getIntakeInterview } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadProfileState } from "@/lib/match/profile-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";

// The company profile as one Markdown file: the overview, the classification
// and every section, as the profile page shows them. Admin only.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  }
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });

  const supabase = createServiceClient();
  const { data: client, error } = await supabase
    .from("clients")
    .select("company_name")
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const [state, interview, taxonomy] = await Promise.all([
    loadProfileState(supabase, params.id),
    getIntakeInterview(params.id),
    loadTaxonomy(supabase),
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
  const markdown = companyProfileMarkdown({
    company,
    exportedAt: new Date().toISOString(),
    brief: interview?.admin_brief ?? null,
    answers: state.value?.answers ?? {},
    classification,
  });

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${profileFileName(company)}"`,
      "Cache-Control": "no-store",
    },
  });
}
