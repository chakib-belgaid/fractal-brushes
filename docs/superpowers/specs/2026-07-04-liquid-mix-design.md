# Liquid Mix — paint in water with fluid dynamics

Date: 2026-07-04
Route: `/liquid-mix/`
Status: designed autonomously (user was away during clarifying questions); decisions below are open to revision.

## Goal

A third canvas experience alongside `/app/` (luminous) and `/white/` (ink on paper): the user drops ink into simulated water. Drops bloom and spread through real fluid dynamics, drift on currents the user stirs with their finger, and blend with neighboring colors the way pigments mix in water.

## Interaction model (decision: drops + stirring)

- **Pointer down** places a drop of the active pigment: a dye splat plus a gentle radial velocity impulse so it blooms outward.
- **Holding still** keeps feeding the drop slowly, so it grows.
- **Dragging** stirs the water: it injects velocity along the pointer path (no new dye), swirling and smearing whatever ink is already there. This makes tap-then-swirl the core gesture.
- No tool toggle in v1 — the down/drag distinction covers both verbs naturally.

Alternatives considered: drops-only (too passive), drag-paints-ink (duplicates the existing brush apps and loses the "drop in water" identity).

## Simulation (decision: GPU stable fluids, single file, no dependencies)

Classic Stam stable-fluids solver on the GPU via WebGL, written from scratch inline (repo is dependency-free, static Pages):

- Fields: velocity (RG half-float), pressure, divergence, curl, and a dye field.
- Steps per frame: advect velocity → vorticity confinement → divergence → Jacobi pressure solve (~24 iterations) → gradient subtract → advect dye.
- Sim resolution decoupled from display: velocity ~192px on the short side, dye ~1024 (clamped by canvas), so it runs smoothly on modest GPUs.
- WebGL2 with `EXT_color_buffer_float` preferred; WebGL1 + `OES_texture_half_float` fallback; if neither is available the page shows a friendly "needs WebGL" notice instead of a broken canvas.
- Water is still until disturbed; dye dissipation is near-1 so inks persist, velocity dissipation slightly lower so currents calm down.

Alternatives considered: CPU solver (too slow/blurry at useful resolutions), reaction-diffusion fake (pretty but doesn't respond to stirring like water).

## Color mixing (decision: subtractive pigment on light water)

The dye field stores **absorbance** per RGB channel, and the display shader renders `paper × exp(−absorbance)`. This makes overlapping inks mix subtractively like real pigments in water — indigo into ochre drifts toward green, everything saturates toward deep ink rather than washing out to white. It also visually distinguishes the page from typical black-background fluid-sim toys and matches the marbling / ink-in-water reference.

Palette: the eight pigments from `/white/` (Sumi Black, Indigo, Payne's Grey, Sepia, Vermilion, Yellow Ochre, Viridian, Mulberry) plus a custom color input, converted to absorbance at drop time.

## UI

Follows the `/white/` studio look (same top bar pattern, fonts, button styles), kept minimal:

- Top bar: title, Clear, Export PNG.
- Pigment row (8 swatches + custom picker), keyboard `1`–`8`.
- Sliders: Drop size, Swirl (stir strength), Flow (velocity dissipation → how long currents live).
- No undo in v1: the simulation is continuous, so meaningful undo would require full-field snapshots per gesture; deferred unless requested.
- Export renders a fresh frame and captures the canvas synchronously to PNG (no `preserveDrawingBuffer`).
- Works at mobile widths; touch gestures map to the same drop/stir model.

## Files

- `liquid-mix/index.html` — the whole page, self-contained.
- `index.html`, `README.md` — add the route.
- `tests/liquid-mix.spec.js` — Playwright coverage.

## Testing

Playwright, per repo conventions:

1. Page loads with no console errors; canvas is present and sized.
2. Placing a drop changes canvas pixels near the drop point (screenshot sampling).
3. Two adjacent drops of different pigments produce a mixed hue between them after the sim runs.
4. Clear returns the canvas to blank water.
5. Export triggers a PNG download URL without crashing.
