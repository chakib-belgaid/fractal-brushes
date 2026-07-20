# Unified Studio Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the three Fractal Brushes apps into one seamless "studio shell" at `/` — kept-alive studios, live-preview switcher, animated transitions — per `docs/superpowers/specs/2026-07-04-unified-studio-shell-design.md`.

**Architecture:** A new root `index.html` app shell hosts each existing app (`/app/`, `/white/`, `/liquid-mix/`) in a lazily created, never-destroyed same-origin iframe. A ~40-line "embed adapter" script added to each app gates `requestAnimationFrame` behind `fb:pause`/`fb:resume` postMessages and announces `fb:ready`. The shell owns routing (hash deep links + localStorage last-studio), the full-screen picker with live scaled previews, transitions, an About overlay, and focus handoff. Standalone app URLs behave exactly as today.

**Tech Stack:** Vanilla HTML/CSS/JS, zero dependencies, no build step (GitHub Pages static). Playwright for tests (existing specs use `file://` URLs; new shell specs use a tiny node `http` static server because the shell needs same-origin iframe messaging).

## Global Constraints

- Dependency-free: no npm packages, no build step, no CDN scripts (AGENTS.md).
- Static GitHub Pages compatible; keep `.nojekyll`.
- Do not move `/app/` — `/app/`, `/app/mobile/`, `/white/`, `/liquid-mix/` must keep working standalone, byte-for-byte behavior-identical when not embedded.
- All existing Playwright suites in `tests/` must keep passing (they load apps via `file://`).
- Tests resolve Playwright via `require.resolve("playwright/test", { paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"] })` — copy this pattern into every new spec.
- Run tests with `npx playwright test <spec> --reporter=line` from the repo root.
- Honor `prefers-reduced-motion` in all shell animations.
- The working branch (`feat/smooth-brushes-custom-mode`) has uncommitted edits to `README.md`, `app/index.html`, `white/index.html`, `tests/brush-density.spec.js` plus untracked test files. Build on top of that state; do not revert it. Commit only files you touched for a task.

## Message protocol (used by every task)

- Studio → shell: `{ type: "fb:ready" }` posted to `window.parent` when the app's DOM is interactive.
- Shell → studio: `{ type: "fb:pause" }` — hold all future `requestAnimationFrame` callbacks; `{ type: "fb:resume" }` — flush held callbacks and run normally.
- Adapter state is exposed as `window.__fbEmbed = { embedded: boolean, paused: boolean }` and, when embedded, the class `fb-embedded` on `<html>`.

---

### Task 1: Test infrastructure + embed adapter in liquid-mix

