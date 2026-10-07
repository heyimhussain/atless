# <img src="public/favicon.svg" alt="Atless logo" width="36" height="36"> Atless — more productivity, less clutter.

Atless is an infinite spatial canvas for capturing and connecting your thoughts with zero clutter. Gather text notes, images, videos, audio files, voice recordings and YouTube embeds on a persistent, zoomable board. Leverage Google Gemini for instant summaries and answers, Transcribe your recordings and audio files, and use Read aloud for seamless, professional Test-to-Speech, then share your complete canvas with a single custom link.

## Features

| Area | What you get |
| --- | --- |
| Infinite canvas | Shift + drag to pan, scroll to zoom, living ASCII-wave background that ripples around your cursor |
| Text notes | Double-click anywhere to spawn one; drag, resize, rename, read aloud (ElevenLabs TTS) |
| Images & video | Drag & drop files; aspect ratio locked; images auto-optimized for storage |
| YouTube | Drag in any watch / share / Shorts / live link for a playable embed |
| Voice notes | Hold `Space` or toggle `R` to record; custom player, ElevenLabs transcription, download |
| Ask Gemini | Star button opens a prompt pill over the whole canvas (text, transcripts, recordings, images); right-click any tile → Ask Gemini for that tile alone — answers land as Markdown + LaTeX tiles |
| Organization | Click / Ctrl+click / box-select / Ctrl+A (links included), move groups together, tile z-ordering, curved connection arrows |
| Share links | Chain-icon button copies a `atless.tech/#/s/<id>` link; anyone opening it loads your exact canvas as an editable copy (Worker + Tiger Data, see below) |
| Search | `Ctrl+F` finds titles and note text, then flies the camera to the match |
| Persistence | Tiles auto-save to localStorage (with quota-safe degradation) |
| Theming | Light + dark mode with persisted preference |

## Keyboard & mouse cheatsheet

| Input | Action |
| --- | --- |
| Shift + drag | Pan canvas |
| Scroll wheel | Zoom in / out |
| Double-click (background) | New text note |
| Double-click (tile title) | Rename tile |
| Drag background | Box select tiles + the links between them (`Ctrl` adds to selection) |
| Ctrl + click | Toggle tile / connection in selection |
| Ctrl + A | Select all tiles |
| Delete | Delete selected tiles / connections |
| Hold Space, or press R | Record / stop voice note |
| Right-click tile (or the ⋯ button on YouTube tiles) | Context menu (read aloud, transcribe, download, ask Gemini, connect) |
| Ctrl + F | Search titles, notes, transcripts |
| Right-click → Make connection | Link two tiles with a curved arrow |
| Esc | Cancel connection / close menus |
| Chain-icon button | Copy a shareable link to this canvas |
| `?` | Shortcut guide |

## Getting started

