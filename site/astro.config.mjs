import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { rehypeEmitWtsComments, rehypeKeyTakeaways, remarkPreserveWts, seoSitemap } from "seo-core";
import { SITE_URL } from "./src/config/site.ts";

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  output: "static",
  // /book-call/ stays indexable but is kept out of the sitemap, as before.
  integrations: [seoSitemap({ exclude: ["/book-call/"] })],
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
