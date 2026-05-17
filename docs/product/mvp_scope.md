# Fractal Brushes MVP Scope

Date: 2026-05-17

## Product Goal

Fractal Brushes is a browser-native canvas app for making luminous mirrored brush art. The MVP should feel publishable as a GitHub Pages package while staying simple enough to run as static files with no backend, build step, account system, or external runtime dependencies.

## Included

- Static landing page at `/`.
- Interactive drawing app at `/app/`.
- Fractal Brushes product naming across titles, visible branding, metadata, exports, and documentation.
- Code-native SVG logo shared by the landing page and app.
- HTML5 canvas drawing with mirrored symmetry.
- Undo, redo, clear, mirror toggle, brush menu, color menu, randomize, export, and zoom slider.
- Independent brush and color panels.
- Brush expansion slider for spread and density control.
- Circular hue picker with separate Primary and Blend handles.
- Blend toggle and preset color chips.
- Luminous brush family: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, Crystal Filament.
- Elemental brush family: Water, Ember, Frost, Plasma.
- Export presets for Current Resolution PNG, 4K 16:9 PNG, and 4K Square PNG.
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
- The landing page introduces Fractal Brushes and links to `/app/`.
- The app supports drawing, brush selection, color selection, zoom slider control, and PNG export.
- Desktop and mobile layouts keep controls usable without incoherent overlap.
- Playwright verification covers landing render, app render, panel interactions, zoom slider, and export menu presence.

## Publication Status

The package is prepared for GitHub Pages, but publication remains blocked until a human approves remote creation and push.
