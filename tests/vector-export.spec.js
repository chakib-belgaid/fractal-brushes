const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();

async function drawStroke(page) {
  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 190,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });
  for (let x = 250; x <= 610; x += 60) {
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
    clientX: 610,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });
}

test("drawing stays canvas-backed and can export PNG", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");

    let seed = 24791;
    Math.random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreateObjectURL(blob);
      if (blob.type === "image/png") {
        window.__lastPngExport = { type: blob.type, size: blob.size };
      }
      return url;
    };

    HTMLAnchorElement.prototype.click = function patchedClick() {
      window.__lastDownloadName = this.download;
    };
  });

  await page.setViewportSize({ width: 960, height: 720 });
  await page.goto(appUrl);

  await expect(page.locator("#art")).toHaveJSProperty("tagName", "CANVAS");

  await drawStroke(page);
  await page.waitForTimeout(450);
  await expect.poll(() => page.locator("[data-vector-mark]").count()).toBe(0);

  await page.locator("#exportToggle").click();
  await page.locator("[data-export='current']").click();

  await expect.poll(() => page.evaluate(() => window.__lastPngExport?.type)).toBe("image/png");
  await expect.poll(() => page.evaluate(() => window.__lastDownloadName)).toMatch(/\.png$/);
  await expect.poll(() => page.evaluate(() => window.__lastPngExport?.size ?? 0)).toBeGreaterThan(1000);
});
