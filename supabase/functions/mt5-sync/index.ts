const project = Deno.env.get("SUPABASE_URL") ?? "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const portalOrigin = "https://infolonsocietyacademy.github.io";
const headers = {
  "Access-Control-Allow-Origin": portalOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const response = (data: unknown, status = 200) => Response.json(data, { headers, status });
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const random = (size: number) => hex(crypto.getRandomValues(new Uint8Array(size)));
const hash = async (value: string) => hex(new Uint8Array(
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
));
const validDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("body");
  let size = 0, text = "";
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 96_000) {
      await reader.cancel();
      throw new Error("size");
    }
    text += decoder.decode(value, { stream: true });
  }
  const body = JSON.parse(text + decoder.decode());
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body");
  return body;
}

function validDeal(deal: Record<string, unknown>) {
  if (!deal || typeof deal !== "object") return false;
  const time = deal.broker_time;
  return typeof deal.ticket === "string" && /^[1-9]\d{0,19}$/.test(deal.ticket)
    && typeof deal.symbol === "string" && deal.symbol.length <= 48
    && typeof deal.kind === "string" && ["buy", "sell", "cancelled", "commission"].includes(deal.kind)
    && typeof deal.entry === "string" && ["in", "out", "inout", "out_by", ""].includes(deal.entry)
    && typeof time === "string" && /^20\d{2}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)
    && validDate(time.slice(0, 10))
    && [deal.profit, deal.commission, deal.swap, deal.fee].every(amount =>
      typeof amount === "number" && Number.isFinite(amount) && Math.abs(amount) < 1e15);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return response({ error: "method" }, 405);
  if (!project || !service || !publicKey) return response({ error: "unavailable" }, 503);
  let body;
  try { body = await readBody(req); }
  catch { return response({ error: "body" }, 400); }

  const action = body.action;
  const authorization = req.headers.get("Authorization") ?? "";
  let student: string | null = null;
  let credential = "";
  const payload: Record<string, unknown> = {};
  try {
    if (action === "pair" || action === "sync") {
      if (typeof body.login !== "string" || !/^[1-9]\d{0,19}$/.test(body.login)
        || typeof body.server !== "string" || body.server.length < 1 || body.server.length > 120
        || typeof body.currency !== "string" || !/^[A-Z0-9]{2,12}$/.test(body.currency)) {
        return response({ error: "account" }, 400);
      }
      Object.assign(payload, { login: body.login, server: body.server, currency: body.currency });
      if (action === "pair") {
        if (typeof body.code !== "string" || !/^[a-f0-9]{32}$/.test(body.code)) {
          return response({ error: "access" }, 403);
        }
        credential = random(32);
        payload.key_hash = await hash(body.code);
        payload.token_hash = await hash(credential);
      } else {
        const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1];
        if (!token) return response({ error: "access" }, 403);
        if (!Array.isArray(body.deals) || body.deals.length > 100
          || !body.deals.every(validDeal)
          || new Set(body.deals.map((deal: { ticket: string }) => deal.ticket)).size !== body.deals.length) {
          return response({ error: "deals" }, 400);
        }
        payload.key_hash = await hash(token);
        payload.deals = body.deals;
      }
    } else if (["code", "disconnect", "month", "day"].includes(action)) {
      if (!/^Bearer [\w.-]+$/.test(authorization)) return response({ error: "session" }, 401);
      const auth = await fetch(project + "/auth/v1/user", { headers: { authorization, apikey: publicKey } });
      if (auth.status >= 500) return response({ error: "unavailable" }, 503);
      if (!auth.ok) return response({ error: "session" }, 401);
      student = (await auth.json()).id;
      if (!student) return response({ error: "session" }, 401);
      if (action === "code") {
        credential = random(16);
        payload.key_hash = await hash(credential);
      }
      if (action === "month" || action === "day") {
        if (!validDate(body.date) || (action === "month" && !body.date.endsWith("-01"))) {
          return response({ error: "date" }, 400);
        }
        payload.date = body.date;
      }
      if (action === "day") {
        if (typeof body.account !== "string" || !/^[a-f0-9-]{36}$/.test(body.account)
          || !Number.isInteger(body.offset) || body.offset < 0 || body.offset > 1_000_000) {
          return response({ error: "day" }, 400);
        }
        Object.assign(payload, { account: body.account, offset: body.offset });
      }
    } else return response({ error: "action" }, 400);

    const db = await fetch(project + "/rest/v1/rpc/olon_mt5_service", {
      method: "POST",
      headers: { authorization: "Bearer " + service, apikey: service, "Content-Type": "application/json" },
      body: JSON.stringify({ p_action: action, p_payload: payload, p_student: student }),
    });
    if (!db.ok) {
      console.error("OLON MT5 RPC", action, db.status, (await db.json().catch(() => ({}))).code);
      return response({ error: "unavailable" }, 503);
    }
    const result = await db.json();
    if (result.error) return response({ error: result.error }, result.error === "account" ? 409 : 403);
    if (action === "code") return response({ ...result, code: credential });
    if (action === "pair") return response({ token: credential });
    return response(result);
  } catch {
    return response({ error: "unavailable" }, 503);
  }
});
