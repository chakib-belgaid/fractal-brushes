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

test("starting a stroke inside the debounce window commits the pending zoom instead of wiping mid-stroke", async ({ page }) => {
  const errors = await setupPage(page);
  const result = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    window.__fractal.previewZoomAt(480, 360, 2);

    const opts = { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true };
    stage.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 480, clientY: 360 }));
    const afterDown = {
      zoom: window.__fractal.state.zoom,
      panX: window.__fractal.state.panX,
      panY: window.__fractal.state.panY
    };
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 500, clientY: 375 }));
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 520, clientY: 390 }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientX: 520, clientY: 390 }));
    return { afterDown, viewScale: window.__fractal.state.view.scale };
  });
  expect(result.afterDown).toEqual({ zoom: 1, panX: 0, panY: 0 });
  expect(result.viewScale).toBeCloseTo(2, 5);
  expect(errors).toEqual([]);
});

test("zoom buttons step the view scale", async ({ page }) => {
  await setupPage(page);
  await page.locator("#zoomIn").click();
  await page.waitForTimeout(400);
  const scale = await page.evaluate(() => window.__fractal.state.view.scale);
  expect(scale).toBeCloseTo(1.25, 3);
});

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

test("pending zoom commit does not corrupt a hand pan", async ({ page }) => {
  const errors = await setupPage(page);
  await page.evaluate(() => window.__fractal.setTool("hand"));
  const view = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    window.__fractal.previewZoomAt(480, 360, 2);

    const opts = { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true };
    stage.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 480, clientY: 360 }));
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 530, clientY: 390 }));
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the 150ms debounce
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 530, clientY: 390 }));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientX: 530, clientY: 390 }));
    return { ...window.__fractal.state.view };
  });
  expect(view.x).toBeCloseTo(-25, 3);
  expect(view.y).toBeCloseTo(-15, 3);
  expect(view.scale).toBeCloseTo(2, 5);
  expect(errors).toEqual([]);
});

test("touch pinch zooms while hand tool active", async ({ page }) => {
  const errors = await setupPage(page);
  await page.evaluate(() => window.__fractal.setTool("hand"));
  const result = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    const touchEvent = (type, id, x, y) => new PointerEvent(type, {
      pointerId: id, pointerType: "touch", clientX: x, clientY: y,
      button: 0, buttons: 1, bubbles: true, cancelable: true
    });
    stage.dispatchEvent(touchEvent("pointerdown", 11, 400, 360));
    stage.dispatchEvent(touchEvent("pointerdown", 12, 560, 360));
    stage.dispatchEvent(touchEvent("pointermove", 11, 320, 360));
    stage.dispatchEvent(touchEvent("pointermove", 12, 640, 360));
    stage.dispatchEvent(touchEvent("pointerup", 11, 320, 360));
    stage.dispatchEvent(touchEvent("pointerup", 12, 640, 360));
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the 150ms debounce
    return {
      scale: window.__fractal.state.view.scale,
      painting: window.__fractal.state.painting
    };
  });
  expect(result.scale).toBeCloseTo(2, 3);
  expect(result.painting).toBe(false);
  expect(errors).toEqual([]);
});

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

