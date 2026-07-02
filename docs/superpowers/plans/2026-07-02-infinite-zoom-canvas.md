# Infinite Zoom Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the desktop (`app/index.html`) and mobile (`app/mobile/index.html`) drawing surfaces into an infinite canvas: unbounded zoom/pan, brush size relative to zoom, previously drawn strokes re-render crisp at any scale by deterministic replay of recorded stroke input.

**Architecture:** Every stroke records its input segments (in stroke-local CSS px), brush settings, symmetry center (world coords), draw-time view scale, and a PRNG seed into an in-memory log. The canvas is viewport-sized; a view `{x, y, scale}` maps world↔screen. Gestures show a cheap CSS/raster preview; on settle the viewport re-renders by replaying visible strokes through a canvas transform. Determinism comes from a per-stroke mulberry32 PRNG (with per-tendril sub-streams) and step-indexed spawning.

**Tech Stack:** Vanilla JS in single-file HTML pages (no dependencies), Canvas 2D, Playwright for tests.

**Spec:** `docs/superpowers/specs/2026-07-02-infinite-zoom-canvas-design.md`

## Approved deviations from the spec

1. **Hand-tool shortcut:** spec said `H` toggle + `B`/`Esc` back, but `B` already toggles blend (`app/index.html` keydown handler). Use `H` to toggle hand↔brush and `Esc` to return to brush. No `B`.
2. **Point storage:** stroke points are stored in stroke-local CSS px plus `symCenter` (world) + `drawScale`, which is world-recoverable and exactly replayable. Equivalent to the spec's "world coords", chosen for determinism.
3. **Stroke bounds:** a bounding circle (`maxR` around the symmetry center) instead of a bbox — symmetry copies are rotations around the center, so a circle is exact and cheap.
4. **Stroke started during re-render:** the pending render is flushed synchronously before the stroke begins (instead of drawing on the preview raster). Simpler, no visual mismatch.
5. **Tutorial demo stroke** (`paintDemoStroke`) is not recorded; it disappears on the first view change. Acceptable — it is a throwaway demo.
6. **Live vs replay:** replay-vs-replay is pixel-deterministic (tested). Live-vs-replay may differ microscopically (tendril-cap eviction pressure differs when older strokes' tendrils are still alive) — invisible in practice because a re-render replaces the whole viewport.

## Global Constraints (from spec + AGENTS.md)

- Dependency-free, static GitHub Pages compatible, single file per route.
- Do not move the app route away from `/app/`.
- Verify with Playwright; check `/` and `/app/` after UI changes; no console errors.
- Existing suites must stay green: `tests/vector-export.spec.js` (asserts drawing stays canvas-backed), `tests/brush-density.spec.js`, `tests/silk-feel.spec.js`, `tests/render-qa.spec.js`, `tests/mobile-brushes.spec.js`, `tests/mobile-app.spec.js`, `tests/tutorial.spec.js`, `tests/panel-drag.spec.js`.
- Run a spec with: `npx playwright test tests/<name>.spec.js` from the repo root (tests resolve playwright from `/opt/homebrew/lib/node_modules` if not local).
- Session-only: no persistence of the stroke log.
- Commit after every task (message per step).

## Codebase orientation (read this first)

`app/index.html` is one ~4800-line file. Inside its main IIFE:

- **Base engine** (~2200–3330): `state` object, `spawnFan`, `spawnAlong`, `branchFrom`, `step()` (rAF loop), `drawBrushSegment`, `startPainting`/`continuePainting`/`stopPainting`, `undo`/`redo`/`clearArt`, `makeSnapshot`/`restoreSnapshot`/`pushHistory` (raster undo), `exportPngPreset`, `updateUi`, `resize`.
- **Patch blocks** overriding earlier bindings by reassignment (`spawnFan = function patched...`). The relevant one is the **"expanded canvas" block** (starts near the comment `larger virtual canvas than the visible viewport` ~line 3845, wrapped in a bare `{ ... }`). It holds `CANVAS_CONFIG`, `mobileLike()`, `computeBudgetedDpr()`, `clampPan()`, the patched `applyZoom`/`setZoom`/`resize`/`eventPosition`/`startPainting`/`continuePainting`/`stopPainting`, the two-finger gesture handlers (`beginGestureIfNeeded`/`updateGesture`/`endGesturePointer`), and `emitSmoothedMove`. **All infinite-canvas work happens by editing inside this block** — its helpers are block-scoped and unreachable from a new sibling block.
- **Custom brush block** (~4520–4676) follows it.
- **Final wiring** (~4679 to end) attaches the *current* function bindings as listeners (`stage.addEventListener("pointerdown", startPainting)`), wires keyboard, calls `resize(); updateUi(); step();`. Reassignments made inside the expanded block before this wiring take effect; the keydown handler and export buttons resolve `undo`/`redo`/`setZoom`/`stepZoom`/`exportPngPreset` dynamically at call time, so reassigning those bindings works even after wiring.
- Randomness: `const rand = (min, max) => min + Math.random() * (max - min);` — `rand` is `const` (not patchable) but it reads `Math.random` at call time, so **temporarily swapping `Math.random` is the determinism seam**. Precedent: tests already stub `Math.random` globally.
- All painting is additive (`lighter` composite) strokes/arcs/radial-gradients on `ctx` — **no shadows**, so everything scales exactly under a `ctx.setTransform`. `ctx` is a `const` bound to the main canvas — offscreen rendering is impossible without huge refactors; exports therefore temporarily resize the main canvas.
- Coordinates: pointer → `eventPosition()` → CSS px in canvas space; tendrils store device px (`x * state.dpr`). `state.cx/cy` = canvas center in device px = the symmetry center used by `drawSymmetricLayerPack`/`rotateAroundCenter`.

`app/mobile/index.html` (~1530 lines) is a separate, simpler engine: viewport-sized canvas already, single unpatched `spawnFan`/`spawnAlong`/`branchFrom`, an on-demand loop (`advanceFrame`/`frame`/`wakeLoop`), raster-snapshot undo, one `exportPng`, **no pan/zoom at all**.

Line numbers below are from commit `bb16962` and drift as tasks land — **always locate edits by the quoted anchor text, not the line number.**

---

### Task 1: Desktop — view model, viewport canvas, unbounded zoom/pan navigation

**Files:**
- Modify: `app/index.html` (markup `.zoom-cluster`, CSS, `state` literal, `updateUi`, expanded-canvas block)
- Test: `tests/infinite-zoom.spec.js` (create)

**Interfaces:**
- Consumes: existing `state`, `applyZoom`, gesture handlers, `makeSnapshot`, `clearSurface`.
- Produces (all inside the expanded block; later tasks extend them):
  - `state.view = { x, y, scale }` (world coords of screen center; scale = CSS px per world unit) — initialized in the main `state` literal.
  - `screenToWorld(sx, sy) -> [wx, wy]`, `worldToScreen(wx, wy) -> [sx, sy]` (CSS px; valid when preview is identity).
  - `viewCssWidth()` / `viewCssHeight()` -> CSS px extents of the render target (`state.width / state.dpr`).
  - `previewZoomAt(clientX, clientY, factor)` — multiplies the CSS preview zoom about a screen point, debounce-commits after 150 ms.
  - `commitViewPreview()` — folds `state.zoom/panX/panY` into `state.view`, calls `rebuildView(zoom, panX, panY)`, resets preview, `applyZoom()`.
  - `rebuildView(zoom, panX, panY)` — v1: soft raster carry (snapshot → clear → transformed drawImage). Task 4 replaces its body with the crisp pipeline.
  - `resetView()` — view to `{0,0,1}`, rebuild.
  - `window.__fractal = { state, screenToWorld, worldToScreen, previewZoomAt, commitViewPreview, resetView }` test hook.
  - Reassigned `stepZoom(delta)` (steps ×1.25 / ÷1.25 about screen center) and `setZoom(z)` (`z === 1` → `resetView()`, else multiplies to absolute total scale) so the existing keyboard wiring (`+`/`-`/`0`) keeps working.
- UI: `#zoom` range input replaced by `#zoomOut` / `#zoomIn` buttons + `#zoomValue` readout (dblclick = reset). `ui.zoom` entry removed; `ui.zoomIn`, `ui.zoomOut` added.

- [ ] **Step 1: Write the failing test file**

Create `tests/infinite-zoom.spec.js` (same require preamble as `tests/vector-export.spec.js`):

```js
const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();

async function setupPage(page, viewport = { width: 960, height: 720 }) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");
  });
  await page.setViewportSize(viewport);
  await page.goto(appUrl);
  return errors;
}

test("canvas is viewport-sized and view model exists", async ({ page }) => {
  const errors = await setupPage(page);
  const info = await page.evaluate(() => ({
    cssW: parseFloat(document.getElementById("art").style.width),
    view: window.__fractal?.state.view || null
  }));
  expect(info.cssW).toBe(960);
  expect(info.view).toEqual({ x: 0, y: 0, scale: 1 });
  expect(errors).toEqual([]);
});

test("ctrl+wheel over stage is prevented and zooms our view", async ({ page }) => {
  await setupPage(page);
  const prevented = await page.evaluate(() => {
    const stage = document.getElementById("stage");
    const event = new WheelEvent("wheel", {
      deltaY: -240, ctrlKey: true, clientX: 480, clientY: 360,
      cancelable: true, bubbles: true
    });
    stage.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.waitForTimeout(400); // debounce commit
  const scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBeGreaterThan(1);
  await expect(page.locator("#zoomValue")).not.toHaveText("×1.00");
});

test("zoom is unbounded far beyond the old 240% clamp and resets", async ({ page }) => {
  await setupPage(page);
  await page.evaluate(() => {
    window.__fractal.previewZoomAt(480, 360, 20);
    window.__fractal.commitViewPreview();
  });
  let scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBeCloseTo(20, 5);
  await page.evaluate(() => {
    window.__fractal.previewZoomAt(480, 360, 1 / 400);
    window.__fractal.commitViewPreview();
  });
  scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBeCloseTo(0.05, 5);
  await page.locator("#zoomValue").dblclick();
  scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBe(1);
});

test("zoom buttons step the view scale", async ({ page }) => {
  await setupPage(page);
  await page.locator("#zoomIn").click();
  await page.waitForTimeout(400);
  const scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBeCloseTo(1.25, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: FAIL — `#zoomIn` not found / `__fractal` undefined / cssW is larger than 960 (virtual canvas is 1.82× viewport).

- [ ] **Step 3: Markup + CSS + ui-map + state changes**

3a. In the `.zoom-cluster` markup (anchor: `<input id="zoom" type="range"`), replace the input+span with:

```html
    <button class="tool zoom-btn" id="zoomOut" type="button" title="Zoom out (−)" aria-label="Zoom out">−</button>
    <span class="zoom-value" id="zoomValue" title="Double-click to reset view">×1.00</span>
    <button class="tool zoom-btn" id="zoomIn" type="button" title="Zoom in (+)" aria-label="Zoom in">+</button>
```

3b. Add CSS next to the existing `.zoom-value` rule:

```css
    .zoom-btn {
      width: 30px;
      height: 30px;
      font-size: 16px;
      line-height: 1;
    }
```

3c. In the `ui` object literal (anchor: `zoom: document.getElementById("zoom")`), replace that entry with:

```js
        zoomIn: document.getElementById("zoomIn"),
        zoomOut: document.getElementById("zoomOut"),
```

(Keep the existing `zoomValue` entry.)

3d. In the main `state` literal (anchor: `zoom: 1,`), add directly after it:

```js
        view: { x: 0, y: 0, scale: 1 },
```

3e. In `updateUi()` replace the two lines (anchor: `ui.zoom.value = String(Math.round(state.zoom * 100));`):

```js
        const totalZoom = ((state.view && state.view.scale) || 1) * (state.zoom || 1);
        ui.zoomValue.textContent = totalZoom >= 100
          ? `×${Math.round(totalZoom)}`
          : totalZoom >= 10 ? `×${totalZoom.toFixed(1)}` : `×${totalZoom.toFixed(2)}`;
```

3f. In `syncCanvasConfig()` (expanded block), delete the two `ui.zoom.min/max` lines (anchor: `ui.zoom.min = String(Math.ceil(100 / state.canvasScale));`).

3g. Near the end of the file, delete the two old listeners (anchor: `ui.zoom.addEventListener("input"`), both lines.

- [ ] **Step 4: Make the canvas viewport-sized and remove clamps (inside the expanded block)**

4a. In `CANVAS_CONFIG`, change `desktopScale: 1.82,` → `desktopScale: 1,` and `mobileScale: 1.45,` → `mobileScale: 1,`.

4b. Replace the body of `clampPan()` (anchor: `function clampPan() {`) with a no-op comment: `// Infinite canvas: pan is unbounded.` (keep the empty function so existing calls stay valid).

4c. Replace the patched `applyZoom` (anchor: `applyZoom = function patchedExpandedApplyZoom()`) with:

```js
        applyZoom = function previewApplyZoom() {
          state.zoom = Math.max(Number(state.zoom) || 1, 1e-9);
          canvas.style.left = `calc(50% + ${state.panX}px)`;
          canvas.style.top = `calc(50% + ${state.panY}px)`;
          canvas.style.transform = `translate(-50%, -50%) scale(${state.zoom})`;
          updateUi();
        };
```

4d. In `updateGesture`, replace the clamped zoom line (anchor: `state.zoom = clamp(gestureStart.zoom * ratio, 1 / (state.canvasScale || 1), 2.4);`) with:

```js
          state.zoom = gestureStart.zoom * ratio;
```

4e. In `endGesturePointer`, commit the preview when a gesture actually ends. Replace the `if (activeTouchPointers.size < 2) { ... }` body with:

```js
          if (activeTouchPointers.size < 2) {
            const wasGesturing = state.gesturing;
            state.gesturing = false;
            gestureStart = null;
            state.painting = false;
            state.pointerId = null;
            state.last = null;
            hideSymmetryGuide();
            if (wasGesturing) commitViewPreview();
            updateUi();
          }
```

4f. At the bottom of the expanded block, delete the final clamp line (anchor: `state.zoom = clamp(state.zoom, 1 / (state.canvasScale || 1), 2.4);`).

- [ ] **Step 5: Add the view model, preview commit, wheel/Safari-gesture handlers, and test hook**

Insert inside the expanded block, after `endGesturePointer`'s definition and before `function previewSymmetryGuide` :

```js
        /* ---- Infinite view model ---------------------------------------- */
        const REBUILD_DEBOUNCE_MS = 150;
        const ZOOM_STEP_FACTOR = 1.25;

        function viewCssWidth() { return state.width / (state.dpr || 1); }
        function viewCssHeight() { return state.height / (state.dpr || 1); }

        function screenToWorld(sx, sy) {
          return [
            state.view.x + (sx - viewCssWidth() / 2) / state.view.scale,
            state.view.y + (sy - viewCssHeight() / 2) / state.view.scale
          ];
        }

        function worldToScreen(wx, wy) {
          return [
            (wx - state.view.x) * state.view.scale + viewCssWidth() / 2,
            (wy - state.view.y) * state.view.scale + viewCssHeight() / 2
          ];
        }

        // v1 (soft): carry the raster across the view change by scaling it.
        // Task 4 replaces this body with the crisp stroke-replay pipeline.
        let rebuildView = function softRebuildView(zoom, panX, panY) {
          const shot = makeSnapshot();
          clearSurface();
          ctx.globalCompositeOperation = "source-over";
          ctx.setTransform(
            zoom, 0, 0, zoom,
            canvas.width / 2 - zoom * (canvas.width / 2) + panX * state.dpr,
            canvas.height / 2 - zoom * (canvas.height / 2) + panY * state.dpr
          );
          ctx.drawImage(shot, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        };

        function commitViewPreview() {
          const zoom = Number(state.zoom) || 1;
          const panX = state.panX || 0;
          const panY = state.panY || 0;
          if (zoom === 1 && panX === 0 && panY === 0) return;
          const nextScale = state.view.scale * zoom;
          state.view.x -= panX / nextScale;
          state.view.y -= panY / nextScale;
          state.view.scale = nextScale;
          rebuildView(zoom, panX, panY);
          state.zoom = 1;
          state.panX = 0;
          state.panY = 0;
          applyZoom();
        }

        let previewCommitTimer = null;
        function previewZoomAt(clientX, clientY, factor) {
          if (state.painting) return;
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          state.panX = clientX - cx - (clientX - cx - state.panX) * factor;
          state.panY = clientY - cy - (clientY - cy - state.panY) * factor;
          state.zoom = (Number(state.zoom) || 1) * factor;
          applyZoom();
          if (previewCommitTimer) window.clearTimeout(previewCommitTimer);
          previewCommitTimer = window.setTimeout(() => {
            previewCommitTimer = null;
            commitViewPreview();
          }, REBUILD_DEBOUNCE_MS);
        }

        function resetView() {
          state.view = { x: 0, y: 0, scale: 1 };
          state.zoom = 1;
          state.panX = 0;
          state.panY = 0;
          clearSurface(); // v1: raster can't be recovered; Task 4 replaces this line
          applyZoom();
        }

        stage.addEventListener("wheel", (event) => {
          event.preventDefault();
          if (state.painting || state.gesturing) return;
          const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.014 : 0.0022));
          previewZoomAt(event.clientX, event.clientY, factor);
        }, { passive: false });

        // Safari-only proprietary pinch events; harmless elsewhere.
        let safariGestureScale = 1;
        stage.addEventListener("gesturestart", (event) => {
          event.preventDefault();
          safariGestureScale = event.scale || 1;
        });
        stage.addEventListener("gesturechange", (event) => {
          event.preventDefault();
          if (state.painting || state.gesturing) return;
          const scale = event.scale || 1;
          previewZoomAt(
            event.clientX ?? window.innerWidth / 2,
            event.clientY ?? window.innerHeight / 2,
            scale / (safariGestureScale || 1)
          );
          safariGestureScale = scale;
        });
        stage.addEventListener("gestureend", (event) => event.preventDefault());

        stepZoom = function infiniteStepZoom(delta) {
          previewZoomAt(window.innerWidth / 2, window.innerHeight / 2,
            delta >= 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR);
        };

        setZoom = function infiniteSetZoom(zoom) {
          const target = Number(zoom) || 1;
          if (target === 1) { resetView(); return; }
          previewZoomAt(window.innerWidth / 2, window.innerHeight / 2,
            target / (state.view.scale * (Number(state.zoom) || 1)));
        };

        ui.zoomIn.addEventListener("click", () => stepZoom(1));
        ui.zoomOut.addEventListener("click", () => stepZoom(-1));
        ui.zoomValue.addEventListener("dblclick", () => resetView());

        window.__fractal = {
          state,
          screenToWorld,
          worldToScreen,
          previewZoomAt,
          commitViewPreview,
          resetView
        };
```

Note: `rebuildView` is deliberately a `let` so Task 4 can swap in the crisp implementation with a one-line reassignment inside the same block.

- [ ] **Step 6: Run the new spec, then the regression suites**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: PASS (all 4 tests).

Run: `npx playwright test tests/vector-export.spec.js tests/render-qa.spec.js tests/brush-density.spec.js tests/silk-feel.spec.js tests/tutorial.spec.js tests/panel-drag.spec.js`
Expected: PASS. If a suite manipulated the old `#zoom` range or depended on the 1.82× virtual canvas, fix the app (not the test) unless the test's assertion is about the removed control itself.

- [ ] **Step 7: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): infinite view model with unbounded zoom/pan navigation"
```

---

### Task 2: Desktop — hand tool, Space/middle-button pan

**Files:**
- Modify: `app/index.html` (toolbar markup, CSS, expanded block)
- Test: `tests/infinite-zoom.spec.js` (extend)

**Interfaces:**
- Consumes: `state.view`, `commitViewPreview()`, `applyZoom()` from Task 1.
- Produces: `state.tool` (`"brush" | "hand"`), `state.spaceHeld`, `state.panning`, `setTool(tool)` (also in `window.__fractal.setTool`), `#handTool` toolbar button, `body.hand-mode` / `body.panning` classes driving cursors.

