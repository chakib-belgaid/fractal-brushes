# UI Implementation Notes

Date: 2026-05-17

## Design Intent

Fractal Brushes should feel like a focused creative instrument: dark canvas, luminous output, compact controls, and enough polish to publish without adding a framework or asset pipeline.

## Layout

- Main toolbar sits at the top-left and carries the logo plus primary commands.
- Zoom control sits at the bottom-right as a slider with current percentage. Double-click resets to 100%.
- Brush panel opens on the right side.
- Color panel opens under the main toolbar by default.
- Brush parameters sit in a fixed bottom-left panel.
- Export panel opens from the main toolbar and contains only export presets.
- Brush and color panels are independent so users can keep either open while drawing.

## Logo

- Use a code-native inline SVG mark.
- The mark should read as a symmetric luminous filament or spark.
- Reuse the same logo on the landing page and in the app toolbar.
- Keep it crisp at small toolbar size and larger landing-page scale.

## Brush Profiles

Represent brushes declaratively where possible. Each profile may tune:

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

## Color Panel

- Hue ring is the primary color input.
- Hue ring shows separate Primary and Blend handles, with the selected target emphasized.
- Target selector switches between Primary and Blend.
- Blend toggle controls whether strokes interpolate between hues.
- Preset chips provide quick color shortcuts.
- Pointer input on the hue ring should ignore accidental clicks outside the ring band.
- Drag handles should not interfere with the hue wheel or sliders.

## Export Panel

Expose three PNG presets:

- Current Resolution: active canvas backing resolution.
- 4K 16:9: 3840x2160.
- 4K Square: 4096x4096.

4K exports should render through an offscreen canvas, copy the current artwork into the target size, preserve the dark background treatment, and fail gracefully if the browser cannot allocate the canvas.

## Accessibility And States

- Buttons should have `aria-label` and `title` text.
- Toggle buttons should keep accurate `aria-pressed` or expanded state.
- Export should ignore or disable duplicate clicks while rendering.
- Dragged panels should clamp within the visible viewport.
- Controls must remain usable at mobile widths.

## Verification Checklist

- Landing page renders the SVG logo and has no console errors.
- App route renders the SVG logo and has no console errors.
- Brush panel opens and selection updates active state.
- Color panel opens, hue changes Primary, target switch changes Blend, and dragging works.
- Zoom slider renders bottom-right and updates zoom.
- Export menu lists Current Resolution, 4K 16:9, and 4K Square.
- Export code creates PNG download URLs without crashing.
- Desktop and mobile screenshots show coherent control placement.
