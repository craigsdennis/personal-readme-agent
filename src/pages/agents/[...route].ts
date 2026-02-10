import type { APIRoute } from "astro";

export const prerender = false;

export const ALL: APIRoute = async ({ request, locals }) => {
  let routeAgentRequest: ((request: Request, env: Env) => Promise<Response | null>) | null = null;
  try {
    const mod = await import("agents");
    routeAgentRequest = mod.routeAgentRequest;
  } catch {
    return new Response(
      "Agents runtime unavailable in local Node dev. Run in Cloudflare runtime (wrangler dev/preview).",
      { status: 501 }
    );
  }

  const response = await routeAgentRequest(request, locals.runtime.env);
  if (response) {
    return response;
  }

  return new Response("Not found", { status: 404 });
};
