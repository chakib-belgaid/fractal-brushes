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
