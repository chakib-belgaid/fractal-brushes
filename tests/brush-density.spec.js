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

  await page.setViewportSize({ width: 960, height: 720 });
}

async function drawMeasuredStroke(page, length) {
  await page.goto(appUrl);
  await page.locator("#size").evaluate((input, nextLength) => {
    input.value = String(nextLength);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, length);
  await expect(page.locator("#sizeValue")).toHaveText(String(Math.round(length * 10)));
  await page.evaluate(() => {
    window.__brushStrokeCalls = 0;
  });

  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 180,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });
  for (let x = 240; x <= 720; x += 60) {
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
    clientX: 720,
    clientY: 360,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 0,
    bubbles: true
  });
  await page.waitForTimeout(450);

  return page.evaluate(() => window.__brushStrokeCalls || 0);
}

test("maximum brush length does not emit a much denser stroke than the default length", async ({ page }) => {
  await preparePage(page);

  const defaultDensity = await drawMeasuredStroke(page, 0.5);
  const maximumDensity = await drawMeasuredStroke(page, 6.4);

  expect(defaultDensity).toBeGreaterThan(0);
  expect(maximumDensity).toBeLessThanOrEqual(Math.round(defaultDensity * 1.2));
});

async function setDensitySlider(page, percent) {
  await page.locator("#density").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, percent);
  await expect(page.locator("#densityValue")).toHaveText(`${percent}%`);
}

async function drawScriptedStroke(page) {
  await page.evaluate(() => { window.__brushStrokeCalls = 0; });
  await page.locator("#stage").dispatchEvent("pointerdown", {
    clientX: 180, clientY: 360, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true
  });
  for (let x = 240; x <= 720; x += 60) {
    await page.locator("#stage").dispatchEvent("pointermove", {
      clientX: x, clientY: 360, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, bubbles: true
    });
  }
  await page.locator("#stage").dispatchEvent("pointerup", {
    clientX: 720, clientY: 360, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0, bubbles: true
  });
  await page.waitForTimeout(450);
  return page.evaluate(() => window.__brushStrokeCalls || 0);
}

// Dispatches a full stroke synchronously and samples how many tendrils were
// alive right after the last move -- before decay or the maxTendrils pool cap
// can flatten the numbers (total ctx.stroke calls over a stroke's lifetime
// saturate at the cap, so they cannot measure the density multiplier).
async function measureSpawnedTendrils(page) {
  await page.evaluate(() => {
    const stage = document.getElementById("stage");
    const opts = { pointerId: 7, pointerType: "mouse", button: 0, buttons: 1, bubbles: true, cancelable: true };
    stage.dispatchEvent(new PointerEvent("pointerdown", { ...opts, clientX: 180, clientY: 360 }));
    for (let x = 240; x <= 720; x += 60) {
      stage.dispatchEvent(new PointerEvent("pointermove", { ...opts, clientX: x, clientY: 360 }));
    }
  });
  // The smoothed-move pipeline spawns over animation frames; let it pump while
  // the pointer is still down, then sample the live pool before decay bites.
  await page.waitForTimeout(250);
  const spawned = await page.evaluate(() => {
    const stage = document.getElementById("stage");
    const alive = window.__fractal.state.tendrils.length;
    stage.dispatchEvent(new PointerEvent("pointerup", {
      pointerId: 7, pointerType: "mouse", button: 0, buttons: 0, bubbles: true, cancelable: true,
      clientX: 720, clientY: 360
    }));
    return alive;
  });
  await page.waitForTimeout(300);
  await page.locator("#clear").click();
  await page.waitForTimeout(150);
  return spawned;
}

test("Density slider scales how many particles a stroke emits", async ({ page }) => {
  await preparePage(page);
  await page.goto(appUrl);

  await setDensitySlider(page, 40);
  const low = await measureSpawnedTendrils(page);

  await setDensitySlider(page, 100);
  const mid = await measureSpawnedTendrils(page);

  await setDensitySlider(page, 200);
  const high = await measureSpawnedTendrils(page);

  expect(low).toBeGreaterThan(0);
  expect(mid).toBeGreaterThan(low);
  expect(high).toBeGreaterThan(mid);
  // 5x slider swing (40% -> 200%) should read clearly, even with rounding.
  expect(high).toBeGreaterThanOrEqual(low * 2);
});

test("Density is captured per-stroke and is authoritative on replay", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

  await preparePage(page);
  await page.goto(appUrl);

  // Draw a stroke at a non-default density.
  await setDensitySlider(page, 150);
  await drawScriptedStroke(page);

  const captured = await page.evaluate(() => {
    const log = window.__fractal.state.strokeLog;
    return log.length ? log[log.length - 1].density : null;
  });
  expect(captured).toBeCloseTo(1.5, 5);

  // A canonical replay of the recorded stroke.
  const firstReplay = await page.evaluate(() => {
    window.__fractal.renderWorldSync();
    return document.getElementById("art").toDataURL();
  });

  // Move the live slider far away; replay must still use the CAPTURED density,
  // so a fresh rebuild must produce byte-identical pixels.
  await setDensitySlider(page, 50);
  const secondReplay = await page.evaluate(() => {
    window.__fractal.renderWorldSync();
    return document.getElementById("art").toDataURL();
  });

  expect(secondReplay).toBe(firstReplay);
  expect(errors).toEqual([]);
});
