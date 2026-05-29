const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();

async function preparePage(page) {
  await page.addInitScript(() => {
    let seed = 24791;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const originalStroke = CanvasRenderingContext2D.prototype.stroke;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
    const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;

    CanvasRenderingContext2D.prototype.moveTo = function patchedMoveTo(x, y, ...args) {
      this.__brushPathLength = this.__brushPathLength || 0;
      this.__brushLastPoint = [x, y];
      return originalMoveTo.call(this, x, y, ...args);
    };
    CanvasRenderingContext2D.prototype.lineTo = function patchedLineTo(x, y, ...args) {
      const previous = this.__brushLastPoint;
      if (previous) {
        this.__brushPathLength = (this.__brushPathLength || 0) + Math.hypot(x - previous[0], y - previous[1]);
      }
      this.__brushLastPoint = [x, y];
      return originalLineTo.call(this, x, y, ...args);
    };
    CanvasRenderingContext2D.prototype.stroke = function patchedStroke(...args) {
      window.__brushDrawCalls = (window.__brushDrawCalls || 0) + 1;
      if (this.__brushPathLength > 0) {
        window.__brushStrokeMetrics = window.__brushStrokeMetrics || [];
        window.__brushStrokeMetrics.push({
          length: this.__brushPathLength,
          width: this.lineWidth
        });
      }
      this.__brushPathLength = 0;
      this.__brushLastPoint = null;
      return originalStroke.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fill = function patchedFill(...args) {
      window.__brushDrawCalls = (window.__brushDrawCalls || 0) + 1;
      return originalFill.apply(this, args);
    };
  });

  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto(appUrl);
}

async function drawLengthSample(page, length) {
  await page.locator("#size").evaluate((input, nextLength) => {
    input.value = String(nextLength);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, length);
  await expect(page.locator("#sizeValue")).toHaveText(String(length));
  await page.evaluate(() => {
    window.__brushDrawCalls = 0;
    window.__brushStrokeMetrics = [];
  });

  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 180,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });
  for (const [clientX, clientY] of [[240, 300], [330, 390], [450, 285], [590, 370], [720, 305], [840, 360]]) {
    await page.locator("#stage").dispatchEvent("pointermove", {
      clientX,
      clientY,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      bubbles: true
    });
  }
  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 840,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });
  await page.waitForTimeout(900);

  return page.evaluate(() => {
    const metrics = window.__brushStrokeMetrics || [];
    const totalLength = metrics.reduce((sum, stroke) => sum + stroke.length, 0);
    const averageWidth = metrics.length
      ? metrics.reduce((sum, stroke) => sum + stroke.width, 0) / metrics.length
      : 0;
    return { averageWidth, drawCalls: window.__brushDrawCalls || 0, totalLength };
  });
}

test("brush length control exposes a broad silk-style range", async ({ page }) => {
  await preparePage(page);

  await expect(page.locator(".params-panel .field-label").filter({ hasText: "Brush length" })).toHaveCount(1);
  await expect(page.locator("#size")).toHaveAttribute("aria-label", "Brush length");
  await expect.poll(async () => Number(await page.locator("#size").getAttribute("max"))).toBeGreaterThanOrEqual(64);

  await page.locator("#size").evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("#sizeValue")).toHaveText("64");
});

test("luminous app opens with a silk ribbon brush and longer default length", async ({ page }) => {
  await preparePage(page);

  await expect(page.locator("[data-brush='silk']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sizeValue")).toHaveText("16");
});

test("brush length scales stroke travel more than stroke width", async ({ page }) => {
  await preparePage(page);

  const shortBrush = await drawLengthSample(page, 8);
  await page.locator("#clear").click();
  const longBrush = await drawLengthSample(page, 64);

  expect(shortBrush.totalLength).toBeGreaterThan(0);
  expect(longBrush.totalLength).toBeGreaterThan(shortBrush.totalLength * 1.45);
  expect(longBrush.averageWidth).toBeGreaterThan(shortBrush.averageWidth);
  expect(longBrush.averageWidth / shortBrush.averageWidth).toBeLessThan(longBrush.totalLength / shortBrush.totalLength);
});

test("canvas keeps extra backing resolution for zoom quality", async ({ page }) => {
  await preparePage(page);

  const ratio = await page.locator("#art").evaluate((canvas) => {
    const bounds = canvas.getBoundingClientRect();
    return canvas.width / Math.max(1, bounds.width);
  });

  expect(ratio).toBeGreaterThanOrEqual(1.5);
});

test("pressing and holding blooms marks without pointer movement", async ({ page }) => {
  await preparePage(page);

  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 480,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });

  await page.waitForTimeout(360);

  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 480,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });

  await expect.poll(() => page.evaluate(() => window.__brushDrawCalls || 0)).toBeGreaterThan(0);
});

test("silk stroke does not create live SVG DOM nodes", async ({ page }) => {
  await preparePage(page);

  await expect(page.locator("#art")).toHaveJSProperty("tagName", "CANVAS");

  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 180,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });

  const points = [
    [240, 300],
    [330, 390],
    [450, 285],
    [590, 370],
    [720, 305],
    [840, 360]
  ];

  for (const [clientX, clientY] of points) {
    await page.locator("#stage").dispatchEvent("pointermove", {
      clientX,
      clientY,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      bubbles: true
    });
  }

  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 840,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });
  await page.waitForTimeout(750);

  const marks = await page.locator("[data-vector-mark]").count();
  expect(marks).toBe(0);
  const drawCalls = await page.evaluate(() => window.__brushDrawCalls || 0);
  expect(drawCalls).toBeGreaterThan(0);
  expect(drawCalls).toBeLessThanOrEqual(12000);
});
