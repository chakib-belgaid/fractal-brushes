# Fractal Brushes

[![Deploy GitHub Pages](https://github.com/chakib-belgaid/fractal-brushes/actions/workflows/pages.yml/badge.svg)](https://github.com/chakib-belgaid/fractal-brushes/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Fractal Brushes is a static HTML5 canvas drawing toy for symmetry art. It pairs a luminous mirrored canvas with a white-paper ink canvas, pointer drawing, compact controls, undo/redo, and browser-native PNG export.

The package is designed for GitHub Pages and has no build step or runtime dependencies.

## Routes

- `/` - landing page with product overview and launch link.
- `/app/` - interactive Fractal Brushes canvas app.
- `/white/` - Fractal Brushes Ink, a white-paper black-ink canvas app.

## Local Usage

Open `index.html` directly in a browser, or serve the package root with any static server:

```sh
bunx serve .
```

Then visit the local server URL and open `/app/` for the luminous drawing experience or `/white/` for the ink-on-paper experience.

## Controls

The luminous `/app/` route includes the full color and 4K export toolset:

- Draw on the canvas with pointer, mouse, or touch input.
- Use the main toolbar for undo, redo, export, clear, mirror, brush menu, color menu, and random brush selection.
- Use the bottom-right zoom slider to adjust zoom and inspect the current zoom percentage. Double-click the slider to reset to 100%.
- Open the brush and color panels independently. Panels are intended to be draggable and clamped within the viewport.
- Use the bottom-left parameter panel for Brush Size, Expansion, and Symmetry. Brush Size and Expansion scale together: larger brushes also increase the spacing between expansion fans.
- Keyboard shortcuts for core drawing actions should remain available when supported by the app.

The `/white/` route keeps the controls focused on monochrome ink: brush swatches, ink density, water, edge style, brush size, symmetry, mirror, undo/redo, clear, randomize, and single-click PNG export. Its renderer stamps brush footprints along the pointer path, using paper grain, bristle masks, wash bloom, dry gaps, edge darkening, and splatter rather than the luminous route's animated trail system.

## Brush Modes

Fractal Brushes includes luminous and elemental brush families:

- Luminous: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, and Crystal Filament.
- Elemental: Water, Ember, Frost, and Plasma.

Each brush profile tunes tendril spawn count, spread, speed, lifetime, width, curl, jitter, branching, drag, lift, alpha, glow layering, and color bias.

Fractal Brushes Ink includes Ink, Nib, Wash, Scatter, and Dry brush modes. Those profiles tune physical ink behavior: pigment density, water bloom, nib rails, bristle streaks, paper skips, reservoir drain, and scattered flecks.

## Color

The color panel centers on a circular hue picker and a `Single / Blend` switch. Single mode uses one color for the whole stroke. Blend mode shows two handles on the ring and new strokes interpolate from the first color toward the second color over their lifetime.

## Export Formats

The luminous export menu exposes PNG presets:

- Current Resolution PNG - exports the active canvas backing resolution.
- 4K 16:9 PNG - exports 3840x2160.
- 4K Square PNG - exports 4096x4096.

Export filenames use this pattern:

```text
fractal-brushes-<preset>-<timestamp>.png
```

The ink app exports the current white-paper canvas with this pattern:

```text
fractal-brushes-ink-<timestamp>.png
```

## GitHub Pages Setup

This repository includes `.github/workflows/pages.yml` for GitHub Pages deployment from the `main` branch. The workflow uses the official Pages actions to configure Pages, upload the repository root as the Pages artifact, and deploy it with `pages` and `id-token` permissions.

To publish:

1. Create a GitHub repository for this package.
2. Push the package contents to the repository's `main` branch.
3. In repository settings, enable GitHub Pages with GitHub Actions as the source.
4. Run the workflow or push to `main`.

Publication is intentionally blocked until explicit remote creation and push approval. Do not create a remote or push this package without that approval.

## Verification

After visual changes, verify all routes in a browser with Playwright:

- Landing page renders the Fractal Brushes logo with no console errors.
- `/app/` renders the toolbar, brush panel, color panel, zoom controls, and export menu without layout overlap.
- `/white/` renders the ink canvas, brush panel, ink settings, tool dock, and export action without layout overlap.
- Export actions create PNG download URLs for all presets without crashing.

## License And Notices

Fractal Brushes is released under the MIT License. See `LICENSE`.

The package currently has no external runtime dependencies. Canvas visuals and SVG branding are code-native assets. See `docs/legal/asset-log.md`.
