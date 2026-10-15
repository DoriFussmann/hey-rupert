import { redirect } from "next/navigation";

/** Old emails and bookmarks. Company Materials now lives in Onboarding. */
export function GET() {
  redirect("/portal/materials");
}
