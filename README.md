# Atless — more productivity, less clutter.

Atless is an infinite spatial canvas for collecting what's on your mind:
typed notes, images, videos, YouTube embeds, voice recordings with
transcripts, and AI-generated summaries — all as movable, resizable tiles
on a pannable, zoomable board that persists across visits.

![Atless canvas](public/favicon.svg)

## Features

| Area | What you get |
| --- | --- |
| Infinite canvas | Shift + drag to pan, scroll to zoom, living ASCII-wave background that ripples around your cursor |
| Text notes | Double-click anywhere to spawn one; drag, resize, rename, read aloud (ElevenLabs TTS) |
| Images & video | Drag & drop files; aspect ratio locked; images auto-optimized for storage |
| YouTube | Drag in any watch / share / Shorts / live link for a playable embed |
| Voice notes | Hold `Space` or toggle `R` to record; custom player, ElevenLabs transcription, download |
| AI summaries | One-click Gemini synthesis of notes, transcripts, images (multimodal), and video links |
| Organization | Click / Ctrl+click / box-select / Ctrl+A, move groups together, tile z-ordering, curved connection arrows |
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
| Drag background | Box select |
| Ctrl + click | Toggle tile in selection |
| Ctrl + A | Select all tiles |
| Delete / Backspace | Delete selected tiles |
| Hold Space, or press R | Record / stop voice note |
| Right-click tile | Context menu (read aloud, transcribe, download, explain) |
| Ctrl + F | Search tiles |
| Right-click → Make connection | Link two tiles with a curved arrow (Esc cancels) |
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
```

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
| Summarize / Explain | Google Gemini | `gemini-3.8-flash` via `:generateContent` (see `GEMINI_MODEL` in `App.jsx`) |

If a provider retires a model (HTTP 404 naming its replacement), update the
constant above — the app surfaces API error details in toasts and tooltips.

## Project structure

```text
├── index.html                  # title, favicon, pre-paint theme script
├── public/favicon.svg          # app logo / favicon
├── src/
│   ├── main.jsx                # React entry
│   ├── index.css               # Tailwind, fonts, wave layer, animation + scrollbar helpers
│   ├── App.jsx                 # canvas, tiles state, recording, search,
│   │                           #   selection, AI calls, persistence
│   └── components/
│       ├── TopPillHeader.jsx   # floating pill: logo, theme, help, summarize
│       ├── TextNote.jsx        # editable text tile + TTS preview
│       ├── MediaTile.jsx       # image / video / YouTube tile
│       ├── AudioTile.jsx       # voice player + transcript
│       ├── SummaryTile.jsx     # Gemini synthesis tile
│       ├── TileMenu.jsx        # right-click tile context menu
│       └── TileName.jsx        # inline tile rename field
└── .github/workflows/deploy.yml  # CI: build on Node 20/22, deploy to Pages
```

## How it works (internals worth knowing)

- **Pan/zoom** — `react-zoom-pan-pinch` (`Shift`-gated panning, `0.001`
  wheel step). The dot grid is a viewport layer whose `background-position`
  is written straight to the DOM on every transform (no React re-render lag).
- **Tiles** — `react-rnd` with a dedicated `tile-drag-handle`,
  `cancel=".no-drag"` for inner controls, zoom-aware `scale`, and a fixed
  stacking order: text (40) > audio (30) > video (20) > photo (10).
- **Coordinates** — screen ↔ content mapping assumes the library's
  `transform-origin: 0 0`: `content = (client − wrapperOrigin − pan) / scale`.
- **Persistence** — debounced `localStorage` snapshots. Images are
  downscaled (≤1600px) on import; if the ~5MB quota still blows, the heaviest
  media payloads are shed first so notes and layout always survive.

## Deployment

Pushes to `main` build and deploy `./dist` to GitHub Pages via
`.github/workflows/deploy.yml`. In repo **Settings → Pages**, set the source
to **GitHub Actions**. Serves from a subpath (e.g. `*.github.io/atless/`)?
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
