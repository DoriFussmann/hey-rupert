import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { profileFileName } from "@/lib/company-profile/markdown";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  ABSTRACT_HINT,
  QUESTIONS_HINT,
  briefText,
} from "@/lib/brief";
import { loadBrief, loadBriefTopics, loadSellingPoints, loadSources } from "@/lib/brief-server";
import { createServiceClient } from "@/lib/supabase/admin";

// "Download for AI": everything an outside AI (ChatGPT, Claude) needs to work
// on a client's brief, with instructions on top, as one Markdown file.
// Rupert pastes the results back into the brief with Edit. Admin only.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, role } = await getAuthContext();
  if (!user || role !== "admin") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!isServiceRoleConfigured()) return NextResponse.json({ error: "Service role key is not configured." }, { status: 500 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Unknown client." }, { status: 400 });

  const supabase = createServiceClient();
  const [client, sources, brief, topics, sellingPoints] = await Promise.all([
    supabase.from("clients").select("company_name").eq("id", params.id).maybeSingle(),
    loadSources(supabase, params.id),
    loadBrief(supabase, params.id),
    loadBriefTopics(supabase),
    loadSellingPoints(supabase),
  ]);
  if (!client.data) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  if (!sources.ok) return NextResponse.json({ error: sources.error }, { status: 500 });
  const company = String(client.data.company_name ?? "the company");
  const enabled = topics.filter((topic) => topic.enabled);
  const files = [...sources.value.files, ...sources.value.linkedin].map((file) => `- ${file.name}`).join("\n") || "- (none)";
  const points = brief.ok && brief.value ? brief.value.points : null;

  const markdown = [
    `# ${company}: Company Brief pack`,
    `Exported ${new Date().toISOString()}.`,
    "",
    "## Instructions for the AI",
    `You are a senior fundraising advisor helping Hey Rupert, an investor outreach service, frame and pitch ${company} to investors. Below is everything known: the current Company Brief, the intake interview, the company profile and the links. The founder's files are attached separately:`,
    files,
    "",
    "Work like a sharp, skeptical partner:",
    "- Check every claim. Search the web for the founder by full name and for the company. Check exits against dates: an exit counts only if it happened while the founder was there.",
    "- Flag numbers that don't add up, unsourced figures and anything an investor would see through.",
    "- Never invent facts; say when you couldn't confirm something, and cite sources.",
    "",
    "When asked to improve the brief, answer section by section, using these exact headings, each brief, punchy and in markdown, so the text can be pasted straight back:",
    `- Abstract: ${ABSTRACT_HINT}`,
    ...enabled.map((topic) => `- ${topic.title}: ${topic.guidance}`),
    `- Questions for the founder: ${QUESTIONS_HINT}`,
    "",
    `The three strongest selling points are chosen from this list of ${sellingPoints.length}: ${sellingPoints.map((point) => `${point.title} (${point.guidance})`).join("; ")}. When asked, score each 0 to 10 for this raise, say why, and say what to tell investors about the top three.`,
    "",
    "## The current Company Brief",
    brief.ok && brief.value ? briefText(brief.value.sections, topics, points ?? undefined) : "(not built yet)",
    points && points.scores.length > 0
      ? `\n## Selling point scores\n${points.scores
          .map((item) => `- ${item.title || item.point}: ${item.score}/10. ${item.reason}${item.pitch ? ` Claim: ${item.pitch}` : ""}${item.watch_out ? ` Watch out: ${item.watch_out}` : ""}`)
          .join("\n")}`
      : "",
    "",
    "## What we know",
    sources.value.text,
  ].join("\n");

  return new NextResponse(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${profileFileName(company).replace(/\.md$/, "")}-brief-for-ai.md"`,
      "Cache-Control": "no-store",
    },
  });
}