- [ ] **Step 1: Write the failing tests** (append to `tests/infinite-zoom.spec.js`)

```js
test("hand tool pans without painting", async ({ page }) => {
  await setupPage(page);
  await page.locator("#handTool").click();
  await expect(page.locator("#handTool")).toHaveAttribute("aria-pressed", "true");
  const before = await page.evaluate(() => ({ ...window.__fractal.state.view }));
  const stage = page.locator("#stage");
  await stage.dispatchEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  await stage.dispatchEvent("pointermove", { clientX: 520, clientY: 340, pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 520, clientY: 340, pointerId: 7, pointerType: "mouse", bubbles: true }));
  });
  const after = await page.evaluate(() => ({
    view: { ...window.__fractal.state.view },
    painting: window.__fractal.state.painting
  }));
  expect(after.painting).toBe(false);
  expect(after.view.x).toBeCloseTo(before.x - 120, 3);
  expect(after.view.y).toBeCloseTo(before.y - 40, 3);
});

test("H toggles hand tool, Escape returns to brush, Space pans while held", async ({ page }) => {
  await setupPage(page);
  await page.keyboard.press("h");
  await expect(page.locator("#handTool")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#handTool")).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.down("Space");
  const stage = page.locator("#stage");
  await stage.dispatchEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 9, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  await stage.dispatchEvent("pointermove", { clientX: 350, clientY: 300, pointerId: 9, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 350, clientY: 300, pointerId: 9, pointerType: "mouse", bubbles: true }));
  });
  await page.keyboard.up("Space");
  const view = await page.evaluate(() => window.__fractal.state.view);
  expect(view.x).toBeCloseTo(50, 3);
  const painting = await page.evaluate(() => window.__fractal.state.painting);
  expect(painting).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: the two new tests FAIL (`#handTool` not found); Task 1 tests still PASS.

