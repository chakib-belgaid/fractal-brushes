# Infinite Zoom Canvas — Design

**Date:** 2026-07-02
**Scope:** `app/index.html` (desktop) and `app/mobile/index.html` (mobile)
**Status:** Approved

## Goal

Turn the drawing surface into an infinite canvas: zoom in, draw, zoom out, keep
drawing. Brush size is relative to the current zoom, so the same brush produces
strokes at any scale. Previously drawn strokes always re-render crisp at the
current zoom, at effectively unlimited depth.

## Current state (why this needs architecture)

The app is raster-only. Strokes spawn "tendril" particles simulated per rAF
frame with `Math.random()` and painted with additive `lighter` compositing
straight onto a 2D canvas. Nothing but pixels survives a stroke. Undo is a
stack of 5–8 full-canvas raster snapshots. "Zoom" is a CSS `scale()` on a
virtual canvas ~1.5–1.8× the viewport, clamped to roughly 0.55×–2.4×.

There is no vector data — but strokes are procedurally generated from pointer
input + brush parameters, so recording those inputs makes every stroke
replayable at any scale. That is the chosen approach (over a raster mip
pyramid, which cannot zoom crisply, and over a tile pyramid cache, which is
follow-up material if replay ever gets slow).

## 1. World model & coordinates

- The world is an infinite 2D plane. Coordinates are float64 world units.
- The **view** is `{ centerX, centerY, scale }`, where `scale` = screen px per
  world unit. Usable zoom range is bounded only by double precision
  (~×10¹² — effectively infinite).
- **Stroke record** (appended to an in-memory ordered log on pointer-up):

  ```
  {
    seed,                    // PRNG seed for this stroke
    brush, hue, hue2, blend, // brush + color settings at stroke time
    size, scaleFactor, expansion, symmetry, mirror,
    symCenter: { x, y },     // world point at screen center at stroke start
    drawScale,               // view scale at stroke start
    points: [{ x, y, dt }],  // pointer path in world coords + inter-event ms
    bbox                     // precomputed world-space bounds incl. symmetry copies
  }
  ```

- `drawScale` makes brush geometry (tendril length, width, wander amplitude)
  proportional: a stroke drawn at ×100 zoom is 100× finer in world units.
- **Symmetry center is per stroke**: the world point at screen center when the
  stroke starts. Each zoom level can host its own local mandala — fractals
  within fractals. Mirrored copies are generated around that recorded point on
  every replay.
- **Session only.** The log lives in memory; reload starts fresh. Persistence
  is explicitly out of scope for v1.

## 2. Rendering & determinism

**Live drawing is unchanged in feel.** While the pointer is down, tendrils
spawn and animate in screen space on top of the existing canvas raster exactly
as today. On pointer-up the stroke is committed to the log; the pixels already
on canvas are the committed result, so no re-render happens.

**Deterministic replay** requires two engine changes:

1. All randomness inside stroke generation (spawn angles, wander noise,
   widths) comes from a per-stroke mulberry32 PRNG seeded from the stroke
   record. `Math.random()` disappears from the stroke path (it may remain in
   non-stroke cosmetics).
2. Tendril simulation runs on a fixed virtual timestep (60 steps/s
   accumulator). Live drawing advances it in real time; replay advances it in
   a tight loop so strokes reappear fully formed — no re-animation.

Replaying a stroke at any scale must produce the same shape, resized.

**View changes.** During a wheel/pinch/pan gesture the current canvas raster
is transformed cheaply (`drawImage`/CSS) — momentarily soft, map-app style.
~150 ms after the gesture settles, the viewport re-renders crisp:

- paint the background gradient;
- replay every stroke whose `bbox` intersects the viewport, in original log
  order (preserves additive `lighter` blending);
- run in budgeted chunks across frames (no UI freeze); keep the soft preview
  visible until the crisp render swaps in atomically.

**Level-of-detail guards:**

- Stroke on-screen extent < ~1 px → render a faint dot, skip simulation.
- Zoomed far in → clip tendril segments outside the viewport.

Both bound replay cost at extreme zoom in either direction.

## 3. Navigation, tools & export

**Desktop:** wheel / trackpad-pinch zooms about the cursor (world point under
cursor stays fixed). The zoom cluster becomes unbounded: buttons step ×1.25,
the readout shows absolute zoom (×0.1 … ×47,000 …), and a reset affordance
returns to origin at ×1.

**Hand tool:** a toolbar toggle (hand icon) switches the pointer from drawing
to navigation. While active, the cursor shows `grab`/`grabbing`, click-drag
pans the view, and drawing is suspended. Keyboard shortcut `H` toggles it,
`Esc` returns to the brush (`B` stays blend-toggle); holding Space temporarily activates it
(pan-while-held, release returns to the brush), and middle-button drag pans
regardless of tool. The active tool is reflected in the toolbar
(`aria-pressed`) and the tutorial copy mentions it.

**Page-zoom override:** the browser's own pinch-zoom must never fire over the
canvas. Trackpad pinches arrive as `wheel` events with `ctrlKey: true` — the
stage's wheel listener is registered with `{ passive: false }` and calls
`preventDefault()`, routing the delta into our view zoom instead. Safari's
proprietary `gesturestart`/`gesturechange`/`gestureend` events are likewise
prevented and mapped to view zoom. `touch-action: none` on the stage (already
the drawing surface) keeps touch pinches ours on mobile. Page zoom keeps
working over the UI panels — only the stage captures these gestures.

**Mobile:** existing two-finger pan/pinch stays, clamps removed. One finger
draws, two fingers navigate.

**Undo/redo/clear:** rebuilt on the stroke log. Undo pops the last stroke and
re-renders the viewport; redo re-appends; clear empties the log. Raster
snapshot history is deleted. History depth becomes effectively unlimited.

**Export:** "current view" and preset exports re-render the viewport at target
resolution through the replay path — 4K exports become genuinely crisp. No SVG
export in v1.

**Out of scope for v1:** persistence, minimap/overview, tile caching,
re-animating strokes on replay, the `white/` variant.

## 4. Error handling & edge cases

- Replay budget exceeded (thousands of strokes in view): chunked rendering
  keeps frames responsive; the soft preview remains until done. If a render is
  invalidated by a new gesture, it aborts and restarts.
- Extreme scale ratios: LOD guards above; brush width floors (`0.08 px`)
  retained per pass.
- Stroke started during a re-render: re-render aborts, live stroke draws on
  the preview raster, then a fresh re-render is scheduled after commit.
- Resize/DPR change: treated as a view change (full crisp re-render).

## 5. Testing

- **New Playwright spec (`tests/infinite-zoom.spec.js`):** draw at ×1, zoom in
  ~×20, draw again, zoom back out; assert both strokes render via pixel
  sampling; no console errors. Repeat core flow on the mobile app. Also cover:
  hand tool toggles pan mode (drag moves the view, no stroke painted), Space
  hold pans temporarily, and a ctrl+wheel event over the stage is
  `defaultPrevented` and changes our zoom readout.
- **Determinism test:** replay the same stroke log twice; assert identical
  pixels.
- **Regression:** existing suites (brush-density, silk-feel, render-qa,
  vector-export, mobile) stay green — live drawing behavior is unchanged.
  `vector-export.spec.js`'s "stays canvas-backed" assertion remains valid.

## Delivery notes

- Desktop first (`app/index.html`), then port to `app/mobile/index.html`,
  which shares the engine patterns but has tighter pixel/perf budgets.
- Project stays dependency-free, static-Pages compatible, single-file per
  route.
