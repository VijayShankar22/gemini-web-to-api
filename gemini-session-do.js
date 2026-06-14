const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Client-Id, X-User-Id, Authorization"
};

const JSPB_HEADER = "[1,null,null,null,\"fbb127bbb056c959\",null,null,0,[4],null,null,1]";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function buildReqId() {
  return String(Math.floor(Math.random() * 9000000) + 1000000);
}

function generateHex(length) {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16).toUpperCase();
  });
}

async function fetchGeminiSession() {
  const res = await fetch("https://gemini.google.com/app", {
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Upgrade-Insecure-Requests": "1"
    }
  });

  const html = await res.text();
  
  let fsid = "";
  const fsidMatch = html.match(/"FdrFJe"\s*:\s*"(-?\d+)"/);
  if (fsidMatch) fsid = fsidMatch[1];

  let bl = "";
  const blMatch = html.match(/"bl"\s*:\s*"([^"]+)"/) || html.match(/"SNlM0e"\s*:\s*"(boq_assistant-[^"]+)"/);
  if (blMatch) bl = blMatch[1];
  if (!bl) bl = "boq_assistant-bard-web-server_20260325.04_p0";

  let snl = "";
  const snlMatch = html.match(/"SNlM0e"\s*:\s*"(![^"]+)"/);
  if (snlMatch) snl = snlMatch[1];

  const rawCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookieMap = {};
  for (const c of rawCookies) {
    const pair = c.split(";")[0].trim();
    const idx = pair.indexOf("=");
    if (idx > 0) {
      cookieMap[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
  }

  return { fsid, bl, snl, cookieMap };
}

function buildFReq(prompt, session) {
  const req_token = session.snl || "";
  const req_hash = session.req_hash || generateHex(32);
  const uuid = session.uuid || generateUUID();

  const inner = [
    [prompt, 0, null, null, null, null, 0],
    [session.hl || "en-US"],
    [
      session.conversation_id || "",
      session.response_id || "",
      session.rc_id || "",
      null, null, null, null, null, null,
      session.aw_token || ""
    ],
    req_token,
    req_hash,
    null,
    [session.conversation_id ? 1 : 0],
    1, null, null, 1, 0,
    null, null, null, null, null,
    [[session.conversation_id ? 1 : 0]],
    0, null, null, null, null, null, null, null, null,
    1, null, null, [4],
    null, null, null, null, null, null, null, null, null, null,
    [2],
    null, null, null, null, null, null, null, null, null, null, null,
    0, null, null, null, null, null,
    uuid,
    null, [], null, null, null, null, null, null,
    2
  ];

  const outer = [null, JSON.stringify(inner)];
  return `f.req=${encodeURIComponent(JSON.stringify(outer))}`;
}

class GeminiStreamTransformer {
  constructor(model) {
    this.model = model;
    this.buffer = "";
    this.lastTextLength = 0;
    this.hasPrefix = false;
    this.id = `chatcmpl-${Math.random().toString(36).substring(2, 11)}`;
    this.encoder = new TextEncoder();
  }

  transform(chunk, controller) {
    const text = new TextDecoder().decode(chunk, { stream: true });
    this.buffer += text;

    if (!this.hasPrefix) {
      if (this.buffer.startsWith(")]}'")) {
        this.buffer = this.buffer.replace(/^\)\]}'?\s*\n?/, '');
        this.hasPrefix = true;
      } else if (this.buffer.length > 100) {
        this.hasPrefix = true;
      }
    }

    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^\d+$/.test(trimmed)) continue;

      if (trimmed.startsWith("[")) {
        const delta = this.processJsonBlock(trimmed);
        if (delta) {
          const sseLine = `data: ${JSON.stringify(this.formatChunk(delta))}\n\n`;
          controller.enqueue(this.encoder.encode(sseLine));
        }
      }
    }
  }

  flush(controller) {
    const trimmed = this.buffer.trim();
    if (trimmed.startsWith("[")) {
      const delta = this.processJsonBlock(trimmed);
      if (delta) {
        const sseLine = `data: ${JSON.stringify(this.formatChunk(delta))}\n\n`;
        controller.enqueue(this.encoder.encode(sseLine));
      }
    }
    controller.enqueue(this.encoder.encode("data: [DONE]\n\n"));
  }

  processJsonBlock(jsonStr) {
    try {
      const envelope = JSON.parse(jsonStr);
      if (!Array.isArray(envelope)) return "";

      for (const item of envelope) {
        if (!Array.isArray(item)) continue;
        
        let payloadStr = null;
        for (let i = 0; i < Math.min(item.length, 6); i++) {
          if (typeof item[i] === "string" && item[i].length > 20) {
            try {
              JSON.parse(item[i]);
              payloadStr = item[i];
              break;
            } catch (e) {}
          }
        }

        if (payloadStr) {
          const payload = JSON.parse(payloadStr);
          let fullText = "";

          const paths = [
            () => (Array.isArray(payload[0]) && typeof payload[0][0] === "string") ? payload[0][0] : "",
            () => payload[4]?.[0]?.[1]?.[0] || "",
            () => payload[4]?.[0]?.[1] || "",
            () => (Array.isArray(payload[1]) && typeof payload[1][0] === "string") ? payload[1][0] : "",
            () => payload[0]?.[1]?.[0] || "",
            () => payload[3]?.[0]?.[0] || "",
            () => payload[3]?.[1]?.[0] || ""
          ];

          for (const getPath of paths) {
            try {
              const candidate = getPath();
              if (typeof candidate === "string" && candidate.length > fullText.length) {
                fullText = candidate;
              }
            } catch (e) {}
          }

          if (!fullText) {
             const findLongestString = (obj, depth = 0) => {
               if (depth > 8) return "";
               let longest = "";
               if (typeof obj === "string") return obj;
               if (Array.isArray(obj)) {
                 for (const sub of obj) {
                   const s = findLongestString(sub, depth + 1);
                   if (typeof s === "string" && s.length > longest.length) longest = s;
                 }
               }
               return longest;
             };
             fullText = findLongestString(payload);
          }

          if (typeof fullText === "string" && fullText.length > this.lastTextLength) {
            const delta = fullText.substring(this.lastTextLength);
            this.lastTextLength = fullText.length;
            return delta;
          }
        }
      }
    } catch (e) {
      console.warn("[Gemini] Parse error in block:", e.message);
    }
    return "";
  }

  formatChunk(content) {
    return {
      id: this.id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null
        }
      ]
    };
  }
}