- [ ] **Step 3: Add the toolbar button, CSS, and pan logic**

3a. Markup — in the toolbar, directly after the `#redo` button element, add:

```html
      <button class="tool" id="handTool" type="button" title="Hand — pan the view (H)" aria-label="Hand tool" aria-pressed="false" data-mobile-label="Pan">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 12.5a1.5 1.5 0 0 1 3 1c0 3-1.5 4.5-2.5 6-1 1.4-2.6 2.5-5 2.5-3.2 0-4.6-1.6-6.4-4.8L4.4 14a1.4 1.4 0 0 1 2.4-1.4L8 14.5"/></svg>
      </button>
```

3b. CSS (next to `#stage` rules):

```css
    body.hand-mode #stage { cursor: grab; }
    body.panning #stage { cursor: grabbing; }
```

3c. `ui` map: after the `redo:` entry add `handTool: document.getElementById("handTool"),`

3d. `state` literal: after `view: { x: 0, y: 0, scale: 1 },` add:

```js
        tool: "brush",
        spaceHeld: false,
        panning: null,
```

3e. Inside the expanded block, after the `window.__fractal = {...}` assignment from Task 1, add:

```js
        /* ---- Hand tool & drag panning ----------------------------------- */
        function setTool(tool) {
          state.tool = tool === "hand" ? "hand" : "brush";
          ui.handTool.setAttribute("aria-pressed", String(state.tool === "hand"));
          document.body.classList.toggle("hand-mode", state.tool === "hand" || state.spaceHeld);
        }

        function panModeActive(event) {
          if (event.button === 1) return true;
          if (event.pointerType === "touch") return state.tool === "hand";
          return (state.tool === "hand" || state.spaceHeld) && (event.button === 0 || event.button === undefined);
        }

        function beginPan(event) {
          if (state.painting || state.gesturing || state.panning) return;
          if (!panModeActive(event)) return;
          state.panning = {
            pointerId: event.pointerId ?? "mouse",
            startX: event.clientX,
            startY: event.clientY,
            panX: state.panX,
            panY: state.panY
          };
          document.body.classList.add("panning");
          if (event.pointerId !== undefined && stage.setPointerCapture) {
            try { stage.setPointerCapture(event.pointerId); } catch (_) {}
          }
          event.preventDefault();
          event.stopImmediatePropagation();
        }

        function movePan(event) {
          if (!state.panning || (event.pointerId ?? "mouse") !== state.panning.pointerId) return;
          state.panX = state.panning.panX + (event.clientX - state.panning.startX);
          state.panY = state.panning.panY + (event.clientY - state.panning.startY);
          applyZoom();
          event.preventDefault();
          event.stopImmediatePropagation();
        }

        function endPan(event) {
          if (!state.panning || (event.pointerId ?? "mouse") !== state.panning.pointerId) return;
          state.panning = null;
          document.body.classList.remove("panning");
          commitViewPreview();
        }

        stage.addEventListener("pointerdown", beginPan, { capture: true });
        stage.addEventListener("pointermove", movePan, { capture: true });
        window.addEventListener("pointerup", endPan, { capture: true });
        stage.addEventListener("pointercancel", endPan, { capture: true });

        ui.handTool.addEventListener("click", () => setTool(state.tool === "hand" ? "brush" : "hand"));

        window.addEventListener("keydown", (event) => {
          const tag = document.activeElement && document.activeElement.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || !ui.tutorial.hidden) return;
          if (event.key === " " && !event.repeat) {
            state.spaceHeld = true;
            document.body.classList.add("hand-mode");
            event.preventDefault();
          } else if (event.key.toLowerCase() === "h") {
            setTool(state.tool === "hand" ? "brush" : "hand");
            event.preventDefault();
          } else if (event.key === "Escape" && state.tool === "hand") {
            setTool("brush");
          }
        });
        window.addEventListener("keyup", (event) => {
          if (event.key === " ") {
            state.spaceHeld = false;
            document.body.classList.toggle("hand-mode", state.tool === "hand");
          }
        });

        window.__fractal.setTool = setTool;
```

Ordering note: `beginPan` is attached with `capture: true` *after* `beginGestureIfNeeded`, so two-finger touch gestures still win (they set `state.gesturing` on the second finger; `beginPan` bails when gesturing). `stopImmediatePropagation()` in the capture phase prevents the bubble-phase `startPainting` from firing.

Touch + hand tool: one finger pans when the hand tool is active (`panModeActive` checks `state.tool` for touch), two fingers still pinch-zoom.

