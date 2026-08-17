import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { SITE_URL } from "./src/config/site.ts";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function loadArticleLastmod() {
  const dir = path.join(rootDir, "src/content/articles");
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const draft = /^draft:\s*true\s*$/m.test(raw);
    if (draft) continue;
    const slugMatch = raw.match(/^slug:\s*["']?([^\s"']+)["']?\s*$/m);
    const slug = slugMatch?.[1] ?? file.replace(/\.md$/, "");
    const updatedMatch = raw.match(/^updatedDate:\s*["']?([^\s"']+)["']?\s*$/m);
    const dateMatch = raw.match(/^date:\s*["']?([^\s"']+)["']?\s*$/m);
    const lastmod = updatedMatch?.[1] ?? dateMatch?.[1];
    if (lastmod) {
      const iso = new Date(lastmod).toISOString();
      if (!Number.isNaN(Date.parse(iso))) map.set(slug, iso);
    }
  }
  return map;
}

const articleLastmod = loadArticleLastmod();

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  output: "static",
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes("/404") &&
        !page.includes("/privacy") &&
        !page.includes("/terms"),
      serialize(item) {
        const pathname = new URL(item.url).pathname;
        const match = pathname.match(/^\/articles\/([^/]+)\/?$/);
        if (match) {
          const lastmod = articleLastmod.get(match[1]);
          if (lastmod) item.lastmod = lastmod;
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    server: {
      watch: {
        // Astro writes data-store.json via a .tmp rename. On Windows, chokidar
        // treats that as an atomic save and can delete the temp file first,
        // which crashes `astro dev` with UnknownFilesystemError (ENOENT).
        ignored: ["**/.astro/**/*.tmp"],
      },
    },
  },
});
