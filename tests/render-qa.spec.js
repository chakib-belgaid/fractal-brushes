const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const rootUrl = pathToFileURL(path.resolve(__dirname, "../index.html")).toString();
const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();
const screenshotDir = path.resolve(__dirname, "../test-results");
const desktopScreenshotPath = path.join(screenshotDir, "fractal-qa-desktop.png");
const mobileScreenshotPath = path.join(screenshotDir, "fractal-qa-mobile.png");

test.use({ acceptDownloads: true, viewport: { width: 960, height: 720 } });

test("root and app render without console errors on desktop and mobile", async ({ page }) => {
  const consoleIssues = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleIssues.push(`console ${msg.type()}: ${msg.text()}`);
  });
  page.on("pageerror", (error) => consoleIssues.push(`pageerror: ${error.message}`));

  await page.goto(rootUrl);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("a[href='./app/']").first()).toBeVisible();

  await page.goto(appUrl);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(150);
  await expect(page.locator("#size")).toHaveAttribute("min", "0.1");
  await expect(page.locator("#size")).toHaveAttribute("max", "6.4");
  await expect(page.locator("#size")).toHaveAttribute("step", "0.1");
  await expect(page.locator("#sizeValue")).toHaveText("5");
  await expect(page.locator("#scaleFactor")).toHaveAttribute("max", "15");
  await expect(page.locator("#scaleFactorValue")).toHaveText("30");

  await page.mouse.move(300, 340);
  await expect(page.locator("#symmetryGuide")).toBeVisible();
  await expect(page.locator(".symmetry-guide-dot")).toHaveCount(12);
  await expect(page.locator(".symmetry-guide-dot.origin")).toHaveCount(1);

  await page.mouse.down();
  await page.mouse.move(360, 300, { steps: 4 });
  await page.mouse.move(480, 390, { steps: 6 });
  await page.mouse.move(640, 320, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(450);
  await expect(page.locator("#symmetryGuide")).toBeHidden();

  const canvasBrightPixels = await page.evaluate(() => {
    const canvas = document.getElementById("art");
    const ctx = canvas.getContext("2d");
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = 0;
    for (let i = 0; i < image.length; i += 256) {
      const max = Math.max(image[i], image[i + 1], image[i + 2]);
      const min = Math.min(image[i], image[i + 1], image[i + 2]);
      if (image[i] + image[i + 1] + image[i + 2] > 150 && max - min > 18) bright += 1;
    }
    return bright;
  });
  expect(canvasBrightPixels).toBeGreaterThan(25);

  await page.locator("#exportToggle").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("[data-export='current']").click();
  const download = await downloadPromise;
  await expect(download.failure()).resolves.toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.png$/);

  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
  expect(fs.existsSync(desktopScreenshotPath)).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl);
  await page.waitForLoadState("domcontentloaded");
  await page.locator("#paramsToggle").click();
  await page.waitForTimeout(120);
  const mobileChecks = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const ids = ["paramsToggle", "brushToggle", "colorToggle", "size", "scaleFactor"];
    return Object.fromEntries(ids.map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return [id, {
        visible: !!(rect.width && rect.height),
        inside: rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1
      }];
    }));
  });
  Object.values(mobileChecks).forEach((box) => {
    expect(box.visible).toBeTruthy();
    expect(box.inside).toBeTruthy();
  });
  await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
  expect(fs.existsSync(mobileScreenshotPath)).toBeTruthy();

  expect(consoleIssues).toEqual([]);
});
