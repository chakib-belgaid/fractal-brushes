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
