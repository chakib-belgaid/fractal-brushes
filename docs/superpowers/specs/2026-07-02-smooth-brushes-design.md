# Smooth Brushes + Custom Brush Mode — Design

Date: 2026-07-02

## Problem

Several brushes overwhelm the canvas: with additive (`lighter`) compositing and
per-tendril alphas up to 0.22 (desktop) / 0.5 × energy 1.9 (mobile), a few
overlapping strokes blow out to white. Per-frame white-noise jitter also makes
lines crackly rather than silky.

## Goals

1. Slower build-up — strokes glaze; many layers before saturation.
2. Calmer particle motion — bursts stay closer to the pointer path.
3. Smoother stroke lines — continuous wander instead of white-noise crackle.
4. Softer edges/glow — dimmer white cores, feathered layers.
5. Per-brush treatment that preserves each brush's identity.
6. A **Custom brush mode** with live parameter sliders so the user can tune
   and feel the parameters directly, on desktop and mobile.

## Non-goals

- No rendering-architecture overhaul (no tone-mapped accumulation buffer).
- No new dependencies; static GitHub Pages compatibility preserved.

## Changes

### Engine smoothing (both `app/index.html` and `app/mobile/index.html`)

- **Smooth noise:** replace the per-frame `rand(-jitter, jitter)` velocity kick
  with a per-tendril dual-phase sine wander (two incommensurate frequencies,
  seeded per tendril), scaled by the profile's `jitter`. Angular brushes
  (Thunder, Crystal, Frost) blend ~40% white noise back in to stay electric.
- **Stroke ease-in:** alpha and velocity ramp in over the first ~50 css px of
  each stroke so touches bloom instead of detonating.
- **Speed coupling:** lower the motion-boost floor so slow, deliberate strokes
  spawn dimmer/fewer tendrils; fast flicks stay lively.

### Per-brush retune

Desktop alphas drop roughly 30–50% on the hot brushes (Thunder, Crystal,
Ember, Frost, Plasma, Water, Fairy); white core layer alphas drop; jitter is
reduced where crackle is not the brush's identity. Mobile `energy`
multipliers come down from 1.35–1.9 to ~0.75–1.2 and alphas drop similarly.

### Custom brush mode

- New `custom` entry in `brushProfiles` and `brushOrder` (desktop and mobile).
- Selecting it reveals a tuning section with sliders: intensity (alpha),
  density (count), spread, speed (velocity), flow length (life), width, chaos
  (jitter), swirl (curl), branching, glow softness, and angular snap.
- "Copy current brush" button seeds the custom profile from the last selected
  preset so tuning starts from a known feel.
- Custom parameters persist in `localStorage`.

## Testing

Existing Playwright suites (`brush-density`, `silk-feel`, `render-qa`,
`mobile-brushes`, `mobile-app`) must pass; visual screenshot checks of
representative strokes per brush on `/app/` and `/app/mobile/`; no console
errors.
