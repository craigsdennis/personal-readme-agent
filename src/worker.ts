import { App } from "astro/app";
import { handle } from "@astrojs/cloudflare/handler";
import type { SSRManifest } from "astro";
import { PersonalReadmeAgent } from "./agents/personal-readme-agent";

export { PersonalReadmeAgent };

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);

  return {
    default: {
      fetch(request: Request, env: Env, context: ExecutionContext) {
        return handle(manifest, app, request, env, context);
      }
    },
    PersonalReadmeAgent
  };
}
