import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { generateLlmsTxt } from "seo-core";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "../config/site";

const ARTICLES_BASE = "articles";

export const GET: APIRoute = async () => {
  const articles = (await getCollection("articles", ({ data }) => data.draft !== true)).sort(
    (a, b) => (b.data.updatedDate || b.data.date).localeCompare(a.data.updatedDate || a.data.date),
  );
  const team = await getCollection("team");
  const services = (await getCollection("services")).sort((a, b) => a.data.order - b.data.order);

  const body = generateLlmsTxt({
    siteUrl: SITE_URL,
    siteName: SITE_NAME,
    siteTagline: SITE_DESCRIPTION,
    articlesBase: ARTICLES_BASE,
    articles,
    team,
    services,
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
        title: "Request a Discovery Call",
        path: "/book-call/",
        description:
          "A 30-minute conversation with Dori to understand what you're raising, where you are in the process, and whether Rupert is the right fit.",
      },
    ],
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
