# atless share API (Cloudflare Worker → Tiger Data)

The browser never touches Postgres directly — the Worker holds the
connection string and exposes two endpoints:

- `POST /api/shares` `{ tiles, connections }` → `{ id }`
- `GET /api/shares/:id` → `{ version, tiles, connections }`

The frontend's Generate Link button copies
`https://atless.tech/#/s/<id>`; opening it loads an editable local copy.

## 0. Rotate the Tiger password first

The credentials file was handled outside the repo (and pasted into chat),
so treat that password as exposed: Tiger Cloud dashboard → your service →
reset password. Nothing under `server/` contains secrets — keep it that way.
`server/.dev.vars` (local dev only) is git-ignored.

## 1. Create the table (once, from your machine)

```bash
psql "postgres://<user>:<NEW-password>@<host>:<port>/tsdb?sslmode=require" -f server/schema.sql
```

## 2. Hyperdrive (production DB access)

Workers can't open raw TCP to Postgres, so Cloudflare Hyperdrive proxies it:

```bash
cd server
npm install
npx wrangler hyperdrive create atless-db --connection-string="postgres://<user>:<NEW-password>@<host>:<port>/tsdb?sslmode=require"
```

Paste the returned Hyperdrive `id` into `wrangler.toml`
(`REPLACE_WITH_HYPERDRIVE_ID`).

## 3. Deploy

```bash
npx wrangler deploy
# → https://atless-share-api.<you>.workers.dev
```

Optional: `ALLOWED_ORIGINS` extra origins via
`npx wrangler secret put ALLOWED_ORIGINS` (comma-separated).

## 4. Point the frontend at it

- Local: add `VITE_SHARE_API_URL=http://localhost:8787` to `.env`
  (local Worker via `npx wrangler dev`), restart `npm run dev`.
- Production: repo Settings → Secrets and variables → Actions → new secret
  `VITE_SHARE_API_URL=https://atless-share-api.<you>.workers.dev`,
  then push (Pages rebuild bakes it in — same as the Gemini/ElevenLabs keys).

## 5. Test

1. Add tiles + a connection → Generate Link (chain icon) → toast confirms copy.
2. Open the link in an incognito window → exact canvas loads as an editable
   copy (autosaves locally from then on).

## Next: object storage

Media is currently inline data URLs inside the JSON row (capped at ~15MB —
the API 413s beyond that). When you have R2/S3: add presigned `POST
/api/uploads` here, swap `src` to public URLs in the share payload, raise
the cap.
