# Agent Notes

Fractal Brushes is a static GitHub Pages package.

## Routes

- Root landing page: `index.html`
- Interactive app: `app/index.html`

## Constraints

- Keep the project dependency-free unless a clear product need appears.
- Preserve static GitHub Pages compatibility.
- Do not move the app route away from `/app/` without updating README and workflow notes.
- Do not create a remote repository or push to GitHub without explicit approval.
- Keep `.nojekyll` so GitHub Pages serves static files directly.
- Verify browser rendering after visual changes.

## Verification

- Use Playwright for web interface testing.
- Check both `/` and `/app/` after UI or routing changes.
- Confirm there are no console errors.
- Confirm controls remain usable on desktop and mobile widths.
- Confirm export actions do not crash and create PNG download URLs.
