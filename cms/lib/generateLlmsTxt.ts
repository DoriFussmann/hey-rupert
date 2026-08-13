import fs from "node:fs/promises";
import path from "node:path";
import { SITE_NAME } from "../../site/src/config/site.ts";
import { absoluteUrl } from "../../site/src/lib/url.ts";
import { listArticles } from "./listContent.ts";
import { PUBLIC_DIR } from "./paths.ts";

export async function generateLlmsTxt(): Promise<string> {
  const articles = (await listArticles()).filter((article) => article.data.draft !== true);
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> Articles published on ${SITE_NAME}.`,
    "",
    "## Articles",
    "",
  ];
  for (const article of articles) {
    const title = String(article.data.title ?? article.slug);
    const description = String(article.data.description ?? "");
    const url = absoluteUrl(`/articles/${article.slug}/`);
    lines.push(`- [${title}](${url}): ${description}`);
  }
  if (articles.length === 0) {
    lines.push("No published articles yet.");
  }
  lines.push("");
  const output = lines.join("\n");
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.writeFile(path.join(PUBLIC_DIR, "llms.txt"), output, "utf8");
  return output;
}