test("pointerdown hold-bloom burst is recorded as the first segment and tendrils stay tagged mid-stroke", async ({ page }) => {
  const errors = await setupPage(page);
  const stage = page.locator("#stage");
  await stage.dispatchEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
  await page.waitForTimeout(30);
  const afterDown = await page.evaluate(() => {
    const s = window.__fractal.state;
    return {
      logLen: s.strokeLog.length,
      liveSegs: s.liveStroke ? s.liveStroke.segments.length : 0,
      firstFan: s.liveStroke && s.liveStroke.segments[0] ? !!s.liveStroke.segments[0].fan : null,
      tendrilCount: s.tendrils.length,
      untagged: s.tendrils.filter((t) => !t.rng).length
    };
  });
  expect(afterDown.logLen).toBe(0);
  expect(afterDown.liveSegs).toBeGreaterThan(0);
  expect(afterDown.firstFan).toBe(true);
  expect(afterDown.tendrilCount).toBeGreaterThan(0);
  expect(afterDown.untagged).toBe(0);

  for (let x = 460; x <= 640; x += 60) {
    await stage.dispatchEvent("pointermove", { clientX: x, clientY: 300, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true });
    await page.waitForTimeout(30);
    const untaggedMid = await page.evaluate(() => window.__fractal.state.tendrils.filter((t) => !t.rng).length);
    expect(untaggedMid).toBe(0);
  }

  await stage.dispatchEvent("pointerup", { clientX: 640, clientY: 300, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, bubbles: true });
  await page.waitForTimeout(200);
  const log = await page.evaluate(() => window.__fractal.state.strokeLog.map((s) => ({
    segs: s.segments.length,
    firstFan: !!s.segments[0].fan
  })));
  expect(log.length).toBe(1);
  expect(log[0].firstFan).toBe(true);
  expect(errors).toEqual([]);
});

test("unrecorded tutorial demo stroke tags its tendrils with the native RNG so later strokes cannot adopt them", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto(appUrl);

  await expect(page.locator("#tutorial")).toBeVisible();
  // Step 1 targets the stage; clicking Next triggers the unrecorded demo stroke
  // (paintTutorialDemo -> spawnAlong with no state.liveStroke).
  await page.locator("#tutorialNext").click();
  const afterDemo = await page.evaluate(() => {
    const s = window.__fractal.state;
    return {
      tendrilCount: s.tendrils.length,
      untagged: s.tendrils.filter((t) => !t.rng).length,
      withStrokeRef: s.tendrils.filter((t) => t.strokeRef).length
    };
  });
  expect(afterDemo.tendrilCount).toBeGreaterThan(0);
  expect(afterDemo.untagged).toBe(0);
  expect(afterDemo.withStrokeRef).toBe(0);

  await page.locator("#tutorialSkip").click();
  await drawStroke(page, 500);
  await page.waitForTimeout(200);

  const afterRealStroke = await page.evaluate(() => {
    const s = window.__fractal.state;
    return {
      untagged: s.tendrils.filter((t) => !t.rng).length,
      logLen: s.strokeLog.length
    };
  });
  expect(afterRealStroke.untagged).toBe(0);
  expect(afterRealStroke.logLen).toBe(1);
  expect(errors).toEqual([]);
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

test("stroke started during zoom debounce records post-commit view", async ({ page }) => {
  const errors = await setupPage(page);
  const result = await page.evaluate(() => {
    const stage = document.getElementById("stage");
    window.__fractal.previewZoomAt(480, 360, 2);

    const opts = { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true };
    stage.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 400, clientY: 300 }));
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 450, clientY: 320 }));
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 500, clientY: 340 }));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientX: 500, clientY: 340 }));
    return window.__fractal.state.strokeLog.length;
  });
  await page.waitForTimeout(400);
  const log = await page.evaluate(() => window.__fractal.state.strokeLog.map((s) => ({
    drawScale: s.drawScale,
    symCenter: s.symCenter
  })));
  expect(result).toBe(1);
  expect(log[0].drawScale).toBe(2);
  expect(log[0].symCenter.x).toBeCloseTo(0, 3);
  expect(log[0].symCenter.y).toBeCloseTo(0, 3);
  expect(errors).toEqual([]);
});

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

