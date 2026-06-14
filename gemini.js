import { GeminiSessionDO } from "./gemini-session-do.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-User-Id, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function getUserKey(request) {
  return (
    request.headers.get("X-Client-Id") ||
    request.headers.get("X-User-Id") ||
    request.headers.get("CF-Connecting-IP") ||
    "anon"
  );
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        status: "ok",
        service: "gemini-web-proxy",
        version: "2.0.0",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/v1/models") {
      return json({
        object: "list",
        data: [
          {
            id: "gemini-web",
            object: "model",
            created: 1706745600,
            owned_by: "gemini-proxy"
          }
        ]
      });
    }

    const PROXIED_PATHS = ["/v1/chat/completions", "/v1/gemini/session"];
    if (!PROXIED_PATHS.includes(url.pathname)) {
      return json({ error: { message: `Not found: ${url.pathname}` } }, 404);
    }

    if (!env.GEMINI_SESSIONS) {
      return json({
        error: {
          message: "Durable Object binding GEMINI_SESSIONS is missing. Check wrangler.toml."
        }
      }, 500);
    }

    const userKey = getUserKey(request);
    const doId = env.GEMINI_SESSIONS.idFromName(String(userKey));
    const stub = env.GEMINI_SESSIONS.get(doId);
    return stub.fetch(request);
  }
};

export { GeminiSessionDO };
