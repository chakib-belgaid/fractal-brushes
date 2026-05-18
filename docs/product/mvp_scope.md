# Fractal Brushes MVP Scope

Date: 2026-05-17

## Product Goal

Fractal Brushes is a browser-native canvas package for making mirrored brush art. The MVP should feel publishable as a GitHub Pages package while staying simple enough to run as static files with no backend, build step, account system, or external runtime dependencies.

## Included

- Static landing page at `/`.
- Interactive drawing app at `/app/`.
- White-paper ink drawing app at `/white/` named Fractal Brushes Ink.
- Fractal Brushes product naming across titles, visible branding, metadata, exports, and documentation.
- Code-native SVG logo shared by the landing page and app.
- HTML5 canvas drawing with mirrored symmetry.
- Undo, redo, clear, mirror toggle, brush menu, color menu, randomize, export, and zoom slider.
- Independent brush and color panels.
- Bottom-left parameter panel for Brush Size, Expansion, and Symmetry.
- Brush expansion slider for spread and density control, scaled with brush size for expansion spacing.
- Circular hue picker with Single and Blend modes.
- Single mode applies one color; Blend mode interpolates from the first hue handle toward the second hue handle.
- Luminous brush family: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, Crystal Filament.
- Elemental brush family: Water, Ember, Frost, Plasma.
- Export presets for Current Resolution PNG, 4K 16:9 PNG, and 4K Square PNG.
- Fractal Brushes Ink controls for brush selection, ink density, water, edge style, brush size, symmetry, mirror, undo/redo, clear, randomize, and current-canvas PNG export.
- Fractal Brushes Ink stroke stamping with paper absorbency, brush reservoir, bristle masks, wash bloom, dry gaps, nib rails, and controlled ink flecks.
- GitHub Pages workflow, `.nojekyll`, README, MIT license, asset log, and project docs.

## Not Included

- User accounts.
- Cloud storage or sync.
- Public galleries.
- Backend rendering.
- Analytics.
- Payment flows.
- Package registry publication.
- Creating a GitHub remote or pushing to GitHub without explicit approval.

## Success Criteria

- The package can be served as plain static files.
- The landing page introduces Fractal Brushes and links to `/app/` and `/white/`.
- The app supports drawing, brush selection, color selection, zoom slider control, and PNG export.
- The ink app supports drawing with stamped ink brushes, brush selection, density/water/edge tuning, symmetry control, and PNG export.
- Desktop and mobile layouts keep controls usable without incoherent overlap.
- Playwright verification covers landing render, `/app/` render, `/white/` render, panel interactions, drawing, mobile controls, and PNG export.

## Publication Status

The package is prepared for GitHub Pages, but publication remains blocked until a human approves remote creation and push.
