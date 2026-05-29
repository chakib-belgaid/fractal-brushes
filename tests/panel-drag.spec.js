const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();

test("mouse can drag panels on touch-capable desktop devices", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
      configurable: true,
      get: () => 5
    });
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(appUrl);

  await expect(page.locator("#paramsPanel")).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.maxTouchPoints)).toBe(5);

  const handle = page.locator("#paramsPanel [data-drag-handle]");
  const before = await page.locator("#paramsPanel").boundingBox();
  const handleBox = await handle.boundingBox();
  expect(before).not.toBeNull();
  expect(handleBox).not.toBeNull();

  await page.mouse.move(handleBox.x + 36, handleBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 116, handleBox.y + 78);
  await page.mouse.up();

  const after = await page.locator("#paramsPanel").boundingBox();
  expect(after).not.toBeNull();
  expect(after.x).toBeGreaterThan(before.x + 40);
});