**Files:**
- Create: `tests/helpers/static-server.js`
- Create: `tests/fixtures/embed-harness.html`
- Create: `tests/embed-adapter.spec.js`
- Modify: `liquid-mix/index.html` (insert one `<script>` immediately before the app's main `<script>` at line ~409)

**Interfaces:**
- Produces: `startStaticServer(rootDir) → Promise<{ baseUrl, close }>` (CommonJS export from `tests/helpers/static-server.js`); the embed adapter snippet (verbatim below) reused by Task 2; harness page at `/tests/fixtures/embed-harness.html?src=<path>` exposing `window.__messages` (array of received message payloads) and `window.__post(msg)` (posts to the framed studio).

- [ ] **Step 1: Write the static server helper**

Create `tests/helpers/static-server.js`:

```js
const http = require("http");
const fs = require("fs");
const path = require("path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json"
};

function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
    } catch {
      /* fall through to readFile 404 */
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream"
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

module.exports = { startStaticServer };
```

- [ ] **Step 2: Write the embed harness fixture**

Create `tests/fixtures/embed-harness.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Embed harness</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
    </style>
  </head>
  <body>
    <script>
      window.__messages = [];
      window.addEventListener("message", (event) => {
        window.__messages.push(event.data);
      });
      const src = new URLSearchParams(location.search).get("src");
      const frame = document.createElement("iframe");
      frame.id = "studio";
      frame.src = src;
      document.body.appendChild(frame);
      window.__post = (msg) => frame.contentWindow.postMessage(msg, "*");
    </script>
  </body>
</html>
```

- [ ] **Step 3: Write the failing spec**

Create `tests/embed-adapter.spec.js`:

```js
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);
const { startStaticServer } = require("./helpers/static-server");

let server;
test.beforeAll(async () => {
  server = await startStaticServer(path.resolve(__dirname, ".."));
});
test.afterAll(async () => {
  await server.close();
});

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

// Resolves true when a requestAnimationFrame callback fires inside the
// given page/frame within `timeout` ms.
function rafFires(target, timeout) {
  return target.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let fired = false;
        requestAnimationFrame(() => {
          fired = true;
        });
        setTimeout(() => resolve(fired), ms);
      }),
    timeout
  );
}

const STUDIOS = [{ name: "liquid-mix", route: "/liquid-mix/index.html" }];

for (const studio of STUDIOS) {
  test.describe(`${studio.name} embed adapter`, () => {
    test("standalone page is inert", async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto(server.baseUrl + studio.route);
      await page.waitForFunction(() => window.__fbEmbed !== undefined);
      expect(await page.evaluate(() => window.__fbEmbed.embedded)).toBe(false);
      expect(
        await page.evaluate(() => document.documentElement.classList.contains("fb-embedded"))
      ).toBe(false);
      expect(await rafFires(page, 500)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("framed page announces ready and pauses/resumes", async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto(
        `${server.baseUrl}/tests/fixtures/embed-harness.html?src=${studio.route}`
      );
      await page.waitForFunction(() =>
        window.__messages.some((m) => m && m.type === "fb:ready")
      );
      const frame = page.frame({ name: "" }) || page.frames()[1];
      expect(await frame.evaluate(() => window.__fbEmbed.embedded)).toBe(true);
      expect(
        await frame.evaluate(() => document.documentElement.classList.contains("fb-embedded"))
      ).toBe(true);

      await page.evaluate(() => window.__post({ type: "fb:pause" }));
      await frame.waitForFunction(() => window.__fbEmbed.paused === true);
      expect(await rafFires(frame, 350)).toBe(false);

      await page.evaluate(() => window.__post({ type: "fb:resume" }));
      await frame.waitForFunction(() => window.__fbEmbed.paused === false);
      expect(await rafFires(frame, 500)).toBe(true);
      expect(errors).toEqual([]);
    });

    test("cancelAnimationFrame works on callbacks queued while paused", async ({ page }) => {
      await page.goto(
        `${server.baseUrl}/tests/fixtures/embed-harness.html?src=${studio.route}`
      );
      await page.waitForFunction(() =>
        window.__messages.some((m) => m && m.type === "fb:ready")
      );
      const frame = page.frames()[1];
      await page.evaluate(() => window.__post({ type: "fb:pause" }));
      await frame.waitForFunction(() => window.__fbEmbed.paused === true);
      const fired = await frame.evaluate(
        () =>
          new Promise((resolve) => {
            let hit = false;
            const id = requestAnimationFrame(() => {
              hit = true;
            });
            cancelAnimationFrame(id);
            window.addEventListener("message", function onResume(e) {
              if (e.data && e.data.type === "fb:resume") {
                window.removeEventListener("message", onResume);
                setTimeout(() => resolve(hit), 300);
              }
            });
          })
      );
      await page.evaluate(() => window.__post({ type: "fb:resume" }));
      expect(await fired).toBe(false);
    });
  });
}
```

Note: the third test kicks off the in-frame promise before resuming; keep the `await fired` after the resume post exactly as written.

- [ ] **Step 4: Run the spec to verify it fails**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: FAIL — `window.__fbEmbed` never defined (adapter not installed yet).

- [ ] **Step 5: Install the adapter in liquid-mix**

In `liquid-mix/index.html`, find the app's main `<script>` tag (line ~409, `grep -n "<script" liquid-mix/index.html`). Insert this complete script block on the line immediately before it:

```html
  <script>
    /* Fractal Brushes embed adapter: lets the studio shell at / pause this
       app's animation loops while it is hidden. Inert when standalone. */
    (function () {
      let embedded = false;
      try {
        embedded = window.top !== window;
      } catch {
        embedded = true;
      }
      window.__fbEmbed = { embedded, paused: false };
      if (!embedded) return;
      document.documentElement.classList.add("fb-embedded");
      const realRaf = window.requestAnimationFrame.bind(window);
      const realCancel = window.cancelAnimationFrame.bind(window);
      let nextId = 1;
      const queued = new Map();
      const live = new Map();
      window.requestAnimationFrame = function (callback) {
        const id = nextId++;
        if (window.__fbEmbed.paused) {
          queued.set(id, callback);
        } else {
          live.set(id, realRaf((time) => {
            live.delete(id);
            callback(time);
          }));
        }
        return id;
      };
      window.cancelAnimationFrame = function (id) {
        if (queued.delete(id)) return;
        const realId = live.get(id);
        if (realId !== undefined) {
          live.delete(id);
          realCancel(realId);
        }
      };
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || typeof data.type !== "string") return;
        if (data.type === "fb:pause") {
          window.__fbEmbed.paused = true;
        } else if (data.type === "fb:resume") {
          if (!window.__fbEmbed.paused) return;
          window.__fbEmbed.paused = false;
          const pending = Array.from(queued);
          queued.clear();
          for (const [id, callback] of pending) {
            live.set(id, realRaf((time) => {
              live.delete(id);
              callback(time);
            }));
          }
        }
      });
      const announce = () => {
        try {
          window.parent.postMessage({ type: "fb:ready" }, "*");
        } catch {
          /* parent gone */
        }
      };
      if (document.readyState !== "loading") announce();
      else window.addEventListener("DOMContentLoaded", announce);
    })();
  </script>
```

Why RAF-gating instead of touching each app's loop: every app self-schedules through `requestAnimationFrame`, so holding the callbacks freezes any loop generically with zero changes to renderer code. Held callbacks flush on resume, so loops continue where they stopped. `liquid-mix` already clamps `dt` to 1/30 s, so a long pause does not explode the simulation.

- [ ] **Step 6: Run the spec to verify it passes**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify existing liquid-mix suite still passes (standalone unaffected)**

Run: `npx playwright test tests/liquid-mix.spec.js --reporter=line`
Expected: PASS, same count as before the change.

- [ ] **Step 8: Commit**

```bash
git add tests/helpers/static-server.js tests/fixtures/embed-harness.html tests/embed-adapter.spec.js liquid-mix/index.html
git commit -m "feat: embed adapter in liquid-mix with pause/resume RAF gating"
```

---

### Task 2: Embed adapter in the remaining three apps

**Files:**
- Modify: `app/index.html` (insert adapter as the FIRST script in `<head>`, before the mobile-redirect `<script>` at line ~8)
- Modify: `app/mobile/index.html` (insert adapter immediately before the main `<script>` at line ~554)
- Modify: `white/index.html` (insert adapter immediately before the main `<script>` at line ~734)
- Modify: `tests/embed-adapter.spec.js` (extend the `STUDIOS` array)

**Interfaces:**
- Consumes: the adapter snippet and harness/server from Task 1.
- Produces: all four app files expose `window.__fbEmbed` and the `fb:ready`/`fb:pause`/`fb:resume` protocol; `html.fb-embedded` class available for embedded-only CSS in Task 5.

- [ ] **Step 1: Extend the spec to cover all four apps**

In `tests/embed-adapter.spec.js`, replace the `STUDIOS` array with:

```js
const STUDIOS = [
  { name: "liquid-mix", route: "/liquid-mix/index.html" },
  { name: "white", route: "/white/index.html" },
  { name: "desktop app", route: "/app/index.html?desktop=1" },
  { name: "mobile app", route: "/app/mobile/index.html" }
];
```

Note `?desktop=1` on the desktop app: without it a coarse-pointer environment could redirect to the mobile page mid-test. Two behaviors differ per app and the generic tests already tolerate them:
- `white` and the mobile app only run RAF while there is work (wet regions / live tendrils). The `rafFires` probe schedules its own callback, so it still exercises the gate.
- The desktop app runs a continuous `step` loop; nothing extra needed.

- [ ] **Step 2: Run the spec to verify the three new apps fail**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: liquid-mix tests PASS; the 9 new tests FAIL on `window.__fbEmbed` undefined.

- [ ] **Step 3: Insert the identical adapter script into the three files**

Copy the exact `<script>` block from Task 1 Step 5 (verbatim — do not modify) into:
1. `app/index.html` — immediately after `<head>` opens, BEFORE the existing mobile-redirect script (the adapter must wrap `requestAnimationFrame` before any app code runs; being before the redirect is harmless since a redirected page gets its own adapter in the mobile file).
2. `app/mobile/index.html` — immediately before the main `<script>` (line ~554).
3. `white/index.html` — immediately before the main `<script>` (line ~734).

- [ ] **Step 4: Run the spec to verify all pass**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full existing suite to prove standalone behavior is unchanged**

Run: `npx playwright test --reporter=line`
Expected: same pass/fail profile as before this task (all previously passing specs still pass).

- [ ] **Step 6: Commit**

```bash
git add app/index.html app/mobile/index.html white/index.html tests/embed-adapter.spec.js
git commit -m "feat: embed adapter in desktop, mobile, and ink apps"
```

---

### Task 3: Studio shell at `/`

**Files:**
- Modify: `index.html` (full rewrite — the old landing page is retired; its story moves into the shell's About overlay)
- Create: `tests/studio-shell.spec.js`

**Interfaces:**
- Consumes: `fb:ready`/`fb:pause`/`fb:resume` protocol from Tasks 1–2; `startStaticServer` helper.
- Produces: shell DOM contract used by Task 4's tests — rooms are `section.room#room-<id>` with `data-ready`/`data-failed` attributes and an `iframe.frame` child; the switcher orb is `button#orb`; picker layer is `#picker` with `button.pick[data-studio=<id>]` cards; About overlay is `#about` opened by `#about-open` and closed by `#about-close`. Studio ids: `luminous`, `ink`, `liquid`. localStorage key: `fractalBrushes.studio`. Hash routes: `#luminous`, `#ink`, `#liquid`. Query param `readyTimeout` (ms, default 12000) overrides the ready-watchdog for tests. Global test hook `window.__fbShell = { activate(id), activeId(), frames() }`.

- [ ] **Step 1: Write the failing shell spec**

Create `tests/studio-shell.spec.js`:

```js
const path = require("path");

const playwrightTestPath = require.resolve("playwright/test", {
  paths: [__dirname, process.cwd(), "/opt/homebrew/lib/node_modules"]
});
const { test, expect } = require(playwrightTestPath);
const { startStaticServer } = require("./helpers/static-server");

let server;
test.beforeAll(async () => {
  server = await startStaticServer(path.resolve(__dirname, ".."));
});
test.afterAll(async () => {
  await server.close();
});

function collectPageErrors(page) {
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

async function openShell(page, pathAndHash = "/") {
  await page.addInitScript(() => {
    window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");
  });
  await page.goto(server.baseUrl + pathAndHash);
}

test.describe("studio shell boot & routing", () => {
  test("root boots into luminous with no console errors", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openShell(page);
    await expect(page.locator("#room-luminous")).toHaveClass(/active/);
    await expect(page.locator("#room-luminous")).toHaveAttribute("data-ready", "1");
    const src = await page.locator("#room-luminous iframe").getAttribute("src");
    expect(src).toContain("app/index.html");
    // Lazy creation: only the active studio has an iframe.
    expect(await page.locator("#stage iframe").count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test("hash deep link opens the right studio", async ({ page }) => {
    await openShell(page, "/#liquid");
    await expect(page.locator("#room-liquid")).toHaveClass(/active/);
    await expect(page.locator("#room-liquid")).toHaveAttribute("data-ready", "1");
    expect(await page.locator("#stage iframe").count()).toBe(1);
  });

  test("runtime hash change switches studio and records last-used", async ({ page }) => {
    await openShell(page);
    await expect(page.locator("#room-luminous")).toHaveAttribute("data-ready", "1");
    await page.evaluate(() => {
      location.hash = "#ink";
    });
    await expect(page.locator("#room-ink")).toHaveClass(/active/);
    await expect(page.locator("#room-ink")).toHaveAttribute("data-ready", "1");
    expect(
      await page.evaluate(() => localStorage.getItem("fractalBrushes.studio"))
    ).toBe("ink");
  });

  test("last-used studio is restored on a plain visit", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("fractalBrushes.studio", "ink");
      window.localStorage.setItem("fractalBrushes.tutorialSeen", "1");
    });
    await page.goto(server.baseUrl + "/");
    await expect(page.locator("#room-ink")).toHaveClass(/active/);
  });

  test("about overlay opens from the picker and closes", async ({ page }) => {
    await openShell(page);
    await page.locator("#orb").click();
    await expect(page.locator("body")).toHaveClass(/picker/);
    await page.locator("#about-open").click();
    await expect(page.locator("#about")).toBeVisible();
    await expect(page.locator("#about")).toContainText("Fractal Brushes");
    await page.locator("#about-close").click();
    await expect(page.locator("#about")).toBeHidden();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/studio-shell.spec.js --reporter=line`
Expected: FAIL — the old landing page has no `#room-*` elements.

- [ ] **Step 3: Replace `index.html` with the studio shell**

Overwrite `index.html` with the complete shell below. Read it once fully before pasting — it is the heart of the feature.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Fractal Brushes — Studio</title>
    <meta
      name="description"
      content="Fractal Brushes is a browser art studio with three canvases: luminous symmetry trails, wet ink on paper, and pigment drifting in water."
    />
    <style>
      :root {
        --shell-bg: #06070d;
        --shell-ink: #edf0ff;
        --shell-muted: rgba(237, 240, 255, 0.66);
        --shell-accent: #86a4ff;
        --shell-line: rgba(237, 240, 255, 0.16);
        --shell-radius: 18px;
        --shell-font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
          sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        height: 100%;
      }
      body {
        margin: 0;
        background: var(--shell-bg);
        color: var(--shell-ink);
        font-family: var(--shell-font);
        overflow: hidden;
      }
      button {
        font: inherit;
        color: inherit;
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
      }
      :focus-visible {
        outline: 2px solid var(--shell-accent);
        outline-offset: 2px;
      }

      #stage {
        position: fixed;
        inset: 0;
        background: radial-gradient(120% 100% at 50% 0%, #10142575, var(--shell-bg) 62%);
      }
      .room {
        position: absolute;
        inset: 0;
        transform-origin: 0 0;
        opacity: 0;
        pointer-events: none;
        transition:
          transform 0.38s cubic-bezier(0.22, 0.9, 0.32, 1),
          opacity 0.3s ease;
        will-change: transform, opacity;
      }
      .room.active {
        opacity: 1;
        pointer-events: auto;
      }
      .room:not(.active):not(.in-picker) {
        transform: translate(2.5vw, 2.5vh) scale(0.95);
      }
      body.picker .room {
        opacity: 1;
        pointer-events: none;
        border-radius: var(--shell-radius);
        overflow: hidden;
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.55);
        outline: 1px solid var(--shell-line);
      }
      .room .frame,
      .room .poster,
      .room .load-card {
        position: absolute;
        inset: 0;
      }
      .room .frame {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
        background: #000;
      }
      .room .poster {
        display: grid;
        place-items: center;
        text-align: center;
        padding: 24px;
      }
      .poster-name {
        margin: 0;
        font-size: clamp(28px, 6vw, 54px);
        font-weight: 650;
        letter-spacing: 0.01em;
      }
      .poster-tagline {
        margin: 10px 0 0;
        font-size: clamp(14px, 2.2vw, 19px);
        opacity: 0.72;
      }
      .room[data-light] .poster {
        color: #2c2a24;
      }
      .room .load-card {
        display: grid;
        place-items: center;
        background: rgba(4, 5, 10, 0.35);
        transition: opacity 0.35s ease, visibility 0.35s;
      }
      .room[data-ready] .load-card {
        opacity: 0;
        visibility: hidden;
      }
      .load-inner {
        display: grid;
        gap: 14px;
        justify-items: center;
      }
      .spinner {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 2px solid var(--shell-line);
        border-top-color: var(--shell-accent);
        animation: fb-spin 0.9s linear infinite;
      }
      .load-label {
        font-size: 14px;
        color: var(--shell-muted);
      }
      .retry {
        display: none;
        padding: 10px 22px;
        border-radius: 999px;
        border: 1px solid var(--shell-line);
        background: rgba(237, 240, 255, 0.08);
      }
      .room[data-failed] .spinner {
        display: none;
      }
      .room[data-failed] .retry {
        display: inline-block;
      }
      @keyframes fb-spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* ---- Switcher orb ---- */
      #orb {
        position: fixed;
        left: 50%;
        transform: translateX(-50%);
        bottom: calc(18px + env(safe-area-inset-bottom));
        z-index: 40;
        width: 54px;
        height: 54px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(10, 12, 22, 0.72);
        border: 1px solid var(--shell-line);
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      #orb:hover {
        transform: translateX(-50%) scale(1.08);
      }
      body.picker #orb,
      body.about-open #orb {
        opacity: 0;
        pointer-events: none;
      }
      body.coarse #orb {
        left: auto;
        right: 14px;
        transform: none;
        bottom: calc(148px + env(safe-area-inset-bottom));
      }
      body.coarse #orb:hover {
        transform: scale(1.08);
      }
      #orb .dots {
        display: flex;
        gap: 5px;
      }
      #orb .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        opacity: 0.45;
        transition: opacity 0.2s, transform 0.2s;
      }
      #orb .dot-luminous {
        background: #9db4ff;
      }
      #orb .dot-ink {
        background: #efe9da;
      }
      #orb .dot-liquid {
        background: #6cc8d8;
      }
      #orb .dot.on {
        opacity: 1;
        transform: scale(1.35);
      }

      /* ---- Picker layer ---- */
      #picker {
        position: fixed;
        inset: 0;
        z-index: 30;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.3s ease, visibility 0.3s;
      }
      body.picker #picker {
        opacity: 1;
        visibility: visible;
      }
      #picker .picker-head {
        position: absolute;
        top: max(26px, env(safe-area-inset-top));
        left: 0;
        right: 0;
        text-align: center;
        pointer-events: none;
      }
      .picker-head .wordmark {
        margin: 0;
        font-size: 15px;
        letter-spacing: 0.34em;
        text-transform: uppercase;
        color: var(--shell-muted);
      }
      .picker-head .prompt {
        margin: 6px 0 0;
        font-size: clamp(19px, 3vw, 26px);
        font-weight: 600;
      }
      .pick {
        position: absolute;
        border-radius: var(--shell-radius);
        text-align: left;
        color: var(--shell-ink);
      }
      .pick .pick-caption {
        position: absolute;
        top: 100%;
        left: 2px;
        margin-top: 10px;
        white-space: nowrap;
      }
      .pick-name {
        font-size: 17px;
        font-weight: 650;
      }
      .pick-tagline {
        font-size: 13px;
        color: var(--shell-muted);
        margin-top: 2px;
      }
      .pick-active-dot {
        display: none;
        margin-left: 8px;
        color: var(--shell-accent);
        font-size: 12px;
        vertical-align: 2px;
      }
      .pick[data-active] .pick-active-dot {
        display: inline;
      }
      .pick:hover {
        outline: 2px solid var(--shell-accent);
        outline-offset: 3px;
      }
      #picker .picker-foot {
        position: absolute;
        bottom: calc(20px + env(safe-area-inset-bottom));
        left: 0;
        right: 0;
        text-align: center;
        font-size: 14px;
        color: var(--shell-muted);
      }
      .picker-foot button,
      .picker-foot a {
        color: var(--shell-muted);
        text-decoration: none;
        border-bottom: 1px solid transparent;
      }
      .picker-foot button:hover,
      .picker-foot a:hover {
        color: var(--shell-ink);
        border-bottom-color: var(--shell-line);
      }

      /* ---- About overlay ---- */
      #about {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: none;
        place-items: center;
        background: rgba(4, 5, 10, 0.7);
        padding: 20px;
      }
      body.about-open #about {
        display: grid;
      }
      .about-card {
        position: relative;
        max-width: 640px;
        max-height: min(86vh, 720px);
        overflow-y: auto;
        background: #0d1020;
        border: 1px solid var(--shell-line);
        border-radius: var(--shell-radius);
        padding: 34px 38px 30px;
        line-height: 1.55;
      }
      .about-card h1 {
        margin: 0 0 4px;
        font-size: 26px;
      }
      .about-card .sub {
        margin: 0 0 18px;
        color: var(--shell-muted);
      }
      .about-card h2 {
        font-size: 15px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--shell-muted);
        margin: 22px 0 8px;
      }
      .about-card ul {
        margin: 0;
        padding-left: 18px;
      }
      .about-card li {
        margin: 6px 0;
      }
      .about-card a {
        color: var(--shell-accent);
      }
      #about-close {
        position: absolute;
        top: 14px;
        right: 16px;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 1px solid var(--shell-line);
        font-size: 16px;
        line-height: 1;
      }

      noscript .noscript-links {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        text-align: center;
      }
      noscript a {
        color: var(--shell-accent);
      }

      @media (prefers-reduced-motion: reduce) {
        .room,
        #picker,
        #orb,
        .room .load-card {
          transition: none !important;
        }
        .spinner {
          animation-duration: 2s;
        }
      }
    </style>
  </head>
  <body>
    <main id="stage" aria-label="Fractal Brushes studios"></main>

    <button id="orb" type="button" aria-label="Switch studio (Ctrl+K)" title="Switch studio (Ctrl+K)">
      <span class="dots" aria-hidden="true">
        <span class="dot dot-luminous"></span>
        <span class="dot dot-ink"></span>
        <span class="dot dot-liquid"></span>
      </span>
    </button>

    <div id="picker" role="dialog" aria-label="Choose your studio">
      <div class="picker-head">
        <p class="wordmark">Fractal Brushes</p>
        <p class="prompt">Choose your studio</p>
      </div>
      <div id="picker-cards"></div>
      <div class="picker-foot">
        <button id="about-open" type="button">About Fractal Brushes</button>
        <span aria-hidden="true"> · </span>
        <a href="https://github.com/chakib-belgaid/fractal-brushes" target="_blank" rel="noreferrer">GitHub</a>
      </div>
    </div>

    <div id="about" role="dialog" aria-modal="true" aria-label="About Fractal Brushes">
      <div class="about-card">
        <button id="about-close" type="button" aria-label="Close about">×</button>
        <h1>Fractal Brushes</h1>
        <p class="sub">A browser art studio for symmetry, ink, and water. No accounts, no installs — your canvas is the homepage.</p>
        <h2>Three studios</h2>
        <ul>
          <li><strong>Luminous</strong> — mirrored glowing tendrils on an infinite dark canvas. Eleven brush families, unlimited undo, 4K PNG export.</li>
          <li><strong>Ink</strong> — eight wet-pigment brushes on white paper with blooms, granulation, and drying rims.</li>
          <li><strong>Liquid Mix</strong> — a WebGL water tank: drop pigment, stir the currents, watch colors mix like real paint.</li>
        </ul>
        <h2>Good to know</h2>
        <ul>
          <li>Everything stays alive while you switch studios — artwork, undo history, drifting water.</li>
          <li>Desktop is recommended for precision and big exports; every studio also works on touch.</li>
          <li>Each studio has one-click PNG export in its top bar.</li>
        </ul>
        <h2>Project</h2>
        <ul>
          <li><a href="https://github.com/chakib-belgaid/fractal-brushes" target="_blank" rel="noreferrer">Source on GitHub</a> · MIT license · static site, zero dependencies.</li>
          <li>Standalone canvases: <a href="./app/">Luminous</a> · <a href="./white/">Ink</a> · <a href="./liquid-mix/">Liquid Mix</a>.</li>
        </ul>
      </div>
    </div>

    <noscript>
      <div class="noscript-links">
        <p>
          Fractal Brushes needs JavaScript. Open a canvas directly:<br />
          <a href="./app/">Luminous</a> · <a href="./white/">Ink</a> · <a href="./liquid-mix/">Liquid Mix</a>
        </p>
      </div>
    </noscript>

    <script>
      (function () {
        "use strict";

        const STUDIOS = [
          {
            id: "luminous",
            name: "Luminous",
            tagline: "Glowing symmetry trails",
            src: "./app/index.html",
            poster: "radial-gradient(130% 130% at 30% 20%, #2b2e6e, #0a0c1f 72%)"
          },
          {
            id: "ink",
            name: "Ink",
            tagline: "Wet pigment on paper",
            src: "./white/index.html",
            poster: "radial-gradient(130% 130% at 30% 20%, #f5f0e4, #d9d3c3 72%)",
            light: true
          },
          {
            id: "liquid",
            name: "Liquid Mix",
            tagline: "Ink drifting in water",
            src: "./liquid-mix/index.html",
            poster: "radial-gradient(130% 130% at 30% 20%, #0d3b4e, #04121c 72%)"
          }
        ];
        const STORAGE_KEY = "fractalBrushes.studio";
        const READY_TIMEOUT =
          Number(new URLSearchParams(location.search).get("readyTimeout")) || 12000;

        const stage = document.getElementById("stage");
        const orb = document.getElementById("orb");
        const pickerCards = document.getElementById("picker-cards");
        const rooms = {};
        const frames = {};
        const readyTimers = {};
        let activeId = null;
        let pickerOpen = false;

        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const coarseQuery = window.matchMedia("(pointer: coarse)");
        function syncCoarse() {
          document.body.classList.toggle(
            "coarse",
            coarseQuery.matches || window.innerWidth < 700
          );
        }
        coarseQuery.addEventListener?.("change", syncCoarse);

        function readStorage(key) {
          try {
            return window.localStorage.getItem(key);
          } catch {
            return null;
          }
        }
        function writeStorage(key, value) {
          try {
            window.localStorage.setItem(key, value);
          } catch {
            /* private browsing */
          }
        }

        /* ---- Rooms ---- */
        for (const studio of STUDIOS) {
          const room = document.createElement("section");
          room.className = "room";
          room.id = "room-" + studio.id;
          if (studio.light) room.dataset.light = "1";
          room.innerHTML =
            '<div class="poster" style="background:' + studio.poster + '">' +
            '<div><h2 class="poster-name">' + studio.name + "</h2>" +
            '<p class="poster-tagline">' + studio.tagline + "</p></div></div>" +
            '<div class="load-card"><div class="load-inner">' +
            '<div class="spinner" aria-hidden="true"></div>' +
            '<span class="load-label">Preparing ' + studio.name + "…</span>" +
            '<button class="retry" type="button">Retry</button>' +
            "</div></div>";
          room.querySelector(".retry").addEventListener("click", () => {
            delete room.dataset.failed;
            const frame = frames[studio.id];
            if (frame) frame.src = studio.src;
            armReadyWatchdog(studio.id);
          });
          stage.appendChild(room);
          rooms[studio.id] = room;
        }

        function armReadyWatchdog(id) {
          window.clearTimeout(readyTimers[id]);
          readyTimers[id] = window.setTimeout(() => {
            if (!rooms[id].dataset.ready) rooms[id].dataset.failed = "1";
          }, READY_TIMEOUT);
        }

        function ensureFrame(id) {
          if (frames[id]) return frames[id];
          const studio = STUDIOS.find((s) => s.id === id);
          const frame = document.createElement("iframe");
          frame.className = "frame";
          frame.src = studio.src;
          frame.title = "Fractal Brushes — " + studio.name;
          // Insert between poster and load-card so loading UI stays on top.
          rooms[id].insertBefore(frame, rooms[id].querySelector(".load-card"));
          frames[id] = frame;
          armReadyWatchdog(id);
          return frame;
        }

        function post(id, type) {
          const frame = frames[id];
          if (!frame || !frame.contentWindow) return;
          try {
            frame.contentWindow.postMessage({ type }, "*");
          } catch {
            /* frame navigating */
          }
        }

        function focusFrame(id) {
          const frame = frames[id];
          if (!frame) return;
          try {
            frame.contentWindow.focus();
          } catch {
            /* cross-origin under file:// */
          }
          frame.focus();
        }

        /* ---- Activation ---- */
        function activate(id, options = {}) {
          if (!rooms[id] || (id === activeId && !options.force)) {
            if (id === activeId) syncHash(id);
            return;
          }
          const previous = activeId;
          activeId = id;
          ensureFrame(id);
          post(id, "fb:resume");
          for (const studio of STUDIOS) {
            rooms[studio.id].classList.toggle("active", studio.id === id);
          }
          // Pause outgoing studios after the crossfade finishes.
          const delay = reducedMotion.matches || options.instant ? 0 : 420;
          window.setTimeout(() => {
            for (const studio of STUDIOS) {
              if (studio.id !== activeId) post(studio.id, "fb:pause");
            }
          }, delay);
          syncHash(id);
          writeStorage(STORAGE_KEY, id);
          syncOrb();
          if (previous !== null || options.focus !== false) focusFrame(id);
        }

        function syncHash(id) {
          if (location.hash !== "#" + id) {
            history.replaceState(null, "", "#" + id);
          }
        }
        function syncOrb() {
          for (const studio of STUDIOS) {
            orb
              .querySelector(".dot-" + studio.id)
              .classList.toggle("on", studio.id === activeId);
          }
        }

        function hashStudio() {
          const raw = location.hash.replace(/^#/, "");
          return STUDIOS.some((s) => s.id === raw) ? raw : null;
        }

        /* ---- Picker ---- */
        const picks = {};
        for (const studio of STUDIOS) {
          const pick = document.createElement("button");
          pick.type = "button";
          pick.className = "pick";
          pick.dataset.studio = studio.id;
          pick.setAttribute("aria-label", "Open " + studio.name + " studio");
          pick.innerHTML =
            '<span class="pick-caption"><span class="pick-name">' +
            studio.name +
            '<span class="pick-active-dot">● active</span></span>' +
            '<span class="pick-tagline" style="display:block">' +
            studio.tagline +
            "</span></span>";
          pick.addEventListener("click", () => {
            closePicker();
            activate(studio.id);
          });
          pickerCards.appendChild(pick);
          picks[studio.id] = pick;
        }

        function pickerRects() {
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const n = STUDIOS.length;
          if (vw >= 880) {
            const gap = Math.max(20, vw * 0.026);
            const slotW = (vw - gap * (n + 1)) / n;
            const scale = Math.min(slotW / vw, (vh * 0.52) / vh);
            const w = vw * scale;
            const h = vh * scale;
            const totalW = n * w + (n - 1) * gap;
            const x0 = (vw - totalW) / 2;
            const y = (vh - h) / 2 - vh * 0.03;
            return STUDIOS.map((s, i) => ({ x: x0 + i * (w + gap), y, w, h }));
          }
          const gap = 46;
          const topPad = 92;
          const bottomPad = 84;
          const slotH = (vh - topPad - bottomPad - gap * (n - 1)) / n;
          const scale = Math.min(slotH / vh, (vw - 32) / vw);
          const w = vw * scale;
          const h = vh * scale;
          const x = (vw - w) / 2;
          return STUDIOS.map((s, i) => ({ x, y: topPad + i * (h + gap), w, h }));
        }

        function applyPickerLayout() {
          const rects = pickerRects();
          STUDIOS.forEach((studio, i) => {
            const r = rects[i];
            const room = rooms[studio.id];
            room.classList.add("in-picker");
            room.style.transform =
              "translate(" + r.x + "px," + r.y + "px) scale(" + r.w / window.innerWidth + ")";
            const pick = picks[studio.id];
            pick.style.left = r.x + "px";
            pick.style.top = r.y + "px";
            pick.style.width = r.w + "px";
            pick.style.height = r.h + "px";
            if (studio.id === activeId) pick.dataset.active = "1";
            else delete pick.dataset.active;
          });
        }

        function openPicker() {
          if (pickerOpen) return;
          pickerOpen = true;
          for (const studio of STUDIOS) ensureFrame(studio.id);
          document.body.classList.add("picker");
          applyPickerLayout();
          picks[activeId]?.focus();
        }

        function closePicker() {
          if (!pickerOpen) return;
          pickerOpen = false;
          document.body.classList.remove("picker");
          for (const studio of STUDIOS) {
            const room = rooms[studio.id];
            room.classList.remove("in-picker");
            room.style.transform = "";
          }
          focusFrame(activeId);
        }

        orb.addEventListener("click", openPicker);
        document.getElementById("picker").addEventListener("click", (event) => {
          if (event.target.closest(".pick, .picker-foot")) return;
          closePicker();
        });
        window.addEventListener("resize", () => {
          syncCoarse();
          if (pickerOpen) applyPickerLayout();
        });

        /* ---- About ---- */
        const about = document.getElementById("about");
        document.getElementById("about-open").addEventListener("click", () => {
          document.body.classList.add("about-open");
          document.getElementById("about-close").focus();
        });
        function closeAbout() {
          document.body.classList.remove("about-open");
        }
        document.getElementById("about-close").addEventListener("click", closeAbout);
        about.addEventListener("click", (event) => {
          if (event.target === about) closeAbout();
        });

        /* ---- Keyboard & messages ---- */
        window.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            pickerOpen ? closePicker() : openPicker();
          } else if (event.key === "Escape") {
            if (document.body.classList.contains("about-open")) closeAbout();
            else if (pickerOpen) closePicker();
          }
        });

        window.addEventListener("message", (event) => {
          if (!event.data || event.data.type !== "fb:ready") return;
          for (const studio of STUDIOS) {
            const frame = frames[studio.id];
            if (frame && event.source === frame.contentWindow) {
              rooms[studio.id].dataset.ready = "1";
              delete rooms[studio.id].dataset.failed;
              window.clearTimeout(readyTimers[studio.id]);
              if (studio.id !== activeId && !pickerOpen) post(studio.id, "fb:pause");
            }
          }
        });

        window.addEventListener("hashchange", () => {
          const id = hashStudio();
          if (id) activate(id);
        });

        document.addEventListener("visibilitychange", () => {
          if (!activeId) return;
          post(activeId, document.hidden ? "fb:pause" : "fb:resume");
        });

        /* ---- Boot ---- */
        syncCoarse();
        const stored = readStorage(STORAGE_KEY);
        const start =
          hashStudio() || (STUDIOS.some((s) => s.id === stored) ? stored : null) || "luminous";
        activate(start, { instant: true, focus: false });

        window.__fbShell = {
          activate: (id) => activate(id),
          activeId: () => activeId,
          frames: () => Object.keys(frames)
        };
      })();
    </script>
  </body>
