const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const appUrl = pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString();

async function preparePage(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");
  });
  await page.setViewportSize({ width: 960, height: 720 });
}

async function moveMouse(page, x, y) {
  await page.locator("#stage").dispatchEvent("pointermove", {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: -1,
    buttons: 0,
    bubbles: true
  });
}

test("symmetry guide dots hide in hand/pan mode and reappear back in brush mode", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await preparePage(page);
  await page.goto(appUrl);

  const guide = page.locator("#symmetryGuide");

  // Brush tool active: guide dots should appear and be populated on pointermove.
  await moveMouse(page, 480, 360);
  await expect(guide).toBeVisible();
  await expect(guide.locator(".symmetry-guide-dot")).not.toHaveCount(0);

  // Switch to hand tool via the toolbar button: guide should hide immediately.
  await page.locator("#handTool").click();
  await expect(guide).toBeHidden();
  await expect(guide.locator(".symmetry-guide-dot")).toHaveCount(0);

  // Moving the mouse while in hand mode must not bring the guide back.
  await moveMouse(page, 500, 380);
  await expect(guide).toBeHidden();
  await expect(guide.locator(".symmetry-guide-dot")).toHaveCount(0);

  // Switch back to brush tool: guide should reappear on the next pointermove.
  await page.locator("#handTool").click();
  await moveMouse(page, 520, 400);
  await expect(guide).toBeVisible();
  await expect(guide.locator(".symmetry-guide-dot")).not.toHaveCount(0);

  // Also verify the Space-held pan mode hides the guide.
  await page.keyboard.down("Space");
  await expect(guide).toBeHidden();
  await moveMouse(page, 540, 420);
  await expect(guide).toBeHidden();
  await page.keyboard.up("Space");
  await moveMouse(page, 560, 440);
  await expect(guide).toBeVisible();

  expect(consoleErrors).toEqual([]);
});