export class GeminiSessionDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ status: "ok", service: "gemini-proxy" });
    }

    if (url.pathname === "/v1/gemini/session") {
      if (request.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);
      return this.handleSeed(request);
    }

    if (url.pathname !== "/v1/chat/completions") {
      return json({ error: { message: "Not found" } }, 404);
    }
    if (request.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405);

    return this.handleChat(request);
  }

  async handleChat(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON body" } }, 400);
    }

    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m?.role === "user");
    const prompt = String(lastUser?.content || "").trim();
    if (!prompt) return json({ error: { message: "No user message found" } }, 400);

    let session = (await this.state.storage.get("session")) || {};

    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const incomingCookie = authHeader.substring(7).trim();
      if (incomingCookie && incomingCookie.includes("=") && incomingCookie !== session.cookie) {
        session.cookie = incomingCookie;
        session.updated_at = Date.now();
        await this.state.storage.put("session", session);
      }
    }

    const maxMsgs = Math.min(parsePositiveInt(this.env.GEMINI_SESSION_MAX_MSGS, 50), 100);
    const ttlMs = parsePositiveInt(this.env.GEMINI_SESSION_TTL_MS, 3 * 60 * 60 * 1000);
    const now = Date.now();
    const skipSession = String(this.env.GEMINI_SKIP_SESSION || "") === "1";

    const sessionExpired =
      !session.created_at ||
      session.message_count >= maxMsgs ||
      now - session.created_at >= ttlMs;

    if (sessionExpired) {
      if (skipSession) {
        session = {
          fsid: "", bl: "", snl: "", hl: this.env.GEMINI_HL || "en-US",
          cookie: this.env.GEMINI_COOKIE || "",
          req_hash: generateHex(32), uuid: generateUUID(),
          conversation_id: "", response_id: "", rc_id: "", aw_token: "",
          message_count: 0, created_at: now, updated_at: now
        };
      } else {
        try {
          const fresh = await fetchGeminiSession();
          session = {
            fsid: fresh.fsid || "",
            bl: fresh.bl || "boq_assistant-bard-web-server_20260325.04_p0",
            snl: fresh.snl || "",
            hl: this.env.GEMINI_HL || "en-US",
            cookie: this.buildCookieString(fresh.cookieMap),
            req_hash: generateHex(32), uuid: generateUUID(),
            conversation_id: "", response_id: "", rc_id: "", aw_token: "",
            message_count: 0, created_at: now, updated_at: now
          };
        } catch (err) {
          session = {
            fsid: "", bl: "boq_assistant-bard-web-server_20260325.04_p0", snl: "", hl: "en-US",
            cookie: "", req_hash: generateHex(32), uuid: generateUUID(),
            conversation_id: "", response_id: "", rc_id: "", aw_token: "",
            message_count: 0, created_at: now, updated_at: now
          };
        }
      }
      await this.state.storage.put("session", session);
    }

    const fReqPayload = buildFReq(prompt, session);
    const bl = session.bl || this.env.GEMINI_BL || "boq_assistant-bard-web-server_20260325.04_p0";
    const fsid = session.fsid || this.env.GEMINI_FSID || "";
    const hl = session.hl || this.env.GEMINI_HL || "en-US";
    const reqid = buildReqId();

    const endpoint = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=${encodeURIComponent(bl)}&f.sid=${encodeURIComponent(fsid)}&hl=${encodeURIComponent(hl)}&_reqid=${reqid}&rt=c`;

    const reqHeaders = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Origin": "https://gemini.google.com",
      "Referer": "https://gemini.google.com/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "x-goog-ext-525001261-jspb": JSPB_HEADER,
      "x-goog-ext-525005358-jspb": JSON.stringify([session.uuid || generateUUID(), 1])
    };

    if (session.cookie || this.env.GEMINI_COOKIE) {
      reqHeaders["Cookie"] = session.cookie || this.env.GEMINI_COOKIE;
    }

    let upstream;
    try {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: reqHeaders,
        body: fReqPayload
      });
    } catch (err) {
      return json({ error: { message: `Network error: ${err.message}` } }, 502);
    }

    if (!upstream.ok) {
      const errorText = await upstream.text();
      return json({ error: { message: `Gemini HTTP ${upstream.status}`, detail: errorText.slice(0, 500) } }, upstream.status);
    }

    const isStream = body.stream !== false;
    const model = body.model || "gemini-web";

    if (isStream) {
      const transformer = new GeminiStreamTransformer(model);
      const transformedStream = upstream.body.pipeThrough(new TransformStream(transformer));

      return new Response(transformedStream, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } else {
      return upstream; 
    }
  }

  async handleSeed(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON" } }, 400);
    }

    const session = (await this.state.storage.get("session")) || {};

    if (body?.f_req_template) {
      const tpl = body.f_req_template;
      if (!Array.isArray(tpl)) return json({ error: { message: "f_req_template must be array" } }, 400);
      session.template = JSON.stringify(tpl);
      session.req_token = String(tpl[3] || session.req_token || "");
      session.req_hash = String(tpl[4] || session.req_hash || "");
    }

    if (body?.cookie) session.cookie = String(body.cookie);
    if (body?.bl) session.bl = String(body.bl);
    if (body?.fsid) session.fsid = String(body.fsid);
    if (body?.hl) session.hl = String(body.hl);
    session.updated_at = Date.now();

    await this.state.storage.put("session", session);
    return json({ ok: true, session: this.safeSessionSummary(session) });
  }

  buildCookieString(cookieMap) {
    return Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  safeSessionSummary(session) {
    return {
      has_template: Boolean(session.template),
      has_cookie: Boolean(session.cookie),
      bl: session.bl || "",
      fsid: session.fsid || "",
      hl: session.hl || "",
      conversation_id: session.conversation_id || "",
      message_count: session.message_count || 0
    };
  }
}
