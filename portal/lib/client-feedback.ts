// Client feedback: what a client told Rupert outside the portal. Pure module.

import { FEEDBACK_CHANNEL_LABEL, type FeedbackChannel } from "./setup.ts";

export const FEEDBACK_ABOUT = ["general", "framing", "investor_list", "email_copy"] as const;
export type FeedbackAbout = (typeof FEEDBACK_ABOUT)[number];

export const FEEDBACK_ABOUT_LABEL: Record<FeedbackAbout, string> = {
  general: "General",
  framing: "Outreach narrative",
  investor_list: "Investor matching",
  email_copy: "Email copy",
};

/** For the client: "about your investor matching". */
export const FEEDBACK_ABOUT_CLIENT: Record<FeedbackAbout, string> = {
  general: "",
  framing: "about your outreach narrative",
  investor_list: "about your investor matching",
  email_copy: "about your outreach emails",
};

export type ClientFeedback = {
  id: string;
  about: FeedbackAbout;
  channel: FeedbackChannel;
  /** yyyy-mm-dd */
  on: string;
  original: string;
  summary: string | null;
  loggedBy: string | null;
  createdAt: string;
};

/** "Nov 4, 2026 · by email · about your investor matching" */
export function feedbackMeta(f: ClientFeedback, date: (iso: string) => string, client = false) {
  const about = client ? FEEDBACK_ABOUT_CLIENT[f.about] : f.about === "general" ? "" : `about ${FEEDBACK_ABOUT_LABEL[f.about].toLowerCase()}`;
  return [date(`${f.on}T12:00:00`), FEEDBACK_CHANNEL_LABEL[f.channel], about].filter(Boolean).join(" · ");
}

/** The feedback as AI and drafting prompts receive it: the summaries (or the original when there is none), oldest first. */
export function feedbackText(list: ClientFeedback[], about?: FeedbackAbout[]) {
  return list
    .filter((f) => !about || about.includes(f.about))
    .sort((a, b) => a.on.localeCompare(b.on))
    .map((f) => `- ${f.on} (${FEEDBACK_ABOUT_LABEL[f.about]}): ${(f.summary || f.original).replace(/\s*\n+\s*/g, " ")}`)
    .join("\n");
}
