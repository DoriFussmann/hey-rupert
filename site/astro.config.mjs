import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { SITE_URL } from "./src/config/site.ts";

export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  output: "static",
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