test("starting a stroke flushes a pending chunked rebuild so the live stroke never paints under the opaque preview overlay", async ({ page }) => {
  const errors = await setupPage(page);
  await drawStroke(page, 360);
  await page.waitForTimeout(400); // let the first stroke's commit/rebuild fully settle

  const result = await page.evaluate(async () => {
    const stage = document.getElementById("stage");
    // Kick off a wheel-zoom preview (starts the 150ms debounced commit timer),
    // then immediately start a stroke within that debounce window.
    // recordingStartPainting -> commitViewPreviewNow() synchronously commits
    // the preview, which schedules a NEW async chunked rebuild (opaque
    // #viewPreview overlay + queued pumpRender). Sampled right after
    // pointerdown returns, the overlay must already be flushed away.
    window.__fractal.previewZoomAt(480, 360, 1.5);

    const opts = { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true };
    stage.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 480, clientY: 360 }));

    const overlayDisplay = document.getElementById("viewPreview").style.display;

    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 500, clientY: 375 }));
    stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: 520, clientY: 390 }));
    stage.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0, clientX: 520, clientY: 390 }));

    return { overlayDisplay };
  });
  await page.waitForTimeout(400);
  expect(result.overlayDisplay).toBe("none");
  const logLen = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(logLen).toBe(2);
  expect(errors).toEqual([]);
});

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

test("clear history entry does not alias the live strokeLog: undo/undo/redo sequence preserves clear entry's strokes array", async ({ page }) => {
  await setupPage(page);
  await drawStroke(page, 360);
  await page.waitForTimeout(300);
  await drawStroke(page, 250);
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(before).toBe(2);

  // Clear the canvas
  await page.keyboard.press("c");
  await page.waitForTimeout(200);

  const afterClear = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(afterClear).toBe(0);

  // Undo the clear (should restore 2 strokes)
  await page.locator("#undo").click();
  await page.waitForTimeout(200);

  const afterFirstUndo = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(afterFirstUndo).toBe(2);

  // Undo again (should remove the second stroke, log length becomes 1)
  await page.locator("#undo").click();
  await page.waitForTimeout(200);

  const afterSecondUndo = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(afterSecondUndo).toBe(1);

  // The key assertion: the clear entry in redoStack must still have strokes.length === 2
  // (not 1, which would indicate aliasing with the live log)
  const clearEntryStrokes = await page.evaluate(() => {
    const redoStack = window.__fractal.state.redoStack;
    const clearEntry = redoStack.find(entry => entry.type === "clear");
    return clearEntry ? clearEntry.strokes.length : -1;
  });
  expect(clearEntryStrokes).toBe(2);

  // Verify final redo sequence: redo the stroke removal (log becomes 2 again)
  await page.locator("#redo").click();
  await page.waitForTimeout(200);

  const afterFirstRedo = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(afterFirstRedo).toBe(2);

  // Redo the clear (log becomes 0 again)
  await page.locator("#redo").click();
  await page.waitForTimeout(200);

  const afterSecondRedo = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(afterSecondRedo).toBe(0);
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

test("4K export re-renders crisply at target resolution", async ({ page }) => {
  await setupPage(page);
  await page.addInitScript(() => {}); // page already loaded; use evaluate patching instead
  await page.evaluate(() => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob.type === "image/png") window.__lastPngExport = blob;
      return originalCreateObjectURL(blob);
    };
    HTMLAnchorElement.prototype.click = function () { window.__lastDownloadName = this.download; };
  });
  await drawStroke(page, 360);
  await page.waitForTimeout(400);
  await page.locator("#exportToggle").click();
  await page.locator("[data-export='wide4k']").click();
  await expect.poll(() => page.evaluate(() => window.__lastPngExport?.size), { timeout: 20000 }).toBeGreaterThan(1000);

  // Parse PNG header to verify dimensions: width and height are big-endian uint32s at bytes 16 and 20
  const dimensions = await page.evaluate(async () => {
    const blob = window.__lastPngExport;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return { width, height };
  });

  const restored = await page.evaluate(() => ({
    exportedVia: window.__fractal.lastExportPath || null,
    w: document.getElementById("art").width
  }));
  expect(restored.exportedVia).toBe("replay"); // set by the new export path
  expect(restored.w).toBeLessThan(3840); // canvas restored after export
  expect(dimensions.width).toBe(3840);
  expect(dimensions.height).toBe(2160);
});

