import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { generateLlmsTxt } from "seo-core";
import { ARTICLES_BASE, AUTHOR_PATH, SITE_NAME, SITE_TAGLINE, SITE_URL } from "../config/site";

export const GET: APIRoute = async () => {
  const articles = (await getCollection("articles", ({ data }) => data.draft !== true)).sort(
    (a, b) => (b.data.updatedDate || b.data.date).localeCompare(a.data.updatedDate || a.data.date),
  );
  const team = await getCollection("team");

  // Services are not listed: Rupert has no /services/ pages.
  const body = generateLlmsTxt({
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
    siteTagline: SITE_TAGLINE,
    articlesBase: ARTICLES_BASE,
    articles,
    team,
    authorPath: AUTHOR_PATH,
    extraPages: [
      {
        title: "About",
        path: "/about/",
        description:
          "Dori Fussmann is an entrepreneur, finance executive and former investment banker who founded Rupert to bring disciplined investor outreach to startup fundraising.",
      },
      {
        title: "How It Works",
        path: "/how-it-works/",
        description:
          "See how Rupert works in three stages: discovery and strategy, campaign launch, and meetings and momentum — with the founder in control of every conversation.",
      },
      {
        title: "Pricing",
        path: "/pricing/",
        description:
          "Rupert charges a setup fee (two to four weeks of intake, narrative, messaging and investor matching), then a flat monthly fee. No success fee, no percentage of the raise, no equity. Month to month; cancel at any time.",
      },
      {
        title: "Book a Free Consultation",
        path: "/book-call/",
        description:
          "A free 30-minute consultation with Dori to understand what you're raising, where you are in the process, and whether Rupert is the right fit.",
      },
    ],
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
