# Fractal Brushes

[![Deploy GitHub Pages](https://github.com/chakib-belgaid/fractal-brushes/actions/workflows/pages.yml/badge.svg)](https://github.com/chakib-belgaid/fractal-brushes/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Fractal Brushes is a static canvas drawing toy for symmetry art. It pairs a luminous mirrored canvas with a white-paper ink canvas, pointer drawing, compact controls, undo/redo, and browser-native PNG export presets.

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
- Use the bottom-left parameter panel for Brush Length, Scale Factor, Expansion, and Symmetry. The luminous route opens on Silk Ribbon at actual length `0.5` and actual scale `3`. The UI shows normalized control values by multiplying both numbers by `10`, so the defaults display as length `5` and scale `30`. Brush Length ranges from `0.1` to `6.4`; Scale Factor ranges from `0.1` to `15`. Scale Factor multiplies the effective brush length before the renderer derives tendril travel, spacing, and width. Brush Length primarily extends tendril travel; stroke width follows at a smaller fixed ratio. A live symmetry guide shows the mirrored/rotated drawing points while hovering or painting.
- Keyboard shortcuts for core drawing actions should remain available when supported by the app.

The `/white/` route keeps the controls focused on monochrome ink: brush swatches, ink density, water, edge style, brush size, symmetry, mirror, undo/redo, clear, randomize, and single-click PNG export. Its renderer stamps brush footprints along the pointer path, using paper grain, bristle masks, wash bloom, dry gaps, edge darkening, and splatter rather than the luminous route's animated trail system.

## Brush Modes

Fractal Brushes includes luminous and elemental brush families:

- Luminous: Fairy, Flame, Thunder, Silk Ribbon, Comet Trail, Nebula Smoke, and Crystal Filament.
- Elemental: Water, Ember, Frost, and Plasma.

Each brush profile tunes tendril spawn count, spread, speed, lifetime, width, curl, jitter, branching, drag, lift, alpha, glow layering, and color bias.

Fractal Brushes Ink includes Ink, Nib, Wash, Scatter, and Dry brush modes. Those profiles tune physical ink behavior: pigment density, water bloom, nib rails, bristle streaks, paper skips, reservoir drain, and scattered flecks.

## Brush Algorithms

Notation:

- `U(a, b)` is a uniform random sample in `[a, b)`.
- `H(x, y, seed) = fract(sin(127.1x + 311.7y + 74.7seed) * 43758.5453123)`.
- `clamp(x, a, b) = max(a, min(b, x))`.
- `L` is actual brush length, `F` is actual scale factor, `E` is expansion, `DPR` is device pixel ratio, `C = (cx, cy)` is the canvas center, and `Nsym` is the symmetry count. The displayed length and scale values are `round(10L)` and `round(10F)`.

### Luminous Tendril Model (`/app/`)

The luminous brushes are stochastic particle systems. A pointer segment `P0 = (x0, y0)` to `P1 = (x1, y1)` is converted into emission samples:

```text
dx = x1 - x0
dy = y1 - y0
D = sqrt(dx^2 + dy^2)

effectiveLength = max(0.1, L * F)
defaultEffectiveLength = 0.5 * 3 = 1.5
lengthScale = clamp((effectiveLength / defaultEffectiveLength)^0.9, 0.34, 3.6)
distanceScale = clamp(1 + (lengthScale - 1) * 0.48, 0.62, 2.15)
expansionDistanceScale = 0.9 + E * 0.46
spacing = clamp(11.8 * distanceScale * expansionDistanceScale * (profile.spacing or 1), 10, 96)
steps = max(1, floor(D / spacing))

sample_i = P0 + (i / steps) * (P1 - P0), for i in 1..steps
```

At each `sample_i`, the active brush emits `K` tendrils:

```text
baseAngle = atan2(dy, dx)
pointerSpeed = sqrt(dx^2 + dy^2)

normalizedFactor = F / 3
widthFromLength = 1 + (lengthScale - 1) * 0.08
factorWidthScale = 1 + (normalizedFactor - 1) * 0.08
sizeScale = defaultWidthScale * widthFromLength * factorWidthScale
expansionScale = clamp(E, 0.35, 1.6)

spreadScale = 0.64 + expansionScale * 0.38
densityScale = clamp(0.66 - max(0, lengthScale - 1) * 0.18 - max(0, expansionScale - 1) * 0.14, 0.44, 0.94)
lifeScale = (0.72 + expansionScale * 0.23) * lengthScale^1.32 * sqrt(normalizedFactor)
velocityScale = (0.82 + expansionScale * 0.22) * lengthScale^0.68 * normalizedFactor
widthScale = (0.92 + expansionScale * 0.08) * (1 + (normalizedFactor - 1) * 0.08)

K = max(1, floor(U(countMin, countMax + 1) * densityScale))
```

Each tendril state is initialized as:

```text
theta = baseAngle + U(-spread, spread) * spreadScale
motionBoost = clamp(0.72 + sqrt(pointerSpeed) * 0.105, 0.72, 1.55)
speed = U(velocityMin, velocityMax) * velocityScale * motionBoost
T = U(lifeMin, lifeMax) * lifeScale

x = sample_x * DPR
y = sample_y * DPR
vx = cos(theta) * speed * DPR
vy = sin(theta) * speed * DPR - U(liftMin, liftMax) * DPR
width = U(widthMin, widthMax) * sizeScale * widthScale
alpha = profile.alpha * clamp(0.78 + sqrt(sizeScale) * 0.2, 0.9, 1.28)
hue = baseHue + U(hueShiftMin, hueShiftMax)
```

Each animation frame integrates every tendril with curl, jitter, lift, angular quantization, and drag:

```text
speed = max(0.001, sqrt(vx^2 + vy^2))
normal = (-vy / speed, vx / speed)
curlForce = sin((Tmax - T) * 0.16 + seed) * profile.curl

vx = vx + normal.x * curlForce * DPR + U(-jitter, jitter) * DPR
vy = vy + normal.y * curlForce * DPR + U(-jitter, jitter) * DPR
vy = vy - lift * DPR * (1 + width)

if angular > 0:
  q = PI * angular
  angle = round(atan2(vy, vx) / q) * q
  vx = cos(angle) * speed
  vy = sin(angle) * speed

x_next = x + vx
y_next = y + vy
vx = vx * drag
vy = vy * drag
T = T - 1
```

The visible stroke opacity follows a sinusoidal lifetime envelope:

```text
age = 1 - T / Tmax
envelope = sin(PI * clamp(age, 0, 1))
drawAlpha = alpha * envelope
```

If blend mode is active, hue interpolation uses the shortest angular path on the hue circle:

```text
delta = ((((hue2 - hue1) mod 360) + 540) mod 360) - 180
hue(age) = (hue1 + delta * age + 360) mod 360
```

For symmetry, every rendered segment is transformed by rotations around `C`; mirror mode adds a reflected pass:

```text
mirror_x = x                         when mirrorIndex = 0
mirror_x = 2 * cx - x                when mirrorIndex = 1

rotation_i = 2 * PI * i / Nsym
R_i(x, y) = C + [[cos(rotation_i), -sin(rotation_i)],
                 [sin(rotation_i),  cos(rotation_i)]] * ((x, y) - C)
```

Each brush stores a layer list `[scale, hueOffset, lightness, alphaScale, special]`. For each transformed segment and each layer:

```text
lineWidth = max(0.16, width * DPR * scale)
lineAlpha = drawAlpha * alphaScale
lineHue = hue(age) + hueOffset
composite = profile.composite or "lighter"
```

Branching is a Bernoulli process evaluated after drawing:

```text
maxTendrils = round((profile.maxTendrils or 1600) * (0.72 + E * 0.34))

if T > 12 and U(0, 1) < profile.branch and tendrilCount < maxTendrils:
  splitAngle = atan2(vy, vx) +/- U(0.45, profile.angular ? 0.92 : 1.18)
  splitLife = T * U(0.28, 0.58)
  splitWidth = width * U(0.42, 0.76)
  splitAlpha = alpha * 0.74
  splitBranch = branch * 0.18
```

Luminous profile constants:

| Brush | `count` | `spread` | `velocity` | `life` | `width` | Dynamics |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Fairy | `[3, 5]` | `1.25` | `[0.22, 1.45]` | `[58, 128]` | `[0.30, 0.72]` | `jitter=.24`, `curl=.16`, `branch=.004`, `drag=.972`, `lift=[0,.04]`, `alpha=.15` |
| Flame | `[2, 3]` | `.72` | `[0.38, 1.58]` | `[26, 62]` | `[0.46, 0.92]` | `jitter=.13`, `curl=.20`, `branch=.002`, `drag=.956`, `lift=[.10,.65]`, `alpha=.074`, `spacing=1.22`, `max=760` |
| Thunder | `[2, 4]` | `.46` | `[0.80, 2.45]` | `[30, 68]` | `[0.38, 0.90]` | `jitter=.34`, `curl=.05`, `branch=.032`, `drag=.956`, `lift=[0,0]`, `alpha=.20`, `angular=.22` |
| Silk Ribbon | `[2, 4]` | `.64` | `[0.28, 1.32]` | `[72, 128]` | `[0.58, 1.10]` | `jitter=.08`, `curl=.19`, `branch=.001`, `drag=.981`, `lift=[-.03,.03]`, `alpha=.068`, `spacing=1.58`, `max=820`, `composite=screen` |
| Comet Trail | `[3, 4]` | `.28` | `[1.10, 2.85]` | `[36, 82]` | `[0.04, 0.90]` | `jitter=.18`, `curl=.07`, `branch=.007`, `drag=.952`, `lift=[0,.03]`, `alpha=.078`, `spacing=1.62`, `max=740`, `composite=screen` |
| Nebula Smoke | `[3, 6]` | `1.08` | `[0.12, 0.85]` | `[118, 210]` | `[0.72, 1.62]` | `jitter=.15`, `curl=.22`, `branch=.002`, `drag=.988`, `lift=[-.05,.08]`, `alpha=.08` |
| Crystal Filament | `[2, 4]` | `.38` | `[0.72, 2.10]` | `[46, 94]` | `[0.24, 0.58]` | `jitter=.10`, `curl=.02`, `branch=.024`, `drag=.968`, `lift=[0,0]`, `alpha=.20`, `angular=.52` |
| Water | `[4, 6]` | `.66` | `[0.34, 1.48]` | `[72, 146]` | `[0.50, 1.20]` | `jitter=.10`, `curl=.24`, `branch=.002`, `drag=.978`, `lift=[-.04,.04]`, `alpha=.14` |
| Ember | `[3, 6]` | `.92` | `[0.48, 2.05]` | `[24, 58]` | `[0.28, 0.78]` | `jitter=.26`, `curl=.12`, `branch=.018`, `drag=.940`, `lift=[.08,.42]`, `alpha=.22` |
| Frost | `[2, 5]` | `.54` | `[0.58, 1.86]` | `[52, 98]` | `[0.28, 0.68]` | `jitter=.12`, `curl=.035`, `branch=.030`, `drag=.966`, `lift=[0,0]`, `alpha=.18`, `angular=.42` |
| Plasma | `[5, 8]` | `.86` | `[0.62, 2.35]` | `[44, 102]` | `[0.42, 1.08]` | `jitter=.32`, `curl=.28`, `branch=.016`, `drag=.958`, `lift=[-.02,.02]`, `alpha=.21` |

### Ink Deposition Model (`/white/`)

The ink route uses sampled deposition rather than animated particles. Paper absorbency is a deterministic scalar field on a `180 x 180` grid:

```text
shortFiber = H(0.9gx, 2.7gy, seed)
longFiber = H(floor(gx / 5), 0.42gy, seed + 19)
cloud = H(0.2gx, 0.2gy, seed + 41)

A(gx, gy) = clamp(
  0.52
  + (shortFiber - 0.5) * 0.34
  + (longFiber - 0.5) * 0.22
  + (cloud - 0.5) * 0.16,
  0,
  1
)
```

For each pointer segment:

```text
dx = x1 - x0
dy = y1 - y0
D = sqrt(dx^2 + dy^2)
dt = max(8, t1 - t0)
speed = clamp(D / dt / DPR, 0.02, 3.2)
rawAngle = atan2(dy, dx)
angle = lerpAngle(previousAngle, rawAngle, stampIndex < 2 ? 1 : 0.38)
estimatedPressure = clamp(inputPressure + (0.28 - speed * 0.12), 0.18, 1)
spacing = clamp(S * DPR * profile.spacing * (profile.kind == "wash" ? 0.92 : 1), 2.2 * DPR, 18 * DPR)
```

The base mark alpha couples user density, estimated pressure, reservoir load, and paper absorbency:

```text
baseSize = S * DPR * profile.sizeScale
alpha = profile.opacity * density * clamp(pressure, 0.18, 1) * reservoir * (0.84 + A(x, y) * 0.28)
```

The ink reservoir is updated after each deposited stamp or segment:

```text
waterReturn = 1.12 - water * 0.42
minLoad = 0.26 for Dry brush
minLoad = 0.56 for Wash
minLoad = 0.38 otherwise

reservoir = clamp(
  reservoir - profile.drain * (0.7 + pressure * 0.55) * waterReturn,
  minLoad,
  1
)
```

Ink profile constants:

| Brush | Kind | `spacing` | `sizeScale` | `opacity` | `drain` | `bristles` |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Ink | `ink` | `.16` | `.86` | `.82` | `.009` | `22` |
| Nib | `nib` | `.12` | `.36` | `.92` | `.006` | `4` |
| Wash | `wash` | `.20` | `1.22` | `.26` | `.004` | `18` |
| Scatter | `scatter` | `.30` | `.72` | `.68` | `.012` | `10` |
| Dry brush | `dry` | `.11` | `.98` | `.78` | `.021` | `30` |

For a brush mask with `B = baseSize` and `n = profile.bristles`, bristle `i` is:

```text
lane = i / (n - 1)
offset_i = (lane - 0.5) * B * 0.92 + (H(i, 1, seed) - 0.5) * B * 0.08
length_i = B * (0.36 + H(i, 2, seed) * 0.84)
width_i = max(0.45 * DPR, B * (0.009 + H(i, 3, seed) * 0.026))
opacity_i = 0.45 + H(i, 4, seed) * 0.55
lift_i = H(i, 5, seed)
```

Brush-specific deposition equations:

- Ink:

```text
w = B * (0.34 + pressure * 0.28) * (1.05 - clamp(speed, 0, 1.7) * 0.1)
edgeWave = edge == "wave" ? sin(stampIndex * 0.65 + paperSeed) * w * 0.06 : 0

if water > 0.18:
  drawLine(width = w * (1.22 + water * 0.52), alpha = alpha * (0.07 + water * 0.12), blur = w * (0.025 + water * 0.035))

drawLine(width = w * (0.82 + edgeWave / max(1, w)), alpha = alpha * 0.58)
drawLine(width = w * 0.28, alpha = alpha * (0.56 + (1 - speed) * 0.12))
```

- Nib:

```text
w = clamp(B * (0.08 + pressure * 0.12), DPR, B * 0.24)
length = B * (0.74 + pressure * 0.72)
railOffset = w * (0.32 + pressure * 0.18)

draw two rails at offsets +/- railOffset
if pressure > 0.62: draw center line with alpha * 0.24
```

- Wash:

```text
w = B * (0.74 + water * 0.56 + pressure * 0.16)
blur = w * (0.035 + water * 0.04)

drawLine(width = w * 1.24, alpha = alpha * (0.16 + water * 0.12), blur = blur)
drawLine(width = w * 0.78, alpha = alpha * 0.20, blur = blur * 0.55)
drawLine(width = w * 0.20, alpha = alpha * 0.14)

edgeOffset = +/- w * (0.38 + water * 0.08)
edgeAlpha = alpha * (0.12 + water * 0.16)
```

- Scatter:

```text
factor = 1
count = round((2 + density * 9) * factor * (0.72 + pressure))
spreadAngle_i = angle + (H(i, 6, seed) - 0.5) * PI * 1.2
throw_i = (4 + H(i, 7, seed) * (S * (0.42 + water * 0.54))) * DPR
along_i = (H(i, 8, seed) - 0.5) * S * 0.34 * DPR
radius_i = (0.55 + H(i, 9, seed) * (2.4 + S * 0.025)) * DPR
alpha_i = profile.opacity * density * reservoir * (0.18 + H(i, 10, seed) * 0.38)
```

- Dry brush:

```text
skip_i = 0.06 + (1 - reservoir) * 0.28 + (1 - A(x_i, y_i)) * 0.12 + lift_i * 0.08
draw bristle i only if H(i, stampIndex, seed) >= skip_i

segment_i = length_i * (0.34 + H(i, 44, seed) * 0.70)
gap_i = (H(i, 45, seed) - 0.5) * B * 0.18
lineWidth_i = max(0.55 * DPR, width_i * (0.9 + pressure * 0.8))
lineAlpha_i = alpha * opacity_i * (0.78 + pressure * 0.32)

dryGap_j length = B * (0.12 + H(j, 23, seed) * 0.42), for j in 0..23
dryGap_j width = max(0.8, B * (0.008 + H(j, 24, seed) * 0.02))
```

## Color

The color panel centers on a circular hue picker and a `Single / Blend` switch. Single mode uses one color for the whole stroke. Blend mode shows two handles on the ring and new strokes interpolate from the first color toward the second color over their lifetime.

## Export Formats

The luminous export menu exposes PNG presets:

- Current Resolution PNG - exports the active canvas backing resolution.
- 4K 16:9 PNG - exports 3840x2160.
- 4K Square PNG - exports 4096x4096.

Luminous export filenames use this pattern:

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