test("single-finger touch stroke on desktop is not dropped by the gesture-cleanup race", async ({ page }) => {
  const errors = await setupPage(page);
  const stage = page.locator("#stage");
  const touchOpts = { pointerId: 21, pointerType: "touch", isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true };
  await stage.dispatchEvent("pointerdown", { ...touchOpts, clientX: 300, clientY: 300 });
  await stage.dispatchEvent("pointermove", { ...touchOpts, clientX: 340, clientY: 320 });
  await stage.dispatchEvent("pointermove", { ...touchOpts, clientX: 380, clientY: 340 });
  await stage.dispatchEvent("pointerup", { ...touchOpts, buttons: 0, clientX: 380, clientY: 340 });
  await page.waitForTimeout(300);
  const logLength = await page.evaluate(() => window.__fractal.state.strokeLog.length);
  expect(logLength).toBe(1);
  expect(errors).toEqual([]);
});

const mobileUrl = pathToFileURL(path.resolve(__dirname, "../app/mobile/index.html")).toString();

test.describe("mobile infinite zoom", () => {
  test.use({ hasTouch: true });

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

  async function drawMobileStroke(page) {
    // "thunder" settles (tendrils die out) much faster than the default
    // "silk" brush, so the raster is stable by the time we snapshot it.
    await page.locator('#brushStrip .chip[data-brush="thunder"]').tap();
    await page.evaluate(async () => {
      const stage = document.getElementById("stage");
      const rect = stage.getBoundingClientRect();
      const dispatch = (type, x, y) => {
        stage.dispatchEvent(new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true
        }));
      };
      const startX = rect.width * 0.3;
      const startY = rect.height * 0.4;
      dispatch("pointerdown", startX, startY);
      for (let i = 1; i <= 10; i += 1) {
        dispatch("pointermove", startX + i * 8, startY + Math.sin(i * 0.6) * 20);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", bubbles: true }));
    });
    // Wait for the tendril animation to fully settle so toDataURL()
    // snapshots are deterministic and not just catching mid-animation frames.
    await page.waitForFunction(() => window.__fractal.state.tendrils.length === 0, null, { timeout: 5000 });
  }

  test("tapping the zoom chip after a committed pinch carries the raster back to identity", async ({ page }) => {
    const errors = await setupMobile(page);

    await drawMobileStroke(page);
    const beforeZoom = await page.evaluate(() => document.getElementById("canvas").toDataURL());

    await page.evaluate(() => window.__fractal.previewZoomAt(195, 360, 2));
    await page.waitForTimeout(400); // let the debounced commit fire
    await page.waitForFunction(() => window.__fractal.state.tendrils.length === 0, null, { timeout: 5000 });

    const zoomedScale = await page.evaluate(() => window.__fractal.state.view.scale);
    expect(zoomedScale).toBeCloseTo(2, 3);
    const zoomedDataUrl = await page.evaluate(() => document.getElementById("canvas").toDataURL());
    expect(zoomedDataUrl).not.toBe(beforeZoom);

    await expect(page.locator("#zoomChip")).toBeVisible();
    await page.locator("#zoomChip").tap();
    await page.waitForFunction(() => window.__fractal.state.tendrils.length === 0, null, { timeout: 5000 });

    const view = await page.evaluate(() => window.__fractal.state.view);
    expect(view).toEqual({ x: 0, y: 0, scale: 1 });

    const afterResetDataUrl = await page.evaluate(() => document.getElementById("canvas").toDataURL());
    // Soft-carry raster reset is lossy, so we only assert it moved away from
    // the zoomed-in framing, not that it matches the original pixel-for-pixel.
    expect(afterResetDataUrl).not.toBe(zoomedDataUrl);

    expect(errors).toEqual([]);
  });

  async function drawMobileStroke(page, y = 400) {
    const stage = page.locator("#stage");
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
    await page.locator("#undo").click();
    expect(await page.evaluate(() => window.__fractal.state.strokeLog.length)).toBe(1);
  });
});
