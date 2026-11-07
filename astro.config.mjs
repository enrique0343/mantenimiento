import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    platformProxy: { enabled: true },
    imageService: "compile",
  }),
  integrations: [tailwind({ applyBaseStyles: false })],
  vite: {
    ssr: {
      external: ["node:buffer", "node:crypto"],
    },
  },
});
