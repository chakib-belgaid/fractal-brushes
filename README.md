# Fractal Brushes

Fractal Brushes is a static HTML5 canvas drawing toy for luminous symmetry art. It pairs mirrored pointer drawing with particle-like tendril brushes, a dual-handle circular color picker, zoom slider, undo/redo, and PNG export presets up to 4K.

The package is designed for GitHub Pages and has no build step or runtime dependencies.

## Routes

- `/` - landing page with product overview and launch link.
- `/app/` - interactive Fractal Brushes canvas app.

## Local Usage

Open `index.html` directly in a browser, or serve the package root with any static server:

```sh
bunx serve .
```

Then visit the local server URL and open `/app/` for the drawing experience.

## Controls

- Draw on the canvas with pointer, mouse, or touch input.
- Use the main toolbar for undo, redo, export, clear, mirror, brush menu, color menu, and random brush selection.
- Use the bottom-right zoom slider to adjust zoom and inspect the current zoom percentage. Double-click the slider to reset to 100%.
- Open the brush and color panels independently. Panels are intended to be draggable and clamped within the viewport.
- Use Brush Expansion to control how far and how densely the active brush spreads.
- Keyboard shortcuts for core drawing actions should remain available when supported by the app.

## Brush Modes

Fractal Brushes includes luminous and elemental brush families:

- Luminous: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, and Crystal Filament.
- Elemental: Water, Ember, Frost, and Plasma.

Each brush profile tunes tendril spawn count, spread, speed, lifetime, width, curl, jitter, branching, drag, lift, alpha, glow layering, and color bias.

## Color

The color panel centers on a circular hue picker with two handles: one for Primary and one for Blend. Users can target either color, enable blend mode, and use preset chips as fast shortcuts. When blend is enabled, new strokes interpolate between the selected primary and blend hues.

## Export Formats

The export menu exposes PNG presets:

- Current Resolution PNG - exports the active canvas backing resolution.
- 4K 16:9 PNG - exports 3840x2160.
- 4K Square PNG - exports 4096x4096.

Export filenames use this pattern:

```text
fractal-brushes-<preset>-<timestamp>.png
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

After visual changes, verify both routes in a browser with Playwright:

- Landing page renders the Fractal Brushes logo with no console errors.
- `/app/` renders the toolbar, brush panel, color panel, zoom controls, and export menu without layout overlap.
- Export actions create PNG download URLs for all presets without crashing.

## License And Notices

Fractal Brushes is released under the MIT License. See `LICENSE`.

The package currently has no external runtime dependencies. Canvas visuals and SVG branding are code-native assets. See `docs/legal/asset-log.md`.