Requirements: **Node.js 20+** (Vite 8 does not build on Node 18).

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → ./dist
npm run preview  # preview the production build
```

## Environment variables (`.env`)

AI features need keys. Copy these into a `.env` file in the project root
(**never commit it** — it's git-ignored):

```bash
VITE_ELEVENLABS_API_KEY=your-elevenlabs-key
VITE_GEMINI_API_KEY=your-gemini-api-studio-key
VITE_SHARE_API_URL=http://localhost:8787
```

> Restart `npm run dev` after creating or changing `.env` — Vite only
> reads it at startup. **Production** (`atless.tech`) bakes these in at
> build time, so set the same names as repo
> **Settings → Secrets and variables → Actions** secrets — see
> `server/README.md` for the share API.

| Key | Used for | Notes |
| --- | --- | --- |
| `VITE_ELEVENLABS_API_KEY` | Text-to-speech previews, voice-note transcription | Needs available character credits |
| `VITE_GEMINI_API_KEY` | Canvas summaries, image explanations | Must be a Google AI Studio key (`AIza…`) |
| `VITE_SHARE_API_URL` | Generate-link button, opening shared links | Cloudflare Worker URL; graceful "not configured" toast when unset |

> Restart `npm run dev` after creating or changing `.env` — Vite only
> reads it at startup.

| Key | Used for | Notes |
| --- | --- | --- |
| `VITE_ELEVENLABS_API_KEY` | Text-to-speech previews, voice-note transcription | Needs available character credits |
| `VITE_GEMINI_API_KEY` | Canvas summaries, image explanations | Must be a Google AI Studio key (`AIza…`) |

## AI models & endpoints

| Feature | Provider | Model / voice |
| --- | --- | --- |
| Read aloud | ElevenLabs TTS | Voice `JBFqnCBsd6RMkjVDRZzb`, model `eleven_multilingual_v2` (see `TTS_MODEL_ID` in `App.jsx`) |
| Transcribe | ElevenLabs Scribe | `scribe_v2` via `POST /v1/speech-to-text` |
| Ask / Q&A | Google Gemini | `gemini-3.8-flash` with one retry on 429/503 (see `GEMINI_MODELS` in `App.jsx`), Markdown + LaTeX answers |

If a provider retires a model (HTTP 404 naming its replacement), update the
constant above — the app surfaces API error details in toasts and tooltips.

## Assets & credits

| Asset | Source |
| --- | --- |
| Typefaces | [DM Sans](https://fonts.google.com/specimen/DM+Sans) (body text) + [Outfit](https://fonts.google.com/specimen/Outfit) (display/titles), loaded from Google Fonts in `index.html` |
| Sailship logo / favicon | Original `public/favicon.svg` — also the mark beside this README's title |
| UI icons | [`lucide-react`](https://lucide.dev) everywhere (it ships no brand icons, so the About tab's GitHub mark is the official SVG inlined) |
| Stormy | `public/stormy.gif`, via [stormhacks.com/faq](https://www.stormhacks.com/faq) |
| Background glyphs | Plain unicode (`· ~ ≈ ∿ ≋`) painted on canvas — no font or image dependency |
| AI + data services | Google Gemini, ElevenLabs, Tiger Data (Postgres), Cloudflare Workers/Hyperdrive — keys in `.env`, backend in `server/README.md` |

## Project structure

```text
├── index.html                  # title, favicon, pre-paint theme script
├── public/favicon.svg          # app logo / favicon
├── public/stormy.gif            # Stormy (see the hint at the bottom)
├── src/
│   ├── main.jsx                # React entry
│   ├── index.css               # Tailwind, fonts, wave layer, animation + scrollbar helpers
│   ├── App.jsx                 # canvas, tiles state, recording, search,
│   │                           #   selection, connections, AI calls, share links, persistence
│   └── components/
│       ├── TopPillHeader.jsx   # floating pill (logo, help, links, summarize, share, theme)
│       ├── TextNote.jsx        # editable text tile + TTS preview
│       ├── MediaTile.jsx       # image / video / YouTube tile
│       ├── AudioTile.jsx       # voice player + transcript
│       ├── SummaryTile.jsx     # Gemini answer tile (Markdown + LaTeX)
│       ├── TileMenu.jsx        # right-click tile context menu
│       ├── TileName.jsx        # inline tile rename field
├── src/lib/
│   ├── tileName.js             # display-name fallback (custom name, first word, type)
│   └── highlight.jsx           # search match highlighting (accent-tinted marks)
├── server/                     # share-link backend (see server/README.md)
│   ├── src/index.js            # Cloudflare Worker: POST/GET /api/shares to Tiger Data
│   ├── schema.sql              # shares table migration (run once via psql)
│   └── wrangler.toml           # worker + Hyperdrive binding config
└── .github/workflows/deploy.yml  # CI: build, deploy to Pages
```

## How it works (internals worth knowing)

- **Pan/zoom** — `react-zoom-pan-pinch` (`Shift`-gated panning, `0.001`
  wheel step). The dot grid is a viewport layer whose `background-position`
  is written straight to the DOM on every transform (no React re-render lag).
- **Tiles** — `react-rnd` with a dedicated `tile-drag-handle`,
  `cancel=".no-drag"` for inner controls, zoom-aware `scale`, and a fixed
  stacking order: text (40) > audio (30) > video (20) > photo (10).
  Connection arrows sit at z-25: above photos and videos so links stay
  visible, below audio and text so they never cross readable content.
- **Names** — every tile shows its custom name, else a text note's first
  word, else a per-type fallback (`src/lib/tileName.js` — shared by tile
  headers, search-adjacent lists, and the connections panel).
- **Share links** — the chain button `POST`s `{ tiles, connections }` to
  the Worker (`VITE_SHARE_API_URL`), which stores one `shares` row and
  returns an id. The copied `/#/s/<id>` link loads that exact canvas as an
  editable local copy (hash is dropped after load so refresh uses autosave).
- **Coordinates** — screen ↔ content mapping assumes the library's
  `transform-origin: 0 0`: `content = (client − wrapperOrigin − pan) / scale`.
- **Persistence** — debounced `localStorage` snapshots. Images are
  downscaled (≤1600px) on import; if the ~5MB quota still blows, the heaviest
  media payloads are shed first so notes and layout always survive.

## Deployment

Pushes to `main` build and deploy `./dist` to GitHub Pages via
`.github/workflows/deploy.yml`. In repo **Settings → Pages**, set the source
to **GitHub Actions**. `VITE_*` keys bake in at build time, so production
needs the same names as **Actions secrets** (not just local `.env`).
Serves from a subpath (e.g. `*.github.io/atless/`)?
Use relative asset paths or set Vite's `base` accordingly.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| AI buttons report missing key | Dev server started before `.env` existed — restart it |
| `HTTP 401` from an API | Wrong/revoked key, or (ElevenLabs) spent credits |
| `HTTP 404` naming a new model | Provider retired the model — update the constant |
| `QuotaExceededError` in console | Huge canvas — autosave sheds media, notes are safe |
| Microphone won't start | Browser blocked the permission — allow it and retry |
| Favicon stale after redeploy | Browsers cache icons hard — the `?v=` query on the link tag busts it |
| Share button: "API not configured" | `VITE_SHARE_API_URL` missing — add it to `.env` (restart dev) or Actions secrets (push to rebuild) |
| Share failed (HTTP 405) | The secret holds a markdown link (`[url](url)`) instead of the bare Worker URL — fix the secret, push to rebuild |
| Shared link won't load | Stale Worker — redeploy with `npx wrangler deploy` from `server/` |
| Share too large | Canvas exceeds ~15MB inline — drop some media until object-storage uploads land |

`git commit -m "added easter egg - hint 'S_o_mHack_'"`
