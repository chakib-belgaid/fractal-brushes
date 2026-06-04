# Polish Backlog

Project closer audit for Fractal Brushes. Scope is the static GitHub Pages package: `/`, `/app/`, and the already-published `/white/` route.

## Completed In This Closeout

| Severity | File or component | User-visible symptom | Proposed fix | Verification method | Status |
| --- | --- | --- | --- | --- | --- |
| high | `app/index.html` mobile canvas and brush renderer | On phones, the drawing surface was crowded by the zoom slab and detailed brush renderers could feel heavy or overactive during touch strokes. | Hide the redundant mobile zoom slab, move the dock away while actively painting, add immediate touch-rail feedback, and use a batched mobile renderer for symmetric brush layers. | New touch-device Playwright regression plus final 390px/320px screenshots and full Playwright suite. | Done |
| medium | `app/index.html` canvas startup | Default canvas was auto-painted by the showcase seed, so the drawing surface no longer opened empty. | Remove startup seeding and keep demo painting scoped to the walkthrough action only. | Playwright smoke checks that default canvas has no luminous stroke pixels before user input. | Done |
| medium | `app/index.html` tutorial demo | The walkthrough's Paint demo uses backing-pixel center values after the expanded-canvas patch, so demo strokes can be off-center on high-DPR viewports. | Use CSS canvas dimensions for tutorial/demo path coordinates. | Tutorial Playwright suite plus screenshot/manual pixel check. | Done |
| medium | `app/index.html` export menu/status | Large PNG export gives no immediate progress feedback after the menu closes. | Show an export-preparing status, mark export controls busy, and keep disabled state synchronized. | Playwright export smoke checks and no console errors. | Done |
| medium | `tests/render-qa.spec.js` route coverage | The README advertises `/white/`, but the closeout smoke test only screenshots `/` and `/app/`. | Add a minimal ink-route render/export smoke check with console-error capture. | `playwright test tests/render-qa.spec.js` and full suite. | Done |
| low | `app/index.html` mobile screenshot polish | Mobile first view should preserve a clean drawing surface until the user paints. | Keep drawers usable without painting the canvas automatically. | 390px screenshot, overflow checks, no console errors. | Done |

## Verified Existing Behavior

| Severity | File or component | User-visible symptom | Proposed fix | Verification method | Status |
| --- | --- | --- | --- | --- | --- |
| blocker | Primary toolbar interactions | Potential dead controls: undo, redo, export, clear, mirror, brush/color/params, randomize, help. | Existing implementations are wired; keep tests green while polishing. | Existing Playwright suite clicks controls and export paths. | Passed before edits |
| high | Desktop and mobile responsiveness | Floating panels could overflow or block controls on 390px/desktop layouts. | Existing drawer/dock behavior is kept; smoke tests verify key controls remain inside viewport. | Existing `render-qa`, `tutorial`, and panel drag specs. | Passed before edits |
| medium | Motion and feedback | Hover, active, focus, selected, disabled, and status states could be absent. | Existing CSS states are present; only export busy state needs strengthening. | Visual screenshot inspection and Playwright assertions. | Mostly passed |
| medium | Performance | Expanded canvas and particles could exceed mobile budgets. | Existing DPR/pixel caps and mobile CSS patch are preserved. | Existing brush density, silk feel, and render specs. | Passed before edits |

## Remaining Non-Blocking Weaknesses

| Severity | File or component | User-visible symptom | Proposed fix | Verification method | Status |
| --- | --- | --- | --- | --- | --- |
| low | `app/index.html` large inline script | The app is dependency-free but the single HTML file is hard to maintain. | Leave as-is for GitHub Pages simplicity; split only if maintenance becomes a real constraint. | Not applicable for showcase closeout. | Deferred |
| low | Browser support matrix | Advanced CSS such as `oklch()` and `color-mix()` may degrade in older browsers. | Keep modern-browser target; add fallbacks later only if analytics/support needs demand it. | Manual browser matrix if required. | Deferred |
