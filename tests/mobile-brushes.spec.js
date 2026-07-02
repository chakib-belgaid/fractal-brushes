const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

// ?desktop=1 keeps the desktop app (with its responsive drawer fallback) instead
// of redirecting touch devices to the dedicated mobile page.
const appUrl = `${pathToFileURL(path.resolve(__dirname, "../app/index.html")).toString()}?desktop=1`;

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 }
});

test("mobile canvas supports touch brush selection and drawing", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");

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

  await page.goto(appUrl);
  await expect(page.locator(".zoom-cluster")).toBeHidden();
  await expect(page.locator("#brushPanel")).toBeHidden();

  await page.locator("#brushToggle").tap();
  await expect(page.locator("#brushPanel")).toBeVisible();
  await expect(page.locator("#brushList .brush")).toHaveCount(12);

  const drawerMetrics = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const panelRect = document.getElementById("brushPanel").getBoundingClientRect();
    const toolbarRect = document.querySelector(".toolbar").getBoundingClientRect();
    const brushRects = Array.from(document.querySelectorAll("#brushList .brush")).map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent.trim(),
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
        insideWidth: rect.left >= 0 && rect.right <= viewport.width
      };
    });

    return {
      coarse: window.matchMedia("(pointer: coarse)").matches,
      panelInside: panelRect.left >= 0 && panelRect.top >= 0 && panelRect.right <= viewport.width && panelRect.bottom <= viewport.height,
      overlapsToolbar: !(panelRect.right <= toolbarRect.left || panelRect.left >= toolbarRect.right || panelRect.bottom <= toolbarRect.top || panelRect.top >= toolbarRect.bottom),
      brushRects
    };
  });

  expect(drawerMetrics.coarse).toBeTruthy();
  expect(drawerMetrics.panelInside).toBeTruthy();
  expect(drawerMetrics.overlapsToolbar).toBeFalsy();
  drawerMetrics.brushRects.forEach((rect) => {
    expect(rect.visible).toBeTruthy();
    expect(rect.insideWidth).toBeTruthy();
    expect(rect.height).toBeGreaterThanOrEqual(44);
  });

  await page.getByRole("button", { name: "Water brush" }).tap();
  await expect(page.locator("#brushPanel")).toBeHidden();
  await expect(page.locator("[data-brush='water']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#brushToggle")).toHaveAttribute("aria-expanded", "false");

  await page.evaluate(() => {
    window.__brushStrokeCalls = 0;
  });

  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 86,
    clientY: 338,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true
  });
  await expect(page.locator("body")).toHaveClass(/is-painting/);
  await expect(page.locator(".chrome")).toHaveCSS("pointer-events", "none");

  for (const [clientX, clientY] of [[132, 292], [186, 382], [248, 312], [306, 392]]) {
    await page.locator("#stage").dispatchEvent("pointermove", {
      clientX,
      clientY,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: 1,
      bubbles: true
    });
  }

  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 306,
    clientY: 392,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 0,
    bubbles: true
  });
  await expect(page.locator("body")).not.toHaveClass(/is-painting/);
  await page.waitForTimeout(650);

  await expect.poll(() => page.evaluate(() => window.__brushStrokeCalls || 0)).toBeGreaterThan(0);
  const strokeCalls = await page.evaluate(() => window.__brushStrokeCalls || 0);
  expect(strokeCalls).toBeLessThan(7000);
});
