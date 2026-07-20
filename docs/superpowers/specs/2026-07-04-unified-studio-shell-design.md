# Unified Studio Shell — Design Spec

Date: 2026-07-04
Status: Draft, pending user review

## Goal

Merge the three Fractal Brushes apps — `/app/` (luminous), `/white/` (ink), `/liquid-mix/` (water) — into one fluid, seamless art-generator experience. The user experience is the priority: switching between canvases must feel like moving between rooms of a single studio, never like navigating between websites.

## Decisions (confirmed with user)

1. **Merge depth: one shell, three studios.** Each canvas keeps its own renderer. Navigation, transitions, and UI language become one seamless experience. No renderer rewrites.
2. **Entry point: the canvas is the homepage.** Visiting `/` opens directly into a live studio. The marketing landing content moves into an About overlay.
3. **State on switch: every studio stays alive** (chosen on user's behalf while away — recommended option). Switching is instant and non-destructive within a session; artwork, undo history, and simulation state survive. Cross-reload persistence is out of scope (future enhancement).

## Architecture: persistent iframe shell

A new root `index.html` is a lightweight app shell. Each studio is hosted in a same-origin iframe that is created lazily on first activation and never destroyed afterwards.

Why this over alternatives:

- **Cross-document View Transitions** (separate pages + `@view-transition`): state survival becomes lossy snapshot/restore; WebGL fluid state and wet-ink blooms cannot be serialized; partial browser support.
- **Single-document merge**: ~9k lines of global-scope inline script across three incompatible renderers; high regression risk for a nearly identical user-visible result.

The iframe shell keeps renderers untouched, stays dependency-free and GitHub-Pages-static, keeps every existing URL and Playwright suite working, and makes "alive" state literal rather than simulated.

## Components

### 1. Studio shell (`/index.html`, rewritten)

- Full-viewport stage holding up to three studio iframes; only the active one is visible and interactive.
- **Studio switcher**: a minimal floating control (three studio marks). Activating it expands a full-screen picker showing *live scaled previews* of each studio's actual iframe — the user sees their own artwork in each thumbnail. Selecting a studio runs the switch transition.
- **Switch transition**: outgoing studio scales down slightly and dims while the incoming one rises and fades in, 300–400 ms, `prefers-reduced-motion` collapses it to an instant cut.
- **About overlay**: the essential product story from the old landing page (what it is, the three studios, GitHub link, license), presented as an in-shell overlay. The old standalone landing page is retired.
- **Routing**: hash deep links `/#luminous`, `/#ink`, `/#liquid`. Last-used studio stored in `localStorage`; first visit opens luminous.
- **Focus management**: on activation, the shell focuses the active iframe so each app's keyboard shortcuts keep working.

### 2. Embed protocol (small additions to each app)

Each of `/app/index.html`, `/app/mobile/index.html`, `/white/index.html`, `/liquid-mix/index.html` gains a small embed adapter (~20 lines):

- Detect embedding via `window.top !== window`.
- Post `{ type: "fb:ready" }` to the parent when interactive.
- Listen for `{ type: "fb:pause" }` / `{ type: "fb:resume" }`: pause/resume requestAnimationFrame loops and any ambient simulation while hidden (battery/memory).
- Hide standalone-only chrome (e.g. "back to home" links) when embedded.

Standalone behavior at the existing URLs is unchanged — `/app/`, `/app/mobile/`, `/white/`, `/liquid-mix/` continue to work exactly as today, which keeps all existing Playwright suites green and honors the AGENTS.md constraint not to move `/app/`.

### 3. Design unification pass

Shared design tokens applied inside each app so the studios read as one product:

- One font stack and type scale across all top bars.
- A consistent accent/brand color language (each studio may keep its own canvas mood — luminous dark, ink paper-white, liquid water — but chrome styling, button shapes, and iconography align).
- Consistent top-bar layout: undo/redo/clear/export in the same positions in every studio.

### 4. Mobile

The shell is responsive. The luminous iframe loads `/app/`, whose existing coarse-pointer redirect sends it to `/app/mobile/` inside the frame. `?desktop=1` opt-out continues to work. No new mobile routing logic.

## Data flow

- Shell → studio: `fb:pause`, `fb:resume` (postMessage, same origin).
- Studio → shell: `fb:ready` (used to swap a loading shimmer for the live frame).
- No shared drawing state crosses the boundary in this phase.

## Error handling

- If a studio iframe fails to load or never posts `fb:ready` within a timeout, the shell shows a retry card for that studio; the others remain usable.
- If `localStorage` is unavailable (private browsing), the shell falls back to luminous default and in-memory last-used tracking.
- Browsers without needed features degrade gracefully: the transition is progressive enhancement over an instant switch.

## Performance

- Lazy iframe creation: WebGL context and ink simulation only boot when a studio is first visited.
- Hidden studios are paused via `fb:pause`; at most one render loop runs at a time (brief overlap during the transition).
- The live-preview picker uses the existing iframes scaled via CSS transform — no extra rendering work. Paused studios show their last rendered frame, which still displays the user's artwork; only the active studio animates.

## Testing

- New `tests/studio-shell.spec.js`:
  - `/` boots into a studio with no console errors.
  - Switching studios and returning preserves canvas pixels (draw → switch → return → assert).
  - Deep links `/#ink`, `/#liquid` open the right studio; last-used studio is restored on reload.
  - Pause/resume messaging fires (hidden studio's RAF stops).
  - Export downloads a PNG from within the shell.
  - Mobile viewport: shell usable at 390 px; luminous frame lands on the mobile app.
- All existing suites (`brush-density`, `ink-*`, `liquid-mix`, `mobile-*`, `infinite-zoom`, `tutorial`, `render-qa`, …) must continue to pass against the standalone URLs unchanged.

## Out of scope (explicitly deferred)

- Cross-studio artwork transfer (e.g. dropping a luminous piece into the water). Candidate follow-up feature.
- Cross-reload persistence of artwork (localStorage autosave of stroke logs).
- Merging renderers into a single canvas.
- Splitting the large inline-script files (per POLISH_BACKLOG, deferred).

## Delivery phases

1. **Shell foundation** — new root shell with the luminous studio embedded, About overlay carrying the landing story, hash routing.
2. **Embed protocol** — ready/pause/resume adapter in all four app files; lazy creation and pausing wired in the shell.
3. **Switcher & transitions** — live-preview picker, animated switch, focus handoff, reduced-motion support.
4. **Design unification** — shared tokens and consistent chrome across studios.
5. **QA** — new shell Playwright suite; full existing suite kept green; README/AGENTS.md route documentation updated.
