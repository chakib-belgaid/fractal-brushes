# Fractal Brushes Ink Mockup Prompt

Date: 2026-05-18

## Product Name

Fractal Brushes Ink

## Target User

Creative browser users who want a fast static canvas for mirrored ink, wash, and dry-brush marks without accounts, uploads, or a build step.

## Landing Page Direction

Update the existing Fractal Brushes landing page so the first viewport offers two clear launch paths:

- Launch luminous canvas: `/app/`
- Launch ink canvas: `/white/`

Keep the landing page visually aligned with the existing dark luminous brand, but make the second launch path explicit enough that users understand it opens the white-paper ink tool.

## App Screen Direction

Create a static web app screen named Fractal Brushes Ink:

- White or off-white paper canvas fills the viewport.
- Top app bar contains the Fractal Brushes Ink brand, mode tabs, undo/redo, clear, and Export PNG.
- Left floating brush panel shows black ink swatches for Ink, Nib, Wash, Scatter, and Dry brush.
- Right floating settings panel contains Ink density, Water, Edge, Brush size, and Symmetry.
- Bottom dock exposes Brushes, Settings, Undo, Redo, Mirror, and Random controls.
- Mobile uses drawers above the bottom dock for Brushes and Settings.

## Visual Style

Restrained product UI with paper texture, fine black linework, soft shadows, 8px radii, readable system UI type, and ink-wash marks. The canvas should feel like real paper, but all UI controls stay crisp and code-native.

## Layout Constraints

- Preserve static GitHub Pages compatibility.
- Keep all UI dependency-free: plain HTML, CSS, and JavaScript.
- Do not move or change the existing `/app/` route.
- New route is `/white/`.
- Use code-native SVG for icons and marks.
- Use canvas drawing for brush output and paper guides.
- Use a stamped ink-brush simulation for `/white/`: paper absorbency, pigment load, water bloom, bristle skips, dry edges, nib rails, and splatter.
- Do not reuse luminous animated-trail algorithms for ink marks.
- Use Playwright to verify desktop and mobile rendering.

## Content Placeholders

- Brand: `Fractal Brushes Ink`
- Primary action: `Export PNG`
- Brush names: `Ink`, `Nib`, `Wash`, `Scatter`, `Dry brush`
- Settings: `Ink density`, `Water`, `Edge`, `Brush size`, `Symmetry`

## Forbidden References

Do not copy protected app UI, logos, screenshots, branded brush packs, copyrighted paintings, living artist styles, or third-party visual assets. The reference image is directional only: top bar, white paper, ink controls, and black ink mood.

## Asset Notes

No generated raster mockup is bundled for this implementation pass. The implementation uses code-native UI, inline SVG, CSS texture, and runtime canvas output only.
