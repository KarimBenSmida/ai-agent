// ============================================================================
//  AI Stream – Netlify Edge Function
//  Purpose: Securely proxy chat requests from your client to OpenAI Responses API
//  Features:
//    • Streams text + reasoning-summary events ("Thinking")
//    • Keeps your OPENAI_API_KEY secret on the server
// ============================================================================

// OpenAI Responses API endpoint
const OPENAI_URL = "https://api.openai.com/v1/responses";

export default async (request: Request) => {
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages = [], system, temperature = 0.2 } = payload;

  // Build the "input" format expected by the Responses API
  const input = [
    ...(system
      ? [{ role: "system", content: [{ type: "input_text", text: system }] }]
      : []),
    ...messages.map((m: any) => ({
      role: m.role,
      content: [{ type: "input_text", text: m.content }],
    })),
  ];

  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Call OpenAI Responses API with streaming enabled
  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: "o4-mini",              // reasoning-capable model for "Thinking"
      reasoning: { effort: "medium" },
      stream: true,
      input,
      // store: false,  // uncomment to disable OpenAI data retention (optional)
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "OpenAI upstream error", detail: text }),
      { status: upstream.status || 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Stream the OpenAI Server-Sent Events directly to the client
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // 👇 Allow your AWS front-end to call this endpoint
      "Access-Control-Allow-Origin": "https://your-aws-domain.com",
    },
  });
};

// Map URL → function
export const config = { path: "/api/ai/stream" };
