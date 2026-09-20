import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { rehypeEmitWtsComments, rehypeKeyTakeaways, remarkPreserveWts } from "seo-core";
import { SITE_URL } from "./src/config/site.ts";

/** Demote markdown `#` headings so ArticleLayout's h1 stays the only h1. */
function rehypeDemoteMarkdownH1() {
  return (tree) => {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "element" && node.tagName === "h1") node.tagName = "h2";
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    walk(tree);
  };
}

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  output: "static",
  markdown: {
    remarkPlugins: [remarkPreserveWts],
    rehypePlugins: [rehypeDemoteMarkdownH1, rehypeEmitWtsComments, rehypeKeyTakeaways],
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ["seo-core"],
    },
    server: {
      watch: {
        // Astro writes data-store.json via a .tmp rename. On Windows, chokidar
        // treats that as an atomic save and can delete the temp file first,
        // which crashes `astro dev` with UnknownFilesystemError (ENOENT).
        ignored: ["**/.astro/**/*.tmp"],
      },
    },
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/404"),
    }),
  ],
});

