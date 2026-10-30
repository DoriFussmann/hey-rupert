import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { FramingRoom } from "@/app/admin/clients/[id]/framing/framing-room";
import { isClaudeConfigured } from "@/lib/anthropic";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import {
  briefReadiness,
  listBriefVersions,
  loadBrief,
  loadFounderQuestions,
  loadBriefFiles,
  loadBriefTopics,
  loadFramingMessages,
} from "@/lib/brief-server";
import { createServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Building the brief, scoring the deck and the chat run in server actions here, with web research.
export const maxDuration = 300;

export default async function FramingRoomPage({ params }: { params: { id: string } }) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const header = (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name || "Client"} />
      <PageHeader
        title="Framing Room"
        description="Rupert's Company Brief for this client, and a chat to decide how to frame and pitch it. The founder never sees the brief; they get the narrative, deck feedback and questions made from it."
      />
    </>
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <EmptyState title="Not available" description="The service role key is not configured." />
      </>
    );
  }

  const supabase = createServiceClient();
  const [brief, versions, messages, questions, readiness, topics, briefFiles] = await Promise.all([
    loadBrief(supabase, client.id),
    listBriefVersions(supabase, client.id),
    loadFramingMessages(supabase, client.id),
    loadFounderQuestions(supabase, client.id),
    briefReadiness(supabase, client.id),
    loadBriefTopics(supabase),
    loadBriefFiles(supabase, client.id),
  ]);
  const error = [brief, versions, messages, questions].find((item) => !item.ok);
  if (error && !error.ok) {
    return (
      <>
        {header}
        <EmptyState title="The Framing Room couldn't load" description={error.error} />
      </>
    );
  }

  return (
    <>
      {header}
      <FramingRoom
        clientId={client.id}
        company={client.company_name || "this company"}
        initialBrief={brief.ok ? brief.value : null}
        initialVersions={versions.ok ? versions.value : []}
        initialMessages={messages.ok ? messages.value : []}
        founderQuestions={questions.ok ? questions.value : []}
        topics={topics}
        initialLinkedin={briefFiles.ok ? briefFiles.value : { linkedin: [], skipped: false }}
        linkedinError={briefFiles.ok ? null : briefFiles.error}
        canBuild={readiness.canBuild}
        buildNote={readiness.reason}
        claudeReady={isClaudeConfigured()}
      />
    </>
  );
}
