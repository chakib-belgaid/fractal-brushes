const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const inkUrl = pathToFileURL(path.resolve(__dirname, "../white/index.html")).toString();

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

async function countColoredPixels(page, chromaThreshold = 24) {
  return page.evaluate((threshold) => {
    const canvas = document.getElementById("art");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > threshold) colored += 1;
    }
    return colored;
  }, chromaThreshold);
}

async function canvasChecksum(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("art");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 64) {
      sum = (sum + data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7) % 1000000007;
    }
    return sum;
  });
}

async function waitForCanvasToSettle(page, timeoutMs = 9000) {
  const started = Date.now();
  let previous = await canvasChecksum(page);
  while (Date.now() - started < timeoutMs) {
    await page.waitForTimeout(450);
    const current = await canvasChecksum(page);
    if (current === previous) return current;
    previous = current;
  }
  throw new Error("Canvas did not stabilize: wet animation never settled");
}

async function drawStroke(page, from, to, wobble = 34) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t + Math.sin(t * Math.PI * 2.4) * wobble,
      { steps: 2 }
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

test("ink page loads with no console errors and shows the pigment palette", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  await expect(page.locator("#pigmentRow .pigment")).toHaveCount(9);
  await expect(page.locator('[data-pigment="sumi"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pigmentValue")).toHaveText("Sumi Black");

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("colored ink deposits non-grayscale pixels, settles, and undo removes the stroke", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  const baseline = await countColoredPixels(page);

  await page.locator('[data-pigment="vermilion"]').click();
  await expect(page.locator("#pigmentValue")).toHaveText("Vermilion");

  await drawStroke(page, { x: 520, y: 340 }, { x: 760, y: 430 });

  const coloredWhileWet = await countColoredPixels(page);
  expect(coloredWhileWet).toBeGreaterThan(baseline + 500);

  // The wet bloom animation must run to completion and then stop repainting.
  await waitForCanvasToSettle(page);
  const settledChecksum = await canvasChecksum(page);
  await page.waitForTimeout(600);
  expect(await canvasChecksum(page)).toBe(settledChecksum);

  // Undo restores the blank paper.
  await page.locator("#undo").click();
  const coloredAfterUndo = await countColoredPixels(page);
  expect(coloredAfterUndo).toBeLessThanOrEqual(baseline + 50);

  expect(errors).toEqual([]);
});

test("export produces a PNG blob URL without crashing", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.addInitScript(() => {
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreateObjectURL(blob);
      window.__exportCapture = { url, type: blob && blob.type, size: blob && blob.size };
      return url;
    };
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(inkUrl);

  await page.locator('[data-pigment="indigo"]').click();
  await drawStroke(page, { x: 540, y: 360 }, { x: 720, y: 420 });

  await page.locator("#export").click();
  await expect(page.locator("#status")).toHaveText("PNG export ready.");

  const capture = await page.evaluate(() => window.__exportCapture || null);
  expect(capture).not.toBeNull();
  expect(capture.url).toMatch(/^blob:/);
  expect(capture.type).toBe("image/png");
  expect(capture.size).toBeGreaterThan(1000);

  expect(errors).toEqual([]);
});