- [ ] **Step 4: Run the spec**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): hand tool with space-hold and middle-button panning"
```

---

### Task 3: Desktop — deterministic stroke engine and recording

**Files:**
- Modify: `app/index.html` (expanded block; `beginGestureIfNeeded`)
- Test: `tests/infinite-zoom.spec.js` (extend)

**Interfaces:**
- Consumes: `state.view`, `screenToWorld` (Task 1); base `startPainting`/`stopPainting`/`spawnAlong`/`spawnFan`/`step`/`branchFrom` bindings.
- Produces:
  - `mulberry32(seed) -> () => number` and `const nativeRandom = Math.random;`
  - `state.strokeLog: Stroke[]`, `state.liveStroke: Stroke|null`, `state.undoStack: Action[]`, `state.redoStack: Action[]`.
  - `Stroke = { id, seed, brush, hue, hue2, blend, size, scaleFactor, expansion, symmetry, mirror, custom, symCenter:{x,y}, drawScale, dpr, viewW, viewH, segments, stepCount, maxR }`
  - `segments` entries: `{ x0, y0, x1, y1, step }` (from `spawnAlong`) or `{ fan: true, x, y, dx, dy, step }` (from direct `spawnFan` calls, e.g. hold-bloom). Coordinates are stroke-local CSS px.
  - `Action = { type: "stroke", stroke? } | { type: "clear", strokes }` (Task 5 consumes).
  - `stepTendrils(list)` — one fixed simulation step over a tendril list; per-tendril `tendril.rng` streams; branch children inherit `strokeRef` and get child streams. Used by live loop and (Task 4) replay.
  - `commitLiveStroke()` — pushes a non-empty live stroke to `strokeLog` + `undoStack`, clears `redoStack`.
  - `window.__fractal.mulberry32` exposed.

- [ ] **Step 1: Write the failing tests** (append to `tests/infinite-zoom.spec.js`; reuse the `drawStroke` helper pattern from `tests/vector-export.spec.js` — copy it into this file):

```js
async function drawStroke(page, y = 360, xStart = 190, xEnd = 610) {
  const stage = page.locator("#stage");
  await stage.dispatchEvent("pointerdown", { clientX: xStart, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  for (let x = xStart + 60; x <= xEnd; x += 60) {
    await stage.dispatchEvent("pointermove", { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
    await page.waitForTimeout(30);
  }
  await stage.dispatchEvent("pointerup", { clientX: xEnd, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, bubbles: true });
}

test("strokes are recorded into the stroke log with replay data", async ({ page }) => {
  await setupPage(page);
  await drawStroke(page);
  await page.waitForTimeout(200);
  const log = await page.evaluate(() => window.__fractal.state.strokeLog.map((s) => ({
    seed: s.seed, segs: s.segments.length, drawScale: s.drawScale,
    symCenter: s.symCenter, brush: s.brush, maxR: s.maxR
  })));
  expect(log.length).toBe(1);
  expect(log[0].segs).toBeGreaterThan(0);
  expect(log[0].drawScale).toBe(1);
  expect(log[0].symCenter).toEqual({ x: 0, y: 0 });
  expect(log[0].maxR).toBeGreaterThan(0);
  await drawStroke(page, 250);
  await page.waitForTimeout(200);
  const seeds = await page.evaluate(() => window.__fractal.state.strokeLog.map((s) => s.seed));
  expect(seeds.length).toBe(2);
  expect(seeds[0]).not.toBe(seeds[1]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: new test FAILS (`strokeLog` undefined).

- [ ] **Step 3: Implement PRNG, recording wrappers, and the deterministic step**

3a. `state` literal — after `panning: null,` add:

```js
        strokeLog: [],
        liveStroke: null,
        undoStack: [],
        redoStack: [],
```

3b. Inside the expanded block, after the hand-tool section (Task 2), add:

```js
        /* ---- Deterministic stroke recording ------------------------------ */
        const nativeRandom = Math.random;
        let strokeIdCounter = 0;

        function mulberry32(seed) {
          let a = seed >>> 0;
          return function seededRandom() {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
        }

        function tagNewTendrils(stroke) {
          for (const tendril of state.tendrils) {
            if (!tendril.rng) {
              tendril.rng = mulberry32(Math.floor(stroke.rng() * 4294967296));
              tendril.strokeRef = stroke;
            }
          }
        }

        function commitLiveStroke() {
          const stroke = state.liveStroke;
          if (!stroke) return;
          state.liveStroke = null;
          if (!stroke.segments.length) return;
          delete stroke.rng; // transient; seed is what matters
          state.strokeLog.push(stroke);
          state.undoStack.push({ type: "stroke" });
          state.redoStack = [];
          updateUi();
        }

        const recordedStartPainting = startPainting;
        startPainting = function recordingStartPainting(event) {
          const wasPainting = state.painting;
          const result = recordedStartPainting(event);
          if (!wasPainting && state.painting) {
            const seed = Math.floor(nativeRandom() * 4294967296);
            state.liveStroke = {
              id: (strokeIdCounter += 1),
              seed,
              rng: mulberry32(seed),
              brush: state.brush,
              hue: state.hue,
              hue2: state.hue2,
              blend: state.blend,
              size: state.size,
              scaleFactor: state.scaleFactor,
              expansion: state.expansion,
              symmetry: state.symmetry,
              mirror: state.mirror,
              custom: state.brush === "custom"
                ? JSON.parse(JSON.stringify(brushProfiles.custom))
                : null,
              symCenter: { x: state.view.x, y: state.view.y },
              drawScale: state.view.scale,
              dpr: state.dpr,
              viewW: state.width,
              viewH: state.height,
              segments: [],
              stepCount: 0,
              maxR: 0
            };
          }
          return result;
        };

        let insideSpawnAlong = false;
        const recordedSpawnAlong = spawnAlong;
        spawnAlong = function recordingSpawnAlong(x0, y0, x1, y1) {
          const stroke = state.liveStroke;
          if (!stroke) { recordedSpawnAlong(x0, y0, x1, y1); return; }
          stroke.segments.push({ x0, y0, x1, y1, step: stroke.stepCount });
          insideSpawnAlong = true;
          Math.random = stroke.rng;
          recordedSpawnAlong(x0, y0, x1, y1);
          Math.random = nativeRandom;
          insideSpawnAlong = false;
          tagNewTendrils(stroke);
        };

        const recordedSpawnFan = spawnFan;
        spawnFan = function recordingSpawnFan(x, y, dx, dy) {
          const stroke = state.liveStroke;
          if (!stroke || insideSpawnAlong) { recordedSpawnFan(x, y, dx, dy); return; }
          // Direct call outside spawnAlong (hold-bloom): record as a fan event.
          stroke.segments.push({ fan: true, x, y, dx, dy, step: stroke.stepCount });
          Math.random = stroke.rng;
          recordedSpawnFan(x, y, dx, dy);
          Math.random = nativeRandom;
          tagNewTendrils(stroke);
        };

        const recordedStopPainting = stopPainting;
        stopPainting = function recordingStopPainting(event) {
          const wasPainting = state.painting;
          const result = recordedStopPainting(event);
          if (wasPainting && !state.painting) commitLiveStroke();
          return result;
        };

        /* ---- Deterministic simulation step -------------------------------
           Mirrors the original step() body (see `function step()` near the
           base engine) with three changes: operates on an arbitrary list,
           uses per-tendril seeded RNG streams, and tags branch children. */
        function stepTendrils(list) {
          for (let i = list.length - 1; i >= 0; i -= 1) {
            const tendril = list[i];
            if (tendril.rng) Math.random = tendril.rng;
            const ox = tendril.x;
            const oy = tendril.y;
            const speed = Math.max(0.001, Math.hypot(tendril.vx, tendril.vy));
            const nx = -tendril.vy / speed;
            const ny = tendril.vx / speed;
            const phase = tendril.maxLife - tendril.life;
            const curl = Math.sin(phase * 0.16 + tendril.seed) * tendril.curl;

            tendril.vx += nx * curl * state.dpr;
            tendril.vy += ny * curl * state.dpr;
            const noiseShare = tendril.angular ? 0.42 : 0.12;
            const seed2 = tendril.seed * 2.618;
            const wanderX = Math.sin(phase * 0.21 + tendril.seed) * Math.cos(phase * 0.057 + seed2);
            const wanderY = Math.cos(phase * 0.17 + seed2) * Math.sin(phase * 0.049 + tendril.seed);
            tendril.vx += tendril.jitter * (wanderX * (1 - noiseShare) * 0.62 + rand(-1, 1) * noiseShare) * state.dpr;
            tendril.vy += tendril.jitter * (wanderY * (1 - noiseShare) * 0.62 + rand(-1, 1) * noiseShare) * state.dpr;
            tendril.vy -= tendril.lift * state.dpr * (1 + tendril.width);
            quantizeVelocity(tendril, tendril.angular);

            const tx = tendril.x + tendril.vx;
            const ty = tendril.y + tendril.vy;
            drawBrushSegment(ox, oy, tx, ty, tendril);

            tendril.x = tx;
            tendril.y = ty;
            tendril.vx *= tendril.drag;
            tendril.vy *= tendril.drag;
            tendril.life -= 1;

            if (tendril.strokeRef) {
              const reach = Math.hypot(tendril.x - state.cx, tendril.y - state.cy) + tendril.width * 3;
              if (reach > tendril.strokeRef.maxR) tendril.strokeRef.maxR = reach;
            }

            const activeProfile = brushProfiles[tendril.brush] || brushProfiles.thunder;
            const maxTendrils = Math.round((activeProfile.maxTendrils || 1600) * (0.72 + state.expansion * 0.34));
            if (tendril.life > 12 && Math.random() < tendril.branch && list.length < maxTendrils) {
              branchFrom(tendril, speed);
              const child = list[list.length - 1];
              if (child && !child.rng && tendril.rng) {
                child.rng = mulberry32(Math.floor(tendril.rng() * 4294967296));
                child.strokeRef = tendril.strokeRef;
              }
            }

            if (
              tendril.life <= 0 ||
              Math.abs(tendril.vx) + Math.abs(tendril.vy) < 0.015 ||
              tendril.x < -state.width * 0.1 ||
              tendril.x > state.width * 1.1 ||
              tendril.y < -state.height * 0.1 ||
              tendril.y > state.height * 1.1
            ) {
              list.splice(i, 1);
            }
            Math.random = nativeRandom;
          }
        }

        step = function infiniteStep() {
          stepTendrils(state.tendrils);
          if (state.liveStroke) state.liveStroke.stepCount += 1;
          requestAnimationFrame(step);
        };

        window.__fractal.mulberry32 = mulberry32;
        window.__fractal.stepTendrils = stepTendrils;
```

**Verify while implementing:** `branchFrom` pushes onto `state.tendrils` directly. During live stepping `list === state.tendrils`, so `list[list.length - 1]` is the child. Task 4's replay swaps `state.tendrils` to the replay list before calling `stepTendrils`, preserving this invariant. Also confirm the base `step()` body you copied matches the current file — if the base engine changed since commit `bb16962`, mirror the *current* body, keeping the three documented changes.

3c. In `beginGestureIfNeeded` (same block), after the line `state.painting = false;` add:

```js
          commitLiveStroke();
```

(A stroke interrupted by a second finger is committed with what it has.)

- [ ] **Step 4: Run the spec + regression**

Run: `npx playwright test tests/infinite-zoom.spec.js tests/brush-density.spec.js tests/silk-feel.spec.js tests/render-qa.spec.js`
Expected: PASS. brush-density/silk-feel assert live stroke appearance — the per-tendril RNG swap must not change the *distribution* of randomness, only its source, so visuals stay statistically identical.

- [ ] **Step 5: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): deterministic seeded stroke engine with input recording"
```

---

### Task 4: Desktop — replay engine and crisp view rebuild

**Files:**
- Modify: `app/index.html` (expanded block)
- Test: `tests/infinite-zoom.spec.js` (extend)

**Interfaces:**
- Consumes: everything from Tasks 1–3 (`rebuildView` let-binding, `stepTendrils`, `Stroke` records, `mulberry32`, `nativeRandom`, `tagNewTendrils`, `worldToScreen`, `viewCssWidth/Height`).
- Produces:
  - `replayStroke(stroke)` — deterministically re-simulates one stroke onto the main canvas at the current view via `ctx.setTransform`.
  - `renderWorldSync()` — clear + background + replay all visible strokes synchronously.
  - `scheduleRebuild()` / `pumpRender()` / `flushRenderJob()` — chunked (8 ms budget/frame) rebuild with soft-preview overlay `#viewPreview` canvas.
  - `visibleStrokes()`, `strokeWorldRadius(stroke)` — bounding-circle culling.
  - LOD: strokes with on-screen diameter < 1.5 device px render as a single faint additive dot (`drawStrokeDot`).
  - `window.__fractal.renderWorldSync`, `window.__fractal.flushRenderJob` exposed.
  - `rebuildView` reassigned to the crisp pipeline (soft preview overlay + chunked replay).

- [ ] **Step 1: Write the failing tests** (append):

```js
test("strokes survive zoom crisply: draw, zoom in, draw, zoom out", async ({ page }) => {
  await setupPage(page);
  await drawStroke(page, 360);
  await page.waitForTimeout(600);
  // zoom in 8x about the stroke's left end
  await page.evaluate(() => {
    window.__fractal.previewZoomAt(480, 360, 8);
    window.__fractal.commitViewPreview();
    window.__fractal.flushRenderJob();
  });
  await drawStroke(page, 250);
  await page.waitForTimeout(600);
  // zoom back out
  await page.evaluate(() => {
    window.__fractal.previewZoomAt(480, 360, 1 / 8);
    window.__fractal.commitViewPreview();
    window.__fractal.flushRenderJob();
  });
  const counts = await page.evaluate(() => {
    const canvas = document.getElementById("art");
    const ctx2 = canvas.getContext("2d");
    const { data } = ctx2.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit += 1;
    }
    return { lit, strokes: window.__fractal.state.strokeLog.length };
  });
  expect(counts.strokes).toBe(2);
  expect(counts.lit).toBeGreaterThan(500); // both strokes visible
});

test("world render is deterministic: two replays produce identical pixels", async ({ page }) => {
  await setupPage(page);
  await drawStroke(page, 360);
  await page.waitForTimeout(600);
  const [first, second] = await page.evaluate(() => {
    const canvas = document.getElementById("art");
    window.__fractal.renderWorldSync();
    const a = canvas.toDataURL();
    window.__fractal.renderWorldSync();
    const b = canvas.toDataURL();
    return [a, b];
  });
  expect(first).toBe(second);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: new tests FAIL (`flushRenderJob`/`renderWorldSync` undefined).

- [ ] **Step 3: Implement replay + rebuild pipeline** (inside the expanded block, after Task 3's code):

```js
        /* ---- Replay & crisp rebuild -------------------------------------- */
        const RENDER_BUDGET_MS = 8;
        const REPLAY_STEP_GUARD = 20000;

        const previewCanvas = document.createElement("canvas");
        previewCanvas.id = "viewPreview";
        previewCanvas.setAttribute("aria-hidden", "true");
        previewCanvas.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;";
        stage.appendChild(previewCanvas);

        function strokeWorldRadius(stroke) {
          return stroke.maxR / (stroke.dpr * stroke.drawScale);
        }

        function visibleStrokes() {
          const halfW = viewCssWidth() / 2 / state.view.scale;
          const halfH = viewCssHeight() / 2 / state.view.scale;
          return state.strokeLog.filter((stroke) => {
            const r = strokeWorldRadius(stroke);
            return stroke.symCenter.x + r > state.view.x - halfW &&
              stroke.symCenter.x - r < state.view.x + halfW &&
              stroke.symCenter.y + r > state.view.y - halfH &&
              stroke.symCenter.y - r < state.view.y + halfH;
          });
        }

        function drawStrokeDot(stroke, sx, sy) {
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `hsla(${Math.round(normalizedHue(stroke.hue))}, 90%, 60%, 0.5)`;
          const px = Math.max(1, Math.round(state.dpr));
          ctx.fillRect(Math.round(sx * state.dpr), Math.round(sy * state.dpr), px, px);
        }

        function replayStroke(stroke) {
          // k converts stroke-local device px to current device px.
          const k = (state.view.scale / stroke.drawScale) * (state.dpr / stroke.dpr);
          const [sx, sy] = worldToScreen(stroke.symCenter.x, stroke.symCenter.y);
          if (stroke.maxR * k * 2 < 1.5) {
            drawStrokeDot(stroke, sx, sy);
            return;
          }
          const saved = {
            brush: state.brush, hue: state.hue, hue2: state.hue2, blend: state.blend,
            size: state.size, scaleFactor: state.scaleFactor, expansion: state.expansion,
            symmetry: state.symmetry, mirror: state.mirror,
            dpr: state.dpr, width: state.width, height: state.height,
            cx: state.cx, cy: state.cy,
            tendrils: state.tendrils, strokeDistance: state.strokeDistance,
            liveStroke: state.liveStroke
          };
          const savedCustom = stroke.custom
            ? JSON.parse(JSON.stringify(brushProfiles.custom)) : null;
          if (stroke.custom) Object.assign(brushProfiles.custom, stroke.custom);

          state.brush = stroke.brush;
          state.hue = stroke.hue;
          state.hue2 = stroke.hue2;
          state.blend = stroke.blend;
          state.size = stroke.size;
          state.scaleFactor = stroke.scaleFactor;
          state.expansion = stroke.expansion;
          state.symmetry = stroke.symmetry;
          state.mirror = stroke.mirror;
          state.dpr = stroke.dpr;
          state.width = stroke.viewW;
          state.height = stroke.viewH;
          state.cx = stroke.viewW / 2;
          state.cy = stroke.viewH / 2;
          state.tendrils = [];
          state.strokeDistance = 0;
          state.liveStroke = null;

          ctx.setTransform(
            k, 0, 0, k,
            sx * saved.dpr - k * (stroke.viewW / 2),
            sy * saved.dpr - k * (stroke.viewH / 2)
          );

          const replayContext = { rng: mulberry32(stroke.seed) };
          let segIndex = 0;
          let stepIndex = 0;
          let guard = 0;
          while ((segIndex < stroke.segments.length || state.tendrils.length) && guard < REPLAY_STEP_GUARD) {
            while (segIndex < stroke.segments.length && stroke.segments[segIndex].step <= stepIndex) {
              const seg = stroke.segments[segIndex];
              segIndex += 1;
              Math.random = replayContext.rng;
              if (seg.fan) {
                recordedSpawnFan(seg.x, seg.y, seg.dx, seg.dy);
              } else {
                recordedSpawnAlong(seg.x0, seg.y0, seg.x1, seg.y1);
              }
              Math.random = nativeRandom;
              tagNewTendrils(replayContext);
            }
            stepTendrils(state.tendrils);
            stepIndex += 1;
            guard += 1;
          }

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          if (savedCustom) Object.assign(brushProfiles.custom, savedCustom);
          Object.assign(state, saved);
        }

        let renderJob = null;

        function renderWorldSync() {
          renderJob = null;
          previewCanvas.style.display = "none";
          state.tendrils.length = 0;
          clearSurface();
          for (const stroke of visibleStrokes()) replayStroke(stroke);
        }

        function pumpRender() {
          if (!renderJob) return;
          const start = performance.now();
          while (renderJob.index < renderJob.strokes.length &&
                 performance.now() - start < RENDER_BUDGET_MS) {
            replayStroke(renderJob.strokes[renderJob.index]);
            renderJob.index += 1;
          }
          if (renderJob.index >= renderJob.strokes.length) {
            renderJob = null;
            previewCanvas.style.display = "none";
          } else {
            requestAnimationFrame(pumpRender);
          }
        }

        function flushRenderJob() {
          if (!renderJob) return;
          while (renderJob.index < renderJob.strokes.length) {
            replayStroke(renderJob.strokes[renderJob.index]);
            renderJob.index += 1;
          }
          renderJob = null;
          previewCanvas.style.display = "none";
        }

        function scheduleRebuild(zoom, panX, panY) {
          // Soft preview: current pixels, transformed, on the overlay.
          previewCanvas.width = canvas.width;
          previewCanvas.height = canvas.height;
          const pctx = previewCanvas.getContext("2d");
          pctx.fillStyle = "#000";
          pctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
          pctx.setTransform(
            zoom, 0, 0, zoom,
            canvas.width / 2 - zoom * (canvas.width / 2) + panX * state.dpr,
            canvas.height / 2 - zoom * (canvas.height / 2) + panY * state.dpr
          );
          pctx.drawImage(canvas, 0, 0);
          pctx.setTransform(1, 0, 0, 1, 0, 0);
          previewCanvas.style.display = "block";

          // Live tendrils are already recorded; kill them so they don't paint
          // at stale positions while the crisp render builds underneath.
          state.tendrils.length = 0;
          clearSurface();
          renderJob = { strokes: visibleStrokes(), index: 0 };
          requestAnimationFrame(pumpRender);
        }

        rebuildView = function crispRebuildView(zoom, panX, panY) {
          scheduleRebuild(zoom, panX, panY);
        };

        window.__fractal.renderWorldSync = renderWorldSync;
        window.__fractal.flushRenderJob = flushRenderJob;
        window.__fractal.replayStroke = replayStroke;
```

3b. Guard interactions with a pending render — add `flushRenderJob();` as the first line of:
- `recordingStartPainting` (before calling through),
- `beginPan`,
- `beginGestureIfNeeded`,
- the `wheel` listener (before the `state.painting` check),
- `resetView` (replace its `clearSurface();` line with `flushRenderJob(); renderWorldSync();`).

Note `flushRenderJob` and `scheduleRebuild` are declared *after* Task 1–2's handlers in source order but all live in the same block — function declarations hoist within the block, so the earlier handlers can call them. `rebuildView` reassignment happens at block-init time, before any user interaction.

3c. Make `resize` re-render crisp: in the patched `resize` (anchor: `resize = function patchedExpandedResize()`), replace the snapshot/restore branch:

```js
          if (previous) {
            restoreSnapshot(previous);
          } else {
            clearSurface();
          }
```

with:

```js
          if (state.strokeLog && state.strokeLog.length) {
            renderWorldSync();
          } else if (previous) {
            restoreSnapshot(previous);
          } else {
            clearSurface();
          }
```

(`renderWorldSync` is block-scoped and `resize` is defined in the same block — verify the patched `resize` lives in the expanded block; it does.)

- [ ] **Step 4: Run spec + full regression**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: PASS (8 tests).

Run: `npx playwright test tests/vector-export.spec.js tests/render-qa.spec.js tests/brush-density.spec.js tests/silk-feel.spec.js tests/tutorial.spec.js tests/panel-drag.spec.js`
Expected: PASS. Note `vector-export.spec.js` stubs `Math.random` globally *before* our code caches `nativeRandom` — the cached reference will be the stubbed one, which is fine (still deterministic).

- [ ] **Step 5: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): deterministic stroke replay with crisp infinite-zoom rebuild"
```

---

### Task 5: Desktop — stroke-log undo/redo/clear

**Files:**
- Modify: `app/index.html` (expanded block, `updateUi`)
- Test: `tests/infinite-zoom.spec.js` (extend)

**Interfaces:**
- Consumes: `state.strokeLog/undoStack/redoStack`, `renderWorldSync()`, `commitLiveStroke()`.
- Produces: reassigned `undo`, `redo`, `clearArt`, no-op `pushHistory`; `updateUi` reads `undoStack`/`redoStack` for button disabled states.

- [ ] **Step 1: Write the failing test** (append):

```js
test("undo/redo/clear operate on the stroke log", async ({ page }) => {
  await setupPage(page);
  await drawStroke(page, 360);
  await page.waitForTimeout(300);
  await drawStroke(page, 250);
  await page.waitForTimeout(300);
  const count = () => page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(await count()).toBe(2);
  await page.locator("#undo").click();
  expect(await count()).toBe(1);
  await page.locator("#redo").click();
  expect(await count()).toBe(2);
  await page.keyboard.press("c"); // clear
  expect(await count()).toBe(0);
  await page.locator("#undo").click(); // undo the clear
  expect(await count()).toBe(2);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js`
Expected: new test FAILS (undo still raster-based; clear not undoable).

- [ ] **Step 3: Implement**

3a. In `updateUi()`, replace (anchor: `ui.undo.disabled = state.history.length === 0;`):

```js
        ui.undo.disabled = (state.undoStack || []).length === 0;
        ui.redo.disabled = (state.redoStack || []).length === 0;
```

3b. Inside the expanded block, after Task 4's code:

```js
        /* ---- Stroke-log history ------------------------------------------ */
        pushHistory = function noopPushHistory() {
          // Raster snapshots replaced by the stroke log (see undo/redo below).
          state.history.length = 0;
          state.redo.length = 0;
        };

        undo = function infiniteUndo() {
          flushRenderJob();
          const action = state.undoStack.pop();
          if (!action) return;
          if (action.type === "stroke") {
            const stroke = state.strokeLog.pop();
            state.redoStack.push({ type: "stroke", stroke });
          } else if (action.type === "clear") {
            state.strokeLog = action.strokes;
            state.redoStack.push({ type: "clear", strokes: action.strokes });
          }
          renderWorldSync();
          updateUi();
        };

        redo = function infiniteRedo() {
          flushRenderJob();
          const action = state.redoStack.pop();
          if (!action) return;
          if (action.type === "stroke") {
            state.strokeLog.push(action.stroke);
            state.undoStack.push({ type: "stroke" });
          } else if (action.type === "clear") {
            state.strokeLog = [];
            state.undoStack.push({ type: "clear", strokes: action.strokes });
          }
          renderWorldSync();
          updateUi();
        };

        clearArt = function infiniteClearArt() {
          flushRenderJob();
          commitLiveStroke();
          state.tendrils.length = 0;
          if (state.strokeLog.length) {
            state.undoStack.push({ type: "clear", strokes: state.strokeLog });
            state.strokeLog = [];
            state.redoStack = [];
          }
          clearSurface();
          updateUi();
          showStatus("Canvas cleared");
        };
```

**Verify while implementing:** read the original `clearArt` (anchor: `function clearArt()` in the base engine) and mirror any extra behavior it has (status message text, tendril clearing) so UX copy stays identical.

- [ ] **Step 4: Run spec + regression**

Run: `npx playwright test tests/infinite-zoom.spec.js tests/render-qa.spec.js tests/tutorial.spec.js`
Expected: PASS. (render-qa exercises undo/clear paths — watch it.)

- [ ] **Step 5: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): unlimited stroke-log undo/redo and undoable clear"
```

---

### Task 6: Desktop — crisp export through the replay path

**Files:**
- Modify: `app/index.html` (expanded block)
- Test: `tests/infinite-zoom.spec.js` (extend)

**Interfaces:**
- Consumes: `renderWorldSync()`, `flushRenderJob()`, module-scope `downloadBlob`, `canvasToBlob`, `showStatus`, and the module-scope `exportPresets` table (`{ current: {label:"current",width:0,height:0}, wide4k: {label:"4k-16-9",width:3840,height:2160}, square4k: {label:"4k-square",width:4096,height:4096} }`) — all reachable from the expanded block.
- Produces: reassigned `exportPngPreset(presetName)` — "current" exports the live canvas; sized presets re-render the world at target resolution on the main canvas, blob, then restore.

- [ ] **Step 1: Write the failing test** (append):

```js
test("4K export re-renders crisply at target resolution", async ({ page }) => {
  await setupPage(page);
  await page.addInitScript(() => {}); // page already loaded; use evaluate patching instead
  await page.evaluate(() => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob.type === "image/png") window.__lastPngExport = { size: blob.size };
      return originalCreateObjectURL(blob);
    };
    HTMLAnchorElement.prototype.click = function () { window.__lastDownloadName = this.download; };
  });
  await drawStroke(page, 360);
  await page.waitForTimeout(400);
  await page.locator("#exportToggle").click();
  await page.locator("[data-export='wide4k']").click();
  await expect.poll(() => page.evaluate(() => window.__lastPngExport?.size), { timeout: 20000 }).toBeGreaterThan(1000);
  const restored = await page.evaluate(() => ({
    exportedVia: window.__fractal.lastExportPath || null,
    w: document.getElementById("art").width
  }));
  expect(restored.exportedVia).toBe("replay"); // set by the new export path
  expect(restored.w).toBeLessThan(3840); // canvas restored after export
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js -g "4K export"`
Expected: FAIL — `window.__fractal.lastExportPath` is undefined on the old raster-upscale path. (Step 3's implementation sets `window.__fractal.lastExportPath = "replay";` right after `renderWorldSync()` in the sized-preset branch.)

- [ ] **Step 3: Implement** (inside the expanded block, after Task 5's code):

```js
        /* ---- Crisp export ------------------------------------------------- */
        const baseExportPngPreset = exportPngPreset;
        exportPngPreset = async function infiniteExportPngPreset(presetName) {
          flushRenderJob();
          commitLiveStroke();
          if (presetName === "current" || !state.strokeLog.length) {
            return baseExportPngPreset(presetName);
          }
          // Sized presets: re-render the world at target resolution.
          if (state.exporting) return;
          state.exporting = true;
          updateUi();
          showStatus("Preparing PNG export...", "busy");
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const preset = exportPresets[presetName];
          const saved = {
            deviceW: canvas.width, deviceH: canvas.height,
            dpr: state.dpr, width: state.width, height: state.height,
            cx: state.cx, cy: state.cy
          };
          try {
            const fit = Math.min(preset.width / window.innerWidth, preset.height / window.innerHeight);
            canvas.width = preset.width;
            canvas.height = preset.height;
            state.dpr = fit;
            state.width = preset.width;
            state.height = preset.height;
            state.cx = preset.width / 2;
            state.cy = preset.height / 2;
            renderWorldSync();
            window.__fractal.lastExportPath = "replay";
            downloadBlob(await canvasToBlob(canvas), preset.label, "png");
            showStatus("PNG export ready.", "success");
          } catch (error) {
            showStatus("Export failed in this browser. Try a smaller preset.", "error");
          } finally {
            canvas.width = saved.deviceW;
            canvas.height = saved.deviceH;
            state.dpr = saved.dpr;
            state.width = saved.width;
            state.height = saved.height;
            state.cx = saved.cx;
            state.cy = saved.cy;
            renderWorldSync();
            state.exporting = false;
            updateUi();
          }
        };
```

Guard at the top (before `state.exporting = true`): `if (!exportPresets[presetName]) return;` — mirror the base function's early returns and status copy exactly (they are quoted above from the base implementation).

Note `renderWorldSync` culls by `viewCssWidth() = state.width / state.dpr`, so with `state.width = preset.width` and `dpr = fit` the export viewport covers *at least* the on-screen view (letterbox area shows more world instead of black bars — an upgrade over the old raster letterboxing).

- [ ] **Step 4: Run spec + export regression**

Run: `npx playwright test tests/infinite-zoom.spec.js tests/vector-export.spec.js tests/render-qa.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/index.html tests/infinite-zoom.spec.js
git commit -m "feat(desktop): exports re-render through the replay path at target resolution"
```

---

### Task 7: Desktop — tutorial copy, full desktop verification

**Files:**
- Modify: `app/index.html` (tutorial copy), `docs/superpowers/specs/2026-07-02-infinite-zoom-canvas-design.md` (shortcut amendment)
- Test: full suite run

**Interfaces:** none new.

- [ ] **Step 1: Update tutorial copy**

In the `tutorialSteps` array (anchor: `title: "Draw on the canvas"`), append to that step's `copy` string: ` Scroll or pinch to zoom — the canvas is infinite; press H (or hold Space) to pan with the hand tool.` Apply the same sentence to the static fallback paragraph `<p class="tutorial-copy" id="tutorialCopy">`.

- [ ] **Step 2: Amend the spec for the shortcut deviation**

In the spec's hand-tool paragraph, replace "`B`/`Esc` returns to the brush" with "`Esc` returns to the brush (`B` stays blend-toggle)".

- [ ] **Step 3: Full desktop verification**

Run: `npx playwright test tests/infinite-zoom.spec.js tests/vector-export.spec.js tests/render-qa.spec.js tests/brush-density.spec.js tests/silk-feel.spec.js tests/tutorial.spec.js tests/panel-drag.spec.js`
Expected: ALL PASS, zero console errors in infinite-zoom spec.

Manual smoke (report results): open `app/index.html` via Playwright screenshot at desktop width — draw, wheel-zoom in ×20, draw fine detail, zoom out, screenshot; confirm both scales visible and crisp.

- [ ] **Step 4: Commit**

```bash
git add app/index.html docs/superpowers/specs/2026-07-02-infinite-zoom-canvas-design.md
git commit -m "feat(desktop): infinite-zoom tutorial copy and spec shortcut amendment"
```

---

### Task 8: Mobile — view model and two-finger pan/pinch navigation

**Files:**
- Modify: `app/mobile/index.html`
- Test: `tests/infinite-zoom.spec.js` (extend with mobile section)

**Interfaces:**
- Consumes: mobile engine internals — `state`, `canvas`, `ctx`, `stage` (verify the actual stage/canvas ids in the file: grep `getElementById`), `startPainting`/`continuePainting`/`stopPainting`, `resize`, `clearSurface`, `makeSnapshot`.
- Produces (mobile file):
  - `state.view = {x, y, scale}`, `state.zoom/panX/panY` preview fields, `state.gesturing`.
  - `screenToWorld`/`worldToScreen`/`viewCssWidth`/`viewCssHeight`, `applyViewPreview()` (CSS transform), `commitViewPreview()`, `rebuildView` let-binding (soft raster carry v1), zoom readout chip `#zoomChip` (shows `×N`, tap to reset, hidden at ×1).
  - Two-finger gesture: `beginGestureIfNeeded`/`updateGesture`/`endGesturePointer` adapted from desktop (unclamped).
  - `window.__fractal = { state, previewZoomAt, commitViewPreview, resetView }` hook.

The mobile app has **no** existing pan/zoom — this is new code modeled directly on the desktop implementation from Tasks 1 (which, by now, exists in `app/index.html` as a concrete reference). The gesture trio is a near-verbatim copy of desktop's `beginGestureIfNeeded`/`updateGesture`/`endGesturePointer` with the desktop-only pieces (symmetry guide, hold bloom) replaced by the mobile equivalents (check `startPainting` in the mobile file for its `holdTimer` and clear it when a gesture starts).

- [ ] **Step 1: Write the failing tests** (append a mobile describe-block to `tests/infinite-zoom.spec.js`):

```js
const mobileUrl = pathToFileURL(path.resolve(__dirname, "../app/mobile/index.html")).toString();

test.describe("mobile infinite zoom", () => {
  async function setupMobile(page) {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.setViewportSize({ width: 390, height: 720 });
    await page.goto(mobileUrl);
    return errors;
  }

  test("two-finger pinch zooms the view unbounded", async ({ page }) => {
    const errors = await setupMobile(page);
    await page.evaluate(() => {
      window.__fractal.previewZoomAt(195, 360, 30);
      window.__fractal.commitViewPreview();
    });
    const scale = await page.evaluate(() => window.__fractal.state.view.scale);
    expect(scale).toBeCloseTo(30, 3);
    await expect(page.locator("#zoomChip")).toBeVisible();
    await page.locator("#zoomChip").tap();
    expect(await page.evaluate(() => window.__fractal.state.view.scale)).toBe(1);
    expect(errors).toEqual([]);
  });
});
```

(Direct two-pointer dispatch is flaky in Playwright; the gesture handlers are exercised by the shared-code path and the existing `tests/mobile-app.spec.js` interaction coverage. `previewZoomAt` + `commitViewPreview` covers the math; add a two-`dispatchEvent`-pointer gesture test only if it proves stable.)

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js -g "mobile"`
Expected: FAIL (`__fractal` undefined on mobile page).

- [ ] **Step 3: Implement in `app/mobile/index.html`**

3a. `state` literal (anchor: `expansion: 0.85,` in the mobile state object): add

```js
        view: { x: 0, y: 0, scale: 1 },
        zoom: 1,
        panX: 0,
        panY: 0,
        gesturing: false,
```

3b. Markup: after the canvas element, add the zoom chip; CSS in the mobile style block:

```html
    <button id="zoomChip" type="button" hidden aria-label="Reset zoom">×1.0</button>
```

Add `zoomChip: document.getElementById("zoomChip"),` to the mobile `ui` map (anchor: `expansionRange: document.getElementById("expansionRange"),`).

```css
    #zoomChip {
      position: fixed;
      top: calc(env(safe-area-inset-top, 0px) + 10px);
      left: 50%;
      transform: translateX(-50%);
      z-index: 30;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(10, 14, 22, 0.72);
      color: #dfe8ff;
      font: 600 12px/1.4 system-ui, sans-serif;
    }
```

3c. Add the view-model + gesture section before the pointer listeners are attached (mirror desktop Task 1's `screenToWorld`/`worldToScreen`/`commitViewPreview`/`previewZoomAt`/soft `rebuildView`, plus desktop's gesture trio adapted: on gesture start also `clearHoldBloom()` — the mobile hold timer — and set `state.painting = false`). The canvas CSS preview transform: the mobile canvas is statically positioned — set `canvas.style.transformOrigin = "50% 50%"` and `canvas.style.transform = \`translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})\`` in `applyViewPreview()`; commit math is then `view.x -= panX / nextScale` with the *scale-then-translate note*: with `translate(...) scale(...)` order the screen mapping is `s' = center + (s - center) * z + p` (same as desktop's left/top variant), so the commit formula is identical to desktop's. Wire `zoomChip`:

```js
      function updateZoomChip() {
        const total = state.view.scale * (state.zoom || 1);
        ui.zoomChip.hidden = Math.abs(total - 1) < 0.001;
        ui.zoomChip.textContent = total >= 100 ? `×${Math.round(total)}`
          : total >= 10 ? `×${total.toFixed(1)}` : `×${total.toFixed(2)}`;
      }
```

Call `updateZoomChip()` from `applyViewPreview()` and `commitViewPreview()`; `zoomChip` click → `resetView()`.

Also verify the stage/canvas element has `touch-action: none` in CSS (grep `touch-action` in the mobile file; the brush strip uses `pan-x` — the drawing surface must be `none`). Add it if missing.

3d. Expose `window.__fractal = { state, previewZoomAt, commitViewPreview, resetView };`

- [ ] **Step 4: Run mobile spec + regression**

Run: `npx playwright test tests/infinite-zoom.spec.js -g "mobile" tests/mobile-app.spec.js tests/mobile-brushes.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/mobile/index.html tests/infinite-zoom.spec.js
git commit -m "feat(mobile): infinite view model with unbounded pinch/pan navigation"
```

---

### Task 9: Mobile — deterministic recording, replay, history, export

**Files:**
- Modify: `app/mobile/index.html`
- Test: `tests/infinite-zoom.spec.js` (extend mobile block)

**Interfaces:**
- Consumes: mobile `spawnFan`/`spawnAlong`/`branchFrom`/`advanceFrame`/`frame`/`wakeLoop`, `startPainting`/`stopPainting`, `undo`/`redo`/`clearArt`/`pushHistory`, `exportPng`, Task 8's view model.
- Produces: mobile equivalents of desktop Tasks 3–6: `state.strokeLog/liveStroke/undoStack/redoStack`, `mulberry32`, `stepTendrils(list)`, recording wrappers, `replayStroke`, `renderWorldSync`, chunked `scheduleRebuild`/`flushRenderJob` + `#viewPreview` overlay, stroke-log `undo`/`redo`/`clearArt`, export via `renderWorldSync` (mobile export is current-view only — keep it; just `flushRenderJob()` first). `window.__fractal` extended with `renderWorldSync`, `flushRenderJob`.

This task ports desktop Tasks 3–6 into the mobile engine. The desktop implementations in `app/index.html` are the reference; the mobile engine is simpler (single unpatched spawn functions, one export). **Critical differences to verify while implementing:**

1. **The frame loop:** mobile uses `advanceFrame()`/`frame()`/`wakeLoop()` (on-demand rAF that sleeps when no tendrils). Read `advanceFrame` first: if it advances simulation by wall-clock delta (dt-scaled), replay must use the same fixed quantum — normalize by treating one `advanceFrame` call as one step and removing any dt scaling from tendril physics *if present*; if it is already per-frame like desktop (most likely — it was derived from the same engine), simply refactor its per-tendril loop into `stepTendrils(list)` exactly as desktop Task 3 did to `step()`.
2. **Step counting for recording:** increment `state.liveStroke.stepCount` once per `advanceFrame` invocation (same position as desktop's `infiniteStep`).
3. **Hold bloom:** mobile `startPainting` sets `state.holdTimer` calling `spawnFan` directly — the `spawnFan` recording wrapper (fan segments) covers it, same as desktop.
4. **Symmetry center:** mobile `rotateAroundCenter` uses `state.cx/cy` like desktop; `replayStroke` sets them to `stroke.viewW/2, stroke.viewH/2` identically.
5. **Custom brush:** mobile also has `brushProfiles.custom` + tuning sheet — snapshot it into strokes exactly like desktop.
6. **History:** mobile `pushHistory`/`undo`/`redo`/`clearArt` are raster-based (anchor: `function pushHistory()` ~line 1096) — replace bodies with the stroke-log versions from desktop Task 5 (mobile has no `showStatus`; it has `showToast` — use that).
7. **Export:** mobile `exportPng` exports the current canvas — prepend `flushRenderJob(); commitLiveStroke();` and leave the rest.

- [ ] **Step 1: Write the failing tests** (append inside the mobile describe-block; reuse a touch-pointer draw helper):

```js
  async function drawMobileStroke(page, y = 400) {
    const stage = page.locator("#stage"); // verify actual selector in mobile file
    await stage.dispatchEvent("pointerdown", { clientX: 80, clientY: y, pointerId: 3, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, bubbles: true });
    for (let x = 120; x <= 320; x += 40) {
      await stage.dispatchEvent("pointermove", { clientX: x, clientY: y, pointerId: 3, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, bubbles: true });
      await page.waitForTimeout(30);
    }
    await stage.dispatchEvent("pointerup", { clientX: 320, clientY: y, pointerId: 3, pointerType: "touch", isPrimary: true, button: 0, buttons: 0, bubbles: true });
  }

  test("mobile strokes are recorded, survive zoom, and replay deterministically", async ({ page }) => {
    const errors = await setupMobile(page);
    await drawMobileStroke(page);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__fractal.state.strokeLog.length)).toBe(1);
    const [a, b] = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      window.__fractal.renderWorldSync();
      const first = canvas.toDataURL();
      window.__fractal.renderWorldSync();
      return [first, canvas.toDataURL()];
    });
    expect(a).toBe(b);
    await page.evaluate(() => {
      window.__fractal.previewZoomAt(195, 360, 6);
      window.__fractal.commitViewPreview();
      window.__fractal.flushRenderJob();
    });
    const lit = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 60) count += 1;
      }
      return count;
    });
    expect(lit).toBeGreaterThan(200);
    expect(errors).toEqual([]);
  });

  test("mobile undo/clear use the stroke log", async ({ page }) => {
    await setupMobile(page);
    await drawMobileStroke(page, 380);
    await page.waitForTimeout(400);
    await drawMobileStroke(page, 300);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__fractal.state.strokeLog.length)).toBe(2);
    await page.evaluate(() => window.__fractal.state); // verify undo control id in mobile UI
    await page.locator("#undo").click(); // verify actual undo button id in the mobile dock
    expect(await page.evaluate(() => window.__fractal.state.strokeLog.length)).toBe(1);
  });
```

(**Verify the selectors** — mobile stage/canvas/undo ids differ; grep the mobile file's `getElementById` calls and fix the test selectors before first run.)

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/infinite-zoom.spec.js -g "mobile"`
Expected: new tests FAIL.

- [ ] **Step 3: Implement** — port desktop Tasks 3–6 code into the mobile file per the differences list above. All code shapes (wrappers, `stepTendrils`, `replayStroke`, `renderWorldSync`, chunked pump, preview overlay, history, export flush) are identical to the desktop implementations now present in `app/index.html`; copy them and adapt names/UI hooks (`showToast`, zoom chip, mobile dock buttons). Respect mobile perf budgets: `RENDER_BUDGET_MS = 6` on mobile.

- [ ] **Step 4: Run mobile + full regression**

Run: `npx playwright test tests/infinite-zoom.spec.js tests/mobile-app.spec.js tests/mobile-brushes.spec.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/mobile/index.html tests/infinite-zoom.spec.js
git commit -m "feat(mobile): deterministic stroke replay, infinite zoom rebuild, stroke-log history"
```

---

### Task 10: Full verification, docs, and wrap-up

**Files:**
- Modify: `README.md` (feature blurb), `AGENTS.md` (verification note)
- Test: entire suite

- [ ] **Step 1: Full suite**

Run: `npx playwright test tests/`
Expected: ALL suites PASS. Fix any stragglers (app bugs, not test weakening).

- [ ] **Step 2: Visual QA screenshots**

Using Playwright: desktop — draw at ×1, zoom ×20, draw, zoom out ×0.5, screenshot to `output/playwright/infinite-zoom-desktop.png`. Mobile — same flow via `previewZoomAt`, screenshot to `output/playwright/infinite-zoom-mobile.png`. Inspect both: strokes crisp at both scales, no console errors, UI panels intact.

- [ ] **Step 3: Docs**

- `README.md`: add a feature bullet: infinite canvas — scroll/pinch to zoom without limit, hand tool (H/Space) to pan, strokes re-render crisp at any scale, unlimited undo.
- `AGENTS.md` Verification section: add "Confirm infinite zoom: draw → zoom → draw → zoom out keeps both strokes crisp (`tests/infinite-zoom.spec.js`)."

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md output/playwright/infinite-zoom-desktop.png output/playwright/infinite-zoom-mobile.png
git commit -m "docs: infinite zoom canvas feature notes and QA screenshots"
```
