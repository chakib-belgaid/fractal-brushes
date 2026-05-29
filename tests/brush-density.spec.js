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
    CanvasRenderingContext2D.prototype.stroke = function patchedStroke(...args) {
      window.__brushStrokeCalls = (window.__brushStrokeCalls || 0) + 1;
      return originalStroke.apply(this, args);
    };
  });

  await page.setViewportSize({ width: 960, height: 720 });
}

async function drawMeasuredStroke(page, size) {
  await page.goto(appUrl);
  await page.locator("#size").evaluate((input, nextSize) => {
    input.value = String(nextSize);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, size);
  await expect(page.locator("#sizeValue")).toHaveText(String(size));
  await page.evaluate(() => {
    window.__brushStrokeCalls = 0;
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
  for (let x = 240; x <= 720; x += 60) {
    await page.locator("#stage").dispatchEvent("pointermove", {
      clientX: x,
      clientY: 360,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      bubbles: true
    });
  }
  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 720,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });
  await page.waitForTimeout(450);

  return page.evaluate(() => window.__brushStrokeCalls || 0);
}

test("maximum brush size does not emit a much denser stroke than the default size", async ({ page }) => {
  await preparePage(page);

  const defaultDensity = await drawMeasuredStroke(page, 7);
  const maximumDensity = await drawMeasuredStroke(page, 64);

  expect(defaultDensity).toBeGreaterThan(0);
  expect(maximumDensity).toBeLessThanOrEqual(Math.round(defaultDensity * 1.2));
});
