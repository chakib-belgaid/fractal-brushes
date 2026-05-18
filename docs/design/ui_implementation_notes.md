# UI Implementation Notes

Date: 2026-05-17

## Design Intent

Fractal Brushes should feel like a focused creative instrument: dark canvas, luminous output, compact controls, and enough polish to publish without adding a framework or asset pipeline. Fractal Brushes Ink should feel related, but it uses white paper, black wash, and ink-tool controls instead of luminous color.

## Layout

- Main toolbar sits at the top-left and carries the logo plus primary commands.
- Zoom control sits at the bottom-right as a slider with current percentage. Double-click resets to 100%.
- Brush panel opens on the right side.
- Color panel opens under the main toolbar by default.
- Brush parameters sit in a fixed bottom-left panel.
- Export panel opens from the main toolbar and contains only export presets.
- Brush and color panels are independent so users can keep either open while drawing.

## Fractal Brushes Ink Route

- The `/white/` route is a separate static app named Fractal Brushes Ink.
- The surface is tinted white paper with subtle grain, faint guide geometry, and black or gray ink marks.
- The app keeps a top navigation bar, left brush swatch panel, right ink settings panel, and bottom tool dock.
- Mobile opens brush and settings panels as single-purpose drawers above the dock.
- Ink controls include brush selection, ink density, water, edge style, brush size, symmetry, mirror, undo/redo, clear, randomize, and a single Export PNG action.
- Ink rendering should use source-over or multiply-style compositing. Do not use luminous additive blending on the white surface.
- Ink rendering samples the pointer path at fixed spacing and stamps brush footprints. Symmetry and mirror duplicate the completed stamp transform.
- The ink engine tracks stroke angle, speed, estimated pressure, brush reservoir, pigment load, wetness, deterministic paper absorbency, bristle masks, wash bloom, dry gaps, edge darkening, and splatter.
- The ink app must not use the luminous route's animated trail system or post-stroke animation.

## Logo

- Use a code-native inline SVG mark.
- The mark should read as a symmetric luminous filament or spark.
- Reuse the same logo on the landing page and in the app toolbar.
- Keep it crisp at small toolbar size and larger landing-page scale.
- Reuse the same mark in Fractal Brushes Ink, paired with route-specific visible naming.

## Brush Profiles

Represent luminous brushes declaratively where possible. Each luminous profile may tune:

- Spawn count
- Spread
- Speed
- Lifetime
- Width
- Curl
- Jitter
- Branch probability
- Drag
- Lift
- Alpha
- Glow layering
- Color bias

Brush size, expansion, and symmetry stay in the bottom-left parameter panel. Expansion controls stroke spread, density, lifetime, and velocity scaling for the active brush. Brush size also scales expansion distance so larger brushes create wider-spaced expansion fans.

Brush families:

- Luminous: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, Crystal Filament.
- Elemental: Water, Ember, Frost, Plasma.

Randomize should choose from the full brush list.

Fractal Brushes Ink profiles are separate from the luminous brush profiles:

- Ink: round footprint, dense center, feathered edge, and pooling at slow speed.
- Nib: narrow pressure-sensitive line with sharp starts/stops and slight rail splitting.
- Wash: broad translucent footprint with soft bloom and darker drying perimeter.
- Scatter: controlled drops and flecks near the stroke path.
- Dry brush: bristle streaks, skipped fibers, broken edges, and low reservoir.

## Color Panel

- Hue ring is the primary color input.
- Color mode selector switches between Single and Blend.
- Single mode uses one hue handle and applies one color to the whole stroke.
- Blend mode shows two hue handles and strokes interpolate from the first color toward the second.
- Pointer input on the hue ring should ignore accidental clicks outside the ring band.
- Drag handles should not interfere with the hue wheel or sliders.

## Export Panel

Expose three PNG presets:

- Current Resolution: active canvas backing resolution.
- 4K 16:9: 3840x2160.
- 4K Square: 4096x4096.

4K exports should render through an offscreen canvas, copy the current artwork into the target size, preserve the dark background treatment, and fail gracefully if the browser cannot allocate the canvas.

Fractal Brushes Ink exposes one current-canvas export action. Exported files use `fractal-brushes-ink-<timestamp>.png` and preserve the opaque paper background.

## Accessibility And States

- Buttons should have `aria-label` and `title` text.
- Toggle buttons should keep accurate `aria-pressed` or expanded state.
- Export should ignore or disable duplicate clicks while rendering.
- Dragged panels should clamp within the visible viewport.
- Controls must remain usable at mobile widths.

## Verification Checklist

- Landing page renders the SVG logo and has no console errors.
- App route renders the SVG logo and has no console errors.
- Ink route renders the SVG logo, paper canvas, brush swatches, ink settings, dock controls, and has no console errors.
- Brush panel opens and selection updates active state.
- Color panel opens, Single/Blend mode switches correctly, two ring handles are available in Blend mode, and dragging works.
- Zoom slider renders bottom-right and updates zoom.
- Export menu lists Current Resolution, 4K 16:9, and 4K Square.
- Export code creates PNG download URLs without crashing.
- Ink drawing enables undo and exports a `fractal-brushes-ink-*.png` download without crashing.
- Desktop and mobile screenshots show coherent control placement.