</html>
```

Design notes baked into the code above (do not simplify away):
- Iframes are **never reparented or destroyed** — reparenting an iframe reloads it and would lose artwork. The picker scales rooms in place with CSS transforms.
- `src` uses explicit `index.html` paths so opening `index.html` via `file://` still works (a bare `./app/` directory URL has no server to resolve it).
- Opening the picker calls `ensureFrame` for all studios so thumbnails show real canvases (paused studios display their last rendered frame).
- The `fb:ready` handler pauses non-active studios as soon as they load, so a deep-linked boot never leaves a hidden studio animating.

- [ ] **Step 4: Run the shell spec**

Run: `npx playwright test tests/studio-shell.spec.js --reporter=line`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the render-qa suite still passes (it screenshots `/`)**

Run: `npx playwright test tests/render-qa.spec.js --reporter=line`
Expected: If it asserted old landing-page content, update those assertions to the shell contract (`#room-luminous.active`, no console errors) — read the spec before editing and keep its console-error and export checks intact. All other suites are untouched.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/studio-shell.spec.js tests/render-qa.spec.js
git commit -m "feat: studio shell at / with kept-alive studios, picker, and about overlay"
```

---

### Task 4: Switching UX verification & hardening

**Files:**
- Modify: `tests/studio-shell.spec.js` (append a second describe block)
- Modify: `index.html` (only if a test below surfaces a defect)

**Interfaces:**
- Consumes: shell DOM contract and `window.__fbShell` from Task 3; `window.__fbEmbed` from Tasks 1–2.
- Produces: verified guarantees later tasks and docs rely on — state survival across switches, hidden-studio pause, export-through-shell, mobile orb placement, retry card.

- [ ] **Step 1: Append the switching tests**

Add to `tests/studio-shell.spec.js` (same file, after the first describe block):

```js
function luminousFrame(page) {
  return page.frameLocator("#room-luminous iframe");
}

