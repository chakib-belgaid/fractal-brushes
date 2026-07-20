const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const inkUrl = pathToFileURL(path.resolve(__dirname, "../white/index.html")).toString();

const BRUSHES = ["sumi", "hake", "mop", "reed", "nib", "dry", "flick", "drip"];

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    errors.push(String(error));
  });
  return errors;
}

async function captureBaseline(page) {
  await page.evaluate(() => {
    const canvas = document.getElementById("art");
    window.__baseline = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.slice();
  });
}

async function changedPixels(page, delta = 10) {
  return page.evaluate((threshold) => {
    const canvas = document.getElementById("art");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const base = window.__baseline;
    let changed = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (
        Math.abs(data[i] - base[i]) > threshold ||
        Math.abs(data[i + 1] - base[i + 1]) > threshold ||
        Math.abs(data[i + 2] - base[i + 2]) > threshold
      ) changed += 1;
    }
    return changed;
  }, delta);
}

async function drawStroke(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 2) * 26,
      { steps: 2 }
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

test("brush rail lists eight ink brushes with rendered previews", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  await expect(page.locator("#brushList .brush")).toHaveCount(8);
  for (const id of BRUSHES) {
    await expect(page.locator(`.brush[data-brush="${id}"]`)).toBeVisible();
  }
  await expect(page.locator('.brush[data-brush="sumi"]')).toHaveAttribute("aria-pressed", "true");

  // Rendering may land one frame after navigation when the full suite is
  // running in parallel, so poll the actual canvas pixels instead of sampling
  // during that brief resize window.
  await expect.poll(() => page.evaluate(() => {
    return Array.from(document.querySelectorAll(".brush")).filter((button) => {
      const preview = button.querySelector(".brush-preview");
      const data = preview.getContext("2d").getImageData(0, 0, preview.width, preview.height).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 12) return false;
      }
      return true;
    }).map((button) => button.dataset.brush);
  })).toEqual([]);

  expect(errors).toEqual([]);
});

test("every brush deposits marks on the paper and undo removes them", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  await captureBaseline(page);

  for (const id of BRUSHES) {
    await page.locator(`.brush[data-brush="${id}"]`).click();
    await expect(page.locator(`.brush[data-brush="${id}"]`)).toHaveAttribute("aria-pressed", "true");

    await drawStroke(page, { x: 560, y: 340 }, { x: 740, y: 420 });
    const changed = await changedPixels(page);
    expect(changed, `brush "${id}" should leave a visible mark`).toBeGreaterThan(60);

    await page.locator("#undo").click();
    const afterUndo = await changedPixels(page);
    expect(afterUndo, `undo should clear the "${id}" stroke`).toBeLessThanOrEqual(20);
  }

  expect(errors).toEqual([]);
});

test("keyboard keys 1-8 switch brushes and brackets resize", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  await page.keyboard.press("4");
  await expect(page.locator('.brush[data-brush="reed"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("8");
  await expect(page.locator('.brush[data-brush="drip"]')).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("1");
  await expect(page.locator('.brush[data-brush="sumi"]')).toHaveAttribute("aria-pressed", "true");

  const before = await page.locator("#sizeValue").textContent();
  await page.keyboard.press("]");
  const bigger = await page.locator("#sizeValue").textContent();
  expect(parseInt(bigger, 10)).toBe(parseInt(before, 10) + 6);
  await page.keyboard.press("[");
  await expect(page.locator("#sizeValue")).toHaveText(before);

  expect(errors).toEqual([]);
});
