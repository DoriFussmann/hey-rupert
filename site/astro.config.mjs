import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { rehypeEmitWtsComments, rehypeKeyTakeaways, remarkPreserveWts, seoSitemap } from "seo-core";
import { SITE_URL } from "./src/config/site.ts";

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  output: "static",
  // Every indexable page is in the sitemap, /book-call/ included: it is
  // index,follow, self-canonical and linked from every page.
  integrations: [seoSitemap()],
  markdown: {
    remarkPlugins: [remarkPreserveWts],
    rehypePlugins: [rehypeEmitWtsComments, rehypeKeyTakeaways],
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
});
