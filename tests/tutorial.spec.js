const fs = require("fs");
const http = require("http");
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);

const rootDir = path.resolve(__dirname, "..");

let server;
let baseUrl;

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(rootDir, requestedPath));

    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, body) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const contentType = filePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("walkthrough appears once, persists dismissal in a cookie, and reopens from help", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(`${baseUrl}/app/index.html`);

  const tutorial = page.locator("#tutorial");
  await expect(tutorial).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Draw on the canvas");
  await expect(page.locator("#tutorialProgress")).toHaveText("1 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Start with a brush");
  await expect(page.locator("#tutorialProgress")).toHaveText("2 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Tune length and expansion");
  await expect(page.locator("#tutorialProgress")).toHaveText("3 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Set symmetry points");
  await expect(page.locator("#tutorialProgress")).toHaveText("4 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Use mirror mode");
  await expect(page.locator("#tutorialProgress")).toHaveText("5 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Shape the color");
  await expect(page.locator("#tutorialProgress")).toHaveText("6 / 7");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Export the canvas");
  await expect(page.locator("#tutorialProgress")).toHaveText("7 / 7");

  await page.locator("#tutorialDone").click();
  await expect(tutorial).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("fractalBrushesTutorialSeen=1");

  await page.reload();
  await expect(tutorial).toBeHidden();

  await page.locator("#help").click();
  await expect(tutorial).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Draw on the canvas");
});

test("walkthrough actions operate real controls step by step", async ({ page, context }) => {
  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/app/index.html`);

  await expect(page.locator("#tutorial")).toBeVisible();
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "stage");
  await expect(page.locator("#tutorialSpotlight .spotlight-preview")).toBeHidden();
  await expect(page.locator("#brushPanel")).toBeHidden();

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#tutorialTitle")).toHaveText("Start with a brush");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "brushToggle");
  await expect(page.locator("#tutorialSpotlight .spotlight-preview svg")).toBeVisible();

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#brushPanel")).toBeVisible();
  await expect(page.locator("#tutorialTitle")).toHaveText("Tune length and expansion");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "paramsToggle");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#paramsPanel")).toBeVisible();
  await expect(page.locator("#brushPanel")).toBeHidden();
  await expect(page.locator("#tutorialTitle")).toHaveText("Set symmetry points");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "symmetry");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#symmetryValue")).toHaveText("10");
  await expect(page.locator("#tutorialTitle")).toHaveText("Use mirror mode");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "mirror");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#mirror")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#tutorialTitle")).toHaveText("Shape the color");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "colorToggle");

  await page.locator("#tutorialNext").click();
  await expect(page.locator("#colorPanel")).toBeVisible();
  await expect(page.locator(".mode[data-mode='blend']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tutorialTitle")).toHaveText("Export the canvas");
  await expect(page.locator("#tutorialSpotlight")).toHaveAttribute("data-target-id", "exportToggle");

  await page.locator("#tutorialDone").click();
  await expect(page.locator("#tutorial")).toBeHidden();
});

test("walkthrough backdrop blocks clicks from controls underneath", async ({ page, context }) => {
  await context.clearCookies();
  await page.goto(`${baseUrl}/app/index.html`);

  await expect(page.locator("#tutorial")).toBeVisible();
  const mirror = page.locator("#mirror");
  await expect(mirror).toHaveAttribute("aria-pressed", "true");

  const box = await mirror.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(mirror).toHaveAttribute("aria-pressed", "true");
});

test("walkthrough backdrop keeps tutorial-opened mobile controls stable", async ({ page, context }) => {
  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/app/index.html`);

  await page.locator("#tutorialNext").click();
  await page.locator("#tutorialNext").click();
  await expect(page.locator("#brushPanel")).toBeVisible();

  await page.mouse.click(20, 20);

  await expect(page.locator("#brushPanel")).toBeVisible();
});

test("walkthrough stays usable on mobile width", async ({ page, context }) => {
  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/app/index.html`);

  await expect(page.locator("#tutorial")).toBeVisible();
  await expect(page.locator("#tutorialNext")).toBeVisible();
  await expect(page.locator("#tutorialSkip")).toBeVisible();

  const boxes = await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return ["tutorial", "tutorialNext", "tutorialSkip"].map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return {
        id,
        visible: rect.width > 0 && rect.height > 0,
        inside: rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height
      };
    });
  });

  expect(boxes).toEqual(boxes.map((box) => ({ ...box, visible: true, inside: true })));
});
