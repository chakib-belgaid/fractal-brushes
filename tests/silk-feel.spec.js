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
    CanvasRenderingContext2D.prototype.stroke = function patchedStroke(...args) {
      window.__brushDrawCalls = (window.__brushDrawCalls || 0) + 1;
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

test("brush size control exposes a broad silk-style range", async ({ page }) => {
  await preparePage(page);

  await expect.poll(async () => Number(await page.locator("#size").getAttribute("max"))).toBeGreaterThanOrEqual(64);

  await page.locator("#size").evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("#sizeValue")).toHaveText("64");
});

test("luminous app opens with a silk ribbon brush and larger default size", async ({ page }) => {
  await preparePage(page);

  await expect(page.locator("[data-brush='silk']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sizeValue")).toHaveText("16");
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
