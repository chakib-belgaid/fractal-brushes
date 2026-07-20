const { pathToFileURL } = require("url");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const liquidUrl = pathToFileURL(path.resolve(__dirname, "../liquid-mix/index.html")).toString();

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

async function openLiquid(page) {
  await page.goto(liquidUrl);
  await page.waitForFunction(() => window.__liquidMix && window.__liquidMix.ready);
}

async function readPixel(page, x, y) {
  return page.evaluate(([px, py]) => window.__liquidMix.readPixel(px, py), [x, y]);
}

async function settleFrames(page, frames = 30) {
  await page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let remaining = count;
        function tick() {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
    frames
  );
}

test.describe("liquid mix water canvas", () => {
  test("loads without console errors and shows the canvas", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openLiquid(page);
    await settleFrames(page, 10);

    const box = await page.locator("#water").boundingBox();
    expect(box.width).toBeGreaterThan(200);
    expect(box.height).toBeGreaterThan(200);
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".panel")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a drop tints the water near the drop point", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openLiquid(page);
    await settleFrames(page, 5);

    const before = await readPixel(page, 400, 300);
    await page.evaluate(() => {
      window.__liquidMix.setPigment("vermilion");
      window.__liquidMix.drop(400, 300);
    });
    await settleFrames(page, 20);
    const after = await readPixel(page, 400, 300);

    // Vermilion absorbs green/blue: red channel should stay well above the others.
    expect(before[0]).toBeGreaterThan(200);
    expect(after[0] - after[1]).toBeGreaterThan(40);
    expect(after[0] - after[2]).toBeGreaterThan(40);
    expect(errors).toEqual([]);
  });

  test("neighboring drops blend into a mixed hue between them", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openLiquid(page);
    await settleFrames(page, 5);

    await page.evaluate(() => {
      window.__liquidMix.setPigment("ochre");
      window.__liquidMix.drop(370, 300);
      window.__liquidMix.setPigment("indigo");
      window.__liquidMix.drop(430, 300);
      window.__liquidMix.stir(400, 300, 24, 0);
      window.__liquidMix.stir(400, 300, -24, 0);
    });
    await settleFrames(page, 90);

    // Scan the mixing zone: subtractive yellow+blue must turn some pixels green.
    const greenMixPixels = await page.evaluate(() => {
      let count = 0;
      for (let x = 340; x <= 460; x += 12) {
        for (let y = 260; y <= 340; y += 10) {
          const [r, g, b] = window.__liquidMix.readPixel(x, y);
          if (g >= r - 4 && g > b + 8 && g < 215) count += 1;
        }
      }
      return count;
    });
    expect(greenMixPixels).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("pointer input paints and clear restores blank water", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openLiquid(page);
    await settleFrames(page, 5);

    await page.mouse.move(500, 350);
    await page.mouse.down();
    await page.mouse.move(560, 380, { steps: 8 });
    await page.mouse.up();
    await settleFrames(page, 15);

    const painted = await readPixel(page, 500, 350);
    const paintedSum = painted[0] + painted[1] + painted[2];
    expect(paintedSum).toBeLessThan(720);

    await page.click("#clear");
    await settleFrames(page, 5);
    const cleared = await readPixel(page, 500, 350);
    expect(cleared[0]).toBeGreaterThan(220);
    expect(cleared[1]).toBeGreaterThan(220);
    expect(cleared[2]).toBeGreaterThan(220);
    expect(errors).toEqual([]);
  });

  test("export produces a PNG download", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openLiquid(page);
    await settleFrames(page, 5);

    await page.evaluate(() => window.__liquidMix.drop(300, 300));
    await settleFrames(page, 10);

    const downloadPromise = page.waitForEvent("download");
    await page.click("#export");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^liquid-mix-.*\.png$/);
    expect(errors).toEqual([]);
  });
});
