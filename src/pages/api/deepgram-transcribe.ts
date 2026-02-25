import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const apiKey = locals.runtime?.env?.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "DEEPGRAM_API_KEY is not configured" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.includes("audio/") && !contentType.includes("application/octet-stream")) {
    return new Response(
      JSON.stringify({ error: "Send audio as request body (audio/webm, audio/wav, etc.)" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const audio = await request.arrayBuffer();
  if (audio.byteLength === 0) {
    return new Response(
      JSON.stringify({ error: "Empty audio" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const ct = contentType.split(";")[0].trim() || "audio/webm";
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true"
  });

  try {
    const res = await fetch(
      `https://api.deepgram.com/v1/listen?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": ct
        },
        body: audio
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error(`[deepgram] ${res.status} response:`, text);
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { err_msg?: string; message?: string };
        detail = parsed.err_msg ?? parsed.message ?? text;
      } catch {
        /* use raw text */
      }
      return new Response(
        JSON.stringify({
          error: "Deepgram transcription failed",
          detail: `Deepgram ${res.status}: ${detail}`
        }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await res.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
    return new Response(JSON.stringify({ transcript }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: "Transcription failed", detail: msg }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
};
