import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "seo-core";
import { SITE_NAME, SITE_URL } from "../src/config/site.ts";

const ARTICLES_BASE = "articles";
const siteRoot = dirname(fileURLToPath(import.meta.url)).replace(/scripts$/, "");

runAudit({
  siteUrl: SITE_URL,
  siteName: SITE_NAME,
  articlesBase: ARTICLES_BASE,
  distDir: join(siteRoot, "dist"),
  articlesDir: join(siteRoot, "src", "content", "articles"),
  requireKeyTakeaways: false,
});