async function litPixels(frame) {
  return frame.locator("canvas").first().evaluate((canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 60) lit += 1;
    }
    return lit;
  });
}

async function drawInLuminous(page) {
  const stage = page.frameLocator("#room-luminous iframe").locator("#stage");
  const opts = (x) => ({
    clientX: x,
    clientY: 300,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    bubbles: true
  });
  await stage.dispatchEvent("pointerdown", opts(200));
  for (let x = 260; x <= 600; x += 60) {
    await stage.dispatchEvent("pointermove", opts(x));
  }
  await stage.dispatchEvent("pointerup", { ...opts(600), buttons: 0 });
  await page.waitForTimeout(600); // let tendrils lay down pigment
}

test.describe("studio switching", () => {
  test("picker switch keeps artwork alive and pauses hidden studio", async ({ page }) => {
    const errors = collectPageErrors(page);
    await openShell(page);
    await expect(page.locator("#room-luminous")).toHaveAttribute("data-ready", "1");

    await drawInLuminous(page);
    const before = await litPixels(page.frameLocator("#room-luminous iframe"));
    expect(before).toBeGreaterThan(50);

    // Switch to ink through the picker UI.
    await page.locator("#orb").click();
    await expect(page.locator("body")).toHaveClass(/picker/);
    await page.locator('.pick[data-studio="ink"]').click();
    await expect(page.locator("#room-ink")).toHaveClass(/active/);
    await expect(page.locator("#room-ink")).toHaveAttribute("data-ready", "1");

    // Hidden luminous studio must be paused (RAF gated).
    await page.waitForTimeout(600);
    const lumFrame = page.frame({ url: /app\/index\.html/ });
    expect(await lumFrame.evaluate(() => window.__fbEmbed.paused)).toBe(true);
    const rafFired = await lumFrame.evaluate(
      () =>
        new Promise((resolve) => {
          let fired = false;
          requestAnimationFrame(() => {
            fired = true;
          });
          setTimeout(() => resolve(fired), 300);
        })
    );
    expect(rafFired).toBe(false);

    // Switch back: artwork still there.
    await page.locator("#orb").click();
    await page.locator('.pick[data-studio="luminous"]').click();
    await expect(page.locator("#room-luminous")).toHaveClass(/active/);
    expect(await lumFrame.evaluate(() => window.__fbEmbed.paused)).toBe(false);
    const after = await litPixels(page.frameLocator("#room-luminous iframe"));
    expect(after).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });

  test("liquid studio exports a PNG via its keyboard shortcut", async ({ page }) => {
    await openShell(page, "/#liquid");
    await expect(page.locator("#room-liquid")).toHaveAttribute("data-ready", "1");
    // Click into the canvas to guarantee frame focus, then use the app's own shortcut.
    await page.frameLocator("#room-liquid iframe").locator("canvas").first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.keyboard.press("p");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/i);
  });

  test("ready watchdog shows retry card when a studio cannot load", async ({ page }) => {
    await page.route("**/white/index.html", (route) => route.abort());
    await openShell(page, "/?readyTimeout=800#ink");
    await expect(page.locator("#room-ink")).toHaveAttribute("data-failed", "1", {
      timeout: 5000
    });
    await expect(page.locator("#room-ink .retry")).toBeVisible();
    // Other studios stay usable.
    await page.locator("#orb").click();
    await page.locator('.pick[data-studio="luminous"]').click();
    await expect(page.locator("#room-luminous")).toHaveAttribute("data-ready", "1");
  });
});

