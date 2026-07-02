const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const desktopAppUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();
const mobileAppUrl = pathToFileURL(path.resolve(__dirname, "../app/mobile/index.html")).toString();

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 }
});

test("touch devices are redirected from /app/ to the mobile page", async ({ page }) => {
  await page.goto(desktopAppUrl);
  await page.waitForURL(/mobile\/index\.html/);
  await expect(page.locator("#brushStrip .chip")).toHaveCount(11);
});

test("?desktop=1 keeps touch devices on the desktop app", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");
  });
  await page.goto(`${desktopAppUrl}?desktop=1`);
  await page.waitForTimeout(400);
  expect(page.url()).toContain("app/index.html");
  await expect(page.locator("#brushToggle")).toBeVisible();
});

test("mobile page paints, switches brushes, and stays error-free", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  await page.goto(mobileAppUrl);
  await expect(page.locator("#brushStrip .chip")).toHaveCount(11);
  await expect(page.locator('#brushStrip .chip[data-brush="silk"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator('#brushStrip .chip[data-brush="thunder"]').tap();
  await expect(page.locator('#brushStrip .chip[data-brush="thunder"]')).toHaveAttribute("aria-pressed", "true");

  const before = await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit += 1;
    }
    return lit;
  });

  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.4;
  await page.touchscreen.tap(cx, cy);
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
    for (let i = 1; i <= 14; i += 1) {
      dispatch("pointermove", startX + i * 10, startY + Math.sin(i * 0.6) * 26);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 700));
  });

  const after = await page.evaluate(() => {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit += 1;
    }
    return lit;
  });

  expect(after).toBeGreaterThan(before + 500);
  await expect(page.locator("#undo")).toBeEnabled();
  expect(consoleErrors).toEqual([]);
});

test("mobile sheets open, tune values apply, and mirror toggles", async ({ page }) => {
  await page.goto(mobileAppUrl);

  await page.locator("#colorToggle").tap();
  await expect(page.locator("#colorSheet")).toBeVisible();
  await page.locator('#colorSheet [data-mode="single"]').tap();
  await expect(page.locator("#hue2Field")).toHaveClass(/disabled/);
  await page.locator("#colorSheet [data-close]").tap();
  await expect(page.locator("#colorSheet")).toBeHidden();

  await page.locator("#tuneToggle").tap();
  await expect(page.locator("#tuneSheet")).toBeVisible();
  await page.locator("#symmetryRange").fill("10");
  await expect(page.locator("#symmetryValue")).toHaveText("10");
  await page.locator("#tuneSheet [data-close]").tap();

  await page.locator("#mirror").tap();
  await expect(page.locator("#mirror")).toHaveAttribute("aria-pressed", "false");
});

test("mobile export produces a PNG download", async ({ page }) => {
  await page.goto(mobileAppUrl);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save").tap();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^fractal-brushes-.*\.png$/);
});

test("mobile animation loop sleeps when the canvas is idle", async ({ page }) => {
  await page.goto(mobileAppUrl);
  await page.addInitScript(() => {});
  await page.evaluate(() => {
    window.__rafCount = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      window.__rafCount += 1;
      return original(callback);
    };
  });
  await page.waitForTimeout(900);
  const first = await page.evaluate(() => window.__rafCount);
  await page.waitForTimeout(900);
  const second = await page.evaluate(() => window.__rafCount);
  expect(second - first).toBeLessThan(3);
});
