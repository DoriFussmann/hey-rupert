// Re-analyze all: which AI steps are missing or older than what the founder
// has shared, and what running them all replaces. Pure module, so the client
// page and the tests read the same rules.

export type ReanalyzeStepId = "brief" | "feedback" | "profile" | "narrative";

/** The steps in the order they run: each one reads the one before. */
export const REANALYZE_STEPS: { id: ReanalyzeStepId; label: string }[] = [
  { id: "brief", label: "Intake brief" },
  { id: "feedback", label: "Materials feedback" },
  { id: "profile", label: "Company profile" },
  { id: "narrative", label: "Narrative draft" },
];

export type ReanalyzeInput = {
  intakeCompleted: boolean;
  /** Materials submitted, or the founder said they have no deck yet. */
  materialsIn: boolean;
  interview: { updatedAt: string; messages: { role: "assistant" | "user"; at: string }[] } | null;
  brief: { basedOn: string; editedAt: string | null } | null;
  feedback: { generatedAt: string } | null;
  profile: { builtAt: string | null; sourceInterviewAt: string | null; editedAt: string | null } | null;
  files: { uploadedAt: string }[];
  narrative: {
    hasText: boolean;
    /** A version was sent to the client before. */
    sent: boolean;
    /** The client asked for changes to the version they have. */
    changesRequested: boolean;
  };
};

export type ReanalyzePlanStep = {
  id: ReanalyzeStepId;
  label: string;
  /** Why the step is skipped in this run, or null when it runs. */
  skip: string | null;
  /** What running it replaces, or null when there is nothing yet. */
  replaces: string | null;
};

export type ReanalyzeState = {
  /** The intake and the materials are in: the run can start. */
  available: boolean;
  /** Something is missing or out of date: show the banner. */
  show: boolean;
  /** Nothing has been analyzed yet. */
  firstRun: boolean;
  newFiles: number;
  newMessages: number;
  /** Steps that are missing or older than the latest founder data. */
  behind: ReanalyzeStepId[];
  steps: ReanalyzePlanStep[];
};

/** Milliseconds, or null for a missing or unreadable timestamp. */
function time(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** True when `value` is later than `than`, or `than` is unknown. */
function after(value: string | null | undefined, than: string | null | undefined) {
  const a = time(value);
  if (a == null) return false;
  const b = time(than);
  return b == null || a > b;
}

export function reanalyzeState(input: ReanalyzeInput): ReanalyzeState {
  const { interview, brief, feedback, profile, files, narrative } = input;
  const hasInterview = Boolean(interview && interview.messages.length > 0);
  const interviewAt = hasInterview ? interview!.updatedAt : null;

  const behind: ReanalyzeStepId[] = [];
  if (hasInterview && (!brief || after(interviewAt, brief.basedOn))) behind.push("brief");
  if (
    !feedback ||
    files.some((file) => after(file.uploadedAt, feedback.generatedAt)) ||
    after(interviewAt, feedback.generatedAt)
  ) {
    behind.push("feedback");
  }
  if (
    hasInterview &&
    (!profile?.builtAt ||
      after(interviewAt, profile.sourceInterviewAt) ||
      (feedback !== null && after(feedback.generatedAt, profile.builtAt)))
  ) {
    behind.push("profile");
  }
  if (!narrative.hasText) behind.push("narrative");

  const firstRun = !brief && !feedback && !profile?.builtAt;
  const fileAnchor = feedback?.generatedAt ?? profile?.builtAt ?? null;
  const messageAnchor = brief?.basedOn ?? profile?.sourceInterviewAt ?? null;
  const newFiles = firstRun || !fileAnchor ? 0 : files.filter((file) => after(file.uploadedAt, fileAnchor)).length;
  const newMessages =
    firstRun || !messageAnchor || !interview
      ? 0
      : interview.messages.filter((message) => message.role === "user" && after(message.at, messageAnchor)).length;

  const noInterview = hasInterview ? null : "No intake interview on record.";
  const steps: ReanalyzePlanStep[] = REANALYZE_STEPS.map(({ id, label }) => {
    if (id === "brief") {
      return {
        id,
        label,
        skip: noInterview,
        replaces: brief ? (brief.editedAt ? "Your edits to the brief will be replaced." : "Replaces the current brief.") : null,
      };
    }
    if (id === "feedback") {
      return { id, label, skip: null, replaces: feedback ? "Replaces the current feedback, including your edits." : null };
    }
    if (id === "profile") {
      return {
        id,
        label,
        skip: noInterview,
        replaces: profile?.builtAt || profile?.editedAt
          ? profile.editedAt
            ? "Your edits to the profile will be replaced."
            : "Replaces the current profile."
          : null,
      };
    }
    return {
      id,
      label,
      skip: null,
      replaces: narrative.changesRequested
        ? "Rebuilds the draft with the changes the client asked for. Nothing is sent."
        : narrative.sent
          ? "Writes a new draft. The client keeps the version they have until you send."
          : narrative.hasText
            ? "Replaces the current narrative draft."
            : null,
    };
  });

  const available = input.intakeCompleted && input.materialsIn;
  return {
    available,
    show: available && behind.length > 0,
    firstRun,
    newFiles,
    newMessages,
    behind,
    steps,
  };
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The banner's headline. */
export function reanalyzeHeadline(state: ReanalyzeState) {
  if (state.firstRun) return "The intake and the materials are in. Run the analysis.";
  const parts = [
    state.newFiles > 0 ? plural(state.newFiles, "file") : "",
    state.newMessages > 0 ? plural(state.newMessages, "message") : "",
  ].filter(Boolean);
  if (parts.length > 0) return `New since last analysis: ${parts.join(", ")}.`;
  const labels = REANALYZE_STEPS.filter((step) => state.behind.includes(step.id)).map((step) => step.label);
  return `Out of date: ${labels.join(", ")}.`;
}