test.describe("studio shell on touch devices", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("orb clears the mobile dock and luminous serves the mobile app", async ({ page }) => {
    await openShell(page);
    await expect(page.locator("body")).toHaveClass(/coarse/);
    const orbBox = await page.locator("#orb").boundingBox();
    // Mobile dock occupies the bottom ~126px; the orb must sit above it.
    expect(844 - (orbBox.y + orbBox.height)).toBeGreaterThan(126);
    // The app's own coarse-pointer redirect should land on the mobile page.
    await page.waitForFunction(() => {
      const f = document.querySelector("#room-luminous iframe");
      return f && f.contentWindow.location.href.includes("/app/mobile/");
    });
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx playwright test tests/studio-shell.spec.js --reporter=line`
Expected: PASS. These tests verify behavior Task 3 already implements; any failure is a real shell defect.

- [ ] **Step 3: Fix any surfaced defects**

Likely culprits if something fails, in order: (a) the luminous app's tutorial overlay intercepting the stroke — confirm `openShell` seeds `fractalBrushes.tutorialSeen` before navigation; (b) the pause happening before the crossfade timer (420 ms) — the test waits 600 ms, keep it; (c) `page.frame({ url })` matching the wrong frame after the mobile redirect — the desktop-viewport tests never redirect. Fix in `index.html` or the spec, re-run until green. If everything passed, skip.

- [ ] **Step 4: Commit**

```bash
git add tests/studio-shell.spec.js index.html
git commit -m "test: studio switching keeps state, pauses hidden studios, exports through shell"
```

---

### Task 5: Branding unification & embedded chrome cleanup

**Files:**
- Modify: `app/index.html`, `app/mobile/index.html`, `white/index.html`, `liquid-mix/index.html` (titles + one embedded-only CSS rule each)
- Modify: `tests/embed-adapter.spec.js` (title + hidden-link assertions)

**Interfaces:**
- Consumes: `html.fb-embedded` class from the adapter.
- Produces: consistent `"Fractal Brushes — <Studio> Studio"` titles; no duplicate home/landing links visible inside the shell.

Context: fonts are already identical across all four apps (same `ui-sans-serif` system stacks), so typography needs no work. The remaining unification is naming and hiding standalone-only chrome when embedded.

- [ ] **Step 1: Extend the embed spec with branding assertions**

In `tests/embed-adapter.spec.js`, add inside the `for (const studio of STUDIOS)` describe block:

```js
    test("has a unified studio title and hides home links when embedded", async ({ page }) => {
      await page.goto(
        `${server.baseUrl}/tests/fixtures/embed-harness.html?src=${studio.route}`
      );
      await page.waitForFunction(() =>
        window.__messages.some((m) => m && m.type === "fb:ready")
      );
      const frame = page.frames()[1];
      expect(await frame.title()).toMatch(/^Fractal Brushes — .+ Studio/);
      const visibleHomeLinks = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('a[href^="../"], a[href="./.."], a[href^="/"]'))
          .filter((a) => a.offsetParent !== null).length
      );
      expect(visibleHomeLinks).toBe(0);
    });
```

- [ ] **Step 2: Run to see which apps fail**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: FAIL on titles (and possibly visible home links) for some apps.

- [ ] **Step 3: Set unified titles**

Find each file's `<title>` (`grep -n "<title>" app/index.html app/mobile/index.html white/index.html liquid-mix/index.html`) and replace with:
- `app/index.html`: `<title>Fractal Brushes — Luminous Studio</title>`
- `app/mobile/index.html`: `<title>Fractal Brushes — Luminous Studio</title>`
- `white/index.html`: `<title>Fractal Brushes — Ink Studio</title>`
- `liquid-mix/index.html`: `<title>Fractal Brushes — Liquid Mix Studio</title>`

- [ ] **Step 4: Hide home/landing links when embedded**

In each of the four files, locate anchors that navigate back to the landing page or between apps (`grep -n 'href="\.\./\|href="/"\|href="\./\.\."' <file>`). Add this rule at the end of each file's `<style>` block (adjust the selector list only if a file uses different home-link markup, e.g. a class — inspect what the grep finds):

```css
      /* Inside the studio shell the shell owns navigation. */
      html.fb-embedded a[href^="../"],
      html.fb-embedded a[href="./.."],
      html.fb-embedded a[href="/"] {
        display: none !important;
      }
```

If a file has no such links, still add the rule (it is inert and keeps the four files consistent).

- [ ] **Step 5: Run the embed spec and the full suite**

Run: `npx playwright test tests/embed-adapter.spec.js --reporter=line`
Expected: PASS (16 tests).
Run: `npx playwright test --reporter=line`
Expected: previously passing suites still pass. If any existing spec asserted an old `<title>`, update that assertion to the new title.

- [ ] **Step 6: Commit**

```bash
git add app/index.html app/mobile/index.html white/index.html liquid-mix/index.html tests/embed-adapter.spec.js
git commit -m "feat: unified studio titles and embedded chrome cleanup"
```

---

### Task 6: Documentation, full-suite QA, and screenshots

**Files:**
- Modify: `README.md` (Routes and Local Usage sections)
- Modify: `AGENTS.md` (Routes and Verification sections)
- Create: `output/shell-luminous.png`, `output/shell-picker.png`, `output/shell-mobile.png` (QA screenshots)

**Interfaces:**
- Consumes: everything above.
- Produces: accurate docs; visual QA evidence.

- [ ] **Step 1: Update README Routes**

Replace the `## Routes` section body in `README.md` with:

```markdown
- `/` - Fractal Brushes Studio: opens straight into your last-used canvas. A floating orb (or `Ctrl/Cmd+K`) opens the studio picker with live previews of all three canvases; artwork, undo history, and simulations stay alive while you switch. Hash deep links: `/#luminous`, `/#ink`, `/#liquid`. The About overlay carries the product story.
- `/app/` - the Luminous canvas (embedded by the shell; also works standalone).
- `/app/mobile/` - lightweight touch-first Luminous canvas served automatically to phones and small tablets. `/app/?desktop=1` opts back into the desktop app for the session.
- `/white/` - the Ink canvas, white-paper colored-ink and watercolor studio (embedded by the shell; also works standalone).
- `/liquid-mix/` - the Liquid Mix canvas, WebGL fluid-dynamics water studio (embedded by the shell; also works standalone).
```

Also update the `## Local Usage` paragraph that says "open `/app/` for the luminous drawing experience" to mention that `/` now opens the studio shell directly, and standalone routes remain available.

- [ ] **Step 2: Update AGENTS.md**

In the `## Routes` section, replace the root line with:

```markdown
- Root studio shell: `index.html` (hosts the three studios in kept-alive iframes; hash routes `#luminous`, `#ink`, `#liquid`)
```

In `## Verification`, add:

```markdown
- Confirm the studio shell: `/` boots into a studio, switching preserves canvas state, hidden studios pause (`tests/studio-shell.spec.js`, `tests/embed-adapter.spec.js`).
```

- [ ] **Step 3: Run the complete Playwright suite**

Run: `npx playwright test --reporter=line`
Expected: all suites pass (embed-adapter 16, studio-shell 9, plus every pre-existing spec).

- [ ] **Step 4: Capture QA screenshots**

Write and run a throwaway script (scratchpad, not committed) that uses the static server + Playwright to capture:
- `output/shell-luminous.png` — `/` at 1280×800 after `data-ready`.
- `output/shell-picker.png` — same page with the picker open (click `#orb`, wait 500 ms).
- `output/shell-mobile.png` — `/` at 390×844 with `hasTouch: true, isMobile: true`.

Visually inspect all three: picker cards evenly spaced with readable captions, orb not overlapping app controls, mobile orb above the dock, no blank frames.

- [ ] **Step 5: Commit**

```bash
git add README.md AGENTS.md output/shell-luminous.png output/shell-picker.png output/shell-mobile.png
git commit -m "docs: studio shell routes, verification notes, and QA screenshots"
```

---

## Self-review notes

- **Spec coverage:** shell/entry (Task 3), embed protocol + pause/resume (Tasks 1–2), switcher/transitions/live previews/focus (Tasks 3–4), design unification (Task 5 — narrowed to titles/chrome because fonts are already identical), mobile (Task 4 touch tests + orb placement), error handling/retry card (Tasks 3–4), performance/lazy creation (Task 3 code + boot test asserting a single iframe), testing (throughout), docs (Task 6). Deferred items from the spec (cross-studio transfer, reload persistence, renderer merge) are intentionally absent.
- **Known limitation (accepted):** `Ctrl/Cmd+K` only works while the shell has focus; when an iframe has focus the orb is the affordance. Documented in README wording ("floating orb (or Ctrl/Cmd+K)").
- **Type consistency:** message types `fb:ready`/`fb:pause`/`fb:resume`, storage key `fractalBrushes.studio`, room/orb/pick selectors, and `window.__fbEmbed`/`window.__fbShell` shapes are identical across all tasks.
