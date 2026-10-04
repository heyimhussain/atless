import postgres from "postgres";

// Pending object storage (R2/S3): media stays inline as data URLs,
// so cap the share payload. Raise this once uploads land.
const MAX_SHARE_BYTES = 15_000_000;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const TILE_TYPES = new Set([
  "text",
  "image",
  "video",
  "audio",
  "youtube",
  "summary",
]);

function newId(n = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  const abc =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (const b of bytes) s += abc[b & 63];
  return s;
}

function corsHeaders(origin, env) {
  const allowed = String(
    env.ALLOWED_ORIGINS ||
      "https://atless.tech,https://www.atless.tech,http://localhost:5173",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function getSql(env) {
  // Workers can't open raw TCP to Postgres — Hyperdrive provides the pooled
  // connection string. Plain DATABASE_URL is for `wrangler dev` only.
  if (env.HYPERDRIVE) return postgres(env.HYPERDRIVE.connectionString);
  if (env.DATABASE_URL) return postgres(env.DATABASE_URL, { ssl: "require" });
  throw new Error("No database configured (HYPERDRIVE or DATABASE_URL)");
}

// Mirror of the frontend sanitizer: only well-formed tiles + links between
// tiles that actually exist get stored.
function validPayload(body) {
  if (!body || typeof body !== "object") return false;
  if (!Array.isArray(body.tiles) || !Array.isArray(body.connections))
    return false;
  for (const t of body.tiles) {
    if (!t || typeof t !== "object") return false;
    if (typeof t.id !== "string" || !TILE_TYPES.has(t.type)) return false;
    for (const k of ["x", "y", "w", "h"]) {
      if (!Number.isFinite(+t[k])) return false;
    }
    if (t.src !== undefined) {
      if (typeof t.src !== "string" || t.src.startsWith("blob:")) return false;
    }
  }
  const ids = new Set(body.tiles.map((t) => t.id));
  for (const c of body.connections) {
    if (
      !c ||
      typeof c.from !== "string" ||
      typeof c.to !== "string" ||
      !ids.has(c.from) ||
      !ids.has(c.to)
    )
      return false;
  }
  return true;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const base = corsHeaders(origin, env);
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json", ...base },
      });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: base });

    const url = new URL(request.url);
    const bad = (msg, status = 400) => json({ error: msg }, status);
    let sql;
    try {
      if (url.pathname === "/api/shares" && request.method === "POST") {
        const raw = await request.text();
        if (raw.length > MAX_SHARE_BYTES)
          return bad(
            "Share too large — remove some media and try again (uploads coming soon).",
            413,
          );
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return bad("Invalid JSON.");
        }
        if (!validPayload(body)) return bad("Invalid share payload.");
        const payload = JSON.stringify({
          version: 1,
          tiles: body.tiles,
          connections: body.connections,
        });
        sql = getSql(env);
        for (let attempt = 0; attempt < 3; attempt++) {
          const id = newId();
          try {
            await sql`insert into shares (id, payload) values (${id}, ${payload}::jsonb)`;
            return json({ id });
          } catch (e) {
            if (e?.code !== "23505") throw e; // id collision → retry
          }
        }
        return bad("Could not allocate a share id, try again.", 500);
      }

      const m = url.pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{8,32})$/);
      if (m && request.method === "GET" && SHARE_ID_RE.test(m[1])) {
        sql = getSql(env);
        const rows =
          await sql`select payload from shares where id = ${m[1]} limit 1`;
        if (rows.length === 0) return bad("Share not found.", 404);
        // The driver may hand jsonb back as text — normalize to an object
        // before re-encoding so clients always get { tiles, connections }.
        let payload = rows[0].payload;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch {
            return bad("Share not found.", 404);
          }
        }
        if (
          !payload ||
          typeof payload !== "object" ||
          !Array.isArray(payload.tiles) ||
          !Array.isArray(payload.connections)
        )
          return bad("Share not found.", 404);
        return json(payload);
      }
      return bad("Not found.", 404);
    } catch (err) {
      console.error("share api error:", err?.message || err);
      return json({ error: "Server error." }, 500);
    } finally {
      try {
        await sql?.end();
      } catch {
        /* noop */
      }
    }
  },
};
