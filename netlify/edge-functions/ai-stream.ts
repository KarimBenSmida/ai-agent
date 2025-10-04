// ============================================================================
//  AI Stream – Netlify Edge Function
//  Purpose: Securely proxy chat requests from your client to OpenAI Responses API
//  Features:
//    • Streams text + reasoning-summary events ("Thinking")
//    • Keeps your OPENAI_API_KEY secret on the server
// ============================================================================

// OpenAI Responses API endpoint
const OPENAI_URL = "https://api.openai.com/v1/responses";

const ALLOW = (Netlify.env.get("ALLOW_ORIGINS") || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function corsOrigin(origin: string | null): string {
  if (!origin) return "*";                 // safe default for tests
  if (ALLOW.length === 0) return origin;   // reflect any (dev-only)
  return ALLOW.includes(origin) ? origin : "null";
}


export default async (request: Request) => {
    const origin = request.headers.get("origin");
  const allowOrigin = corsOrigin(origin);

  // --- CORS preflight ---
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowOrigin,
      },
    });
  }

  const { messages = [], system } = payload;

  // Build the "input" format expected by the Responses API
const input = [
  ...(system
    ? [{ role: "system", content: [{ type: "input_text", text: system }] }]
    : []),
  ...messages.map((m: any) => {
    // assistant messages must use output_text
    const isAssistant = m.role === "assistant";
    const type = isAssistant ? "output_text" : "input_text";
    return {
      role: m.role, // 'user' | 'assistant' | 'system'
      content: [{ type, text: m.content }],
    };
  }),
];


  const apiKey = Netlify.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), {
      status: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowOrigin,
      },
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
      model: "gpt-5",              // reasoning-capable model for "Thinking"
      reasoning: { effort: "low" },
      stream: true,
      input,
      // store: false,  // uncomment to disable OpenAI data retention (optional)
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(JSON.stringify({ error: "OpenAI upstream error", detail: text }), {
      status: upstream.status || 502,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowOrigin,
      },
    });
  }

  // Stream the OpenAI Server-Sent Events directly to the client
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // 👇 Allow your AWS front-end to call this endpoint
      "Access-Control-Allow-Origin": allowOrigin,
    },
  });
};

// Map URL → function
export const config = { path: "/api/ai/stream" };
