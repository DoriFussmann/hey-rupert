import { FramingRoom } from "@/app/admin/clients/[id]/framing/framing-room";
import type { CompanyBrief, BriefTopic, DeckTopic, FounderQuestion, SellingPoint } from "@/lib/brief";
import type { BriefFiles, BriefNarrative, BriefVersionRow } from "@/lib/brief-server";

export type BriefPanelData = {
  brief: CompanyBrief | null;
  versions: BriefVersionRow[];
  questions: FounderQuestion[];
  topics: BriefTopic[];
  files: BriefFiles;
  filesError: string | null;
  linkedinUrls: string[];
  sellingPoints: SellingPoint[];
  deckTopics: DeckTopic[];
  narrative: BriefNarrative;
  canBuild: boolean;
  buildNote: string | null;
  error: string | null;
};

/** Setup step 1 on the client page: the Company Brief. */
export function BriefPanel({ clientId, data, claudeReady, founderName, clientEmail }: { clientId: string; data: BriefPanelData; claudeReady: boolean; founderName: string; clientEmail: string }) {
  return (
    <section id="setup-brief" className="mt-lg rounded-card border border-border bg-surface">
      <div className="px-lg py-md">
        {data.error ? (
          <>
            <h2 className="text-h4">Company Brief</h2>
            <p role="alert" className="mt-xs text-body-sm text-error">{data.error}</p>
          </>
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
            sellingPoints={data.sellingPoints}
            deckTopics={data.deckTopics}
            narrative={data.narrative}
            canBuild={data.canBuild}
            buildNote={data.buildNote}
            claudeReady={claudeReady}
            founderName={founderName}
            clientEmail={clientEmail}
          />
        )}
      </div>
    </section>
  );
}
