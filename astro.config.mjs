// @ts-check
import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";

const isDevCommand = process.argv.includes("dev");

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react()],
  adapter: cloudflare({
    platformProxy: {
      enabled: true
    },
    imageService: "cloudflare",
    ...(isDevCommand
      ? {}
        : {
          workerEntryPoint: {
            path: "src/worker.ts",
            namedExports: ["PersonalReadmeAgent", "PersonalReadmeTextUpdateWorkflow"]
          }
        })
  })
});
