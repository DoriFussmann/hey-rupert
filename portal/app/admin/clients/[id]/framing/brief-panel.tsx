import { FramingRoom } from "@/app/admin/clients/[id]/framing/framing-room";
import type { CompanyBrief, BriefTopic, FounderQuestion } from "@/lib/brief";
import type { BriefFiles, BriefVersionRow } from "@/lib/brief-server";

export type BriefPanelData = {
  brief: CompanyBrief | null;
  versions: BriefVersionRow[];
  questions: FounderQuestion[];
  topics: BriefTopic[];
  files: BriefFiles;
  filesError: string | null;
  linkedinUrls: string[];
  canBuild: boolean;
  buildNote: string | null;
  error: string | null;
};

/** Setup step 1 on the client page: the Company Brief. */
export function BriefPanel({ clientId, data, claudeReady }: { clientId: string; data: BriefPanelData; claudeReady: boolean }) {
  return (
    <section id="setup-brief" className="mt-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-lg">
        <h3 className="text-h4">Company Brief</h3>
        <p className="mt-xs max-w-prose text-body-sm text-muted">
          Rupert&apos;s summary of the company, topic by topic, and the three selling points the narrative leads with. The founder never sees it. To dig deeper, Download for AI, work it in ChatGPT, and paste the results back with Edit.
        </p>
      </div>
      <div className="px-lg py-md">
        {data.error ? (
          <p role="alert" className="text-body-sm text-error">{data.error}</p>
        ) : (
          <FramingRoom
            clientId={clientId}
            initialBrief={data.brief}
            initialVersions={data.versions}
            founderQuestions={data.questions}
            topics={data.topics}
            initialLinkedin={data.files}
            linkedinError={data.filesError}
            linkedinUrls={data.linkedinUrls}
            canBuild={data.canBuild}
            buildNote={data.buildNote}
            claudeReady={claudeReady}
          />
        )}
      </div>
    </section>
  );
}
