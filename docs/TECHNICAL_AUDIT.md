# Technical audit — V10 → V11

## Original state
- Vanilla JS + Vite 6.1. pdf.js renders, pdf-lib exports, and MuPDF WASM removes text for "replace printed text".
- The whole app was one minified-style `src/main.js` (75 KB, 247 lines). There were no tests, linter or git history in the delivered folder.
- Later versions patched earlier ones by reassigning handlers (`rawPdfSave`, `oldExportBackup`, `baseRenderDashboard`), which made behaviour hard to follow.

## Root causes of the reported PDF bugs

### Signature jumps when scrolling during a drag
`o.x = ox + (clientX - startX) / zoom` uses *screen* deltas. Scrolling moves the page under a stationary cursor without producing a `pointermove`, so the object stayed at its old page position while the cursor pointed elsewhere. The next move then added only the screen delta, which left a permanent offset (the "jump").

Several things made it worse:
- `<img>` elements were natively draggable, so the browser's HTML5 drag could take over the gesture and fire `pointercancel`.
- There was no `pointercancel`/`lostpointercapture` handling, so drags could get stuck.
- Pointer capture was held by an element that re-renders replaced.

**Fix**: one drag session is captured on the stage. Each update converts the last pointer position to *page points* (`(clientX - stageRect.left) / scale`) and subtracts the grab offset. The same update runs on the scroll container's `scroll` event. Images use `draggable=false`, and there is a 3 px threshold before a drag starts. Cleanup runs on up, cancel, lost capture, blur and Escape.

### Disproportionately large text
- New text defaulted to 16 pt, while forms typically use 9–11 pt.
- Merged runs of existing text took `Math.max` of the font sizes, so a label next to a heading inherited the heading size.
- The preview used `system-ui` while the export used Helvetica, with different baselines (export `y = top + size`, preview: CSS line box) and line heights (1.1 vs 1.15).
- "Fit to box" shrank text only in the export.

**Fix**: `layoutText()` in `geometry.js` is the single layout used by both preview and export. Widths come from pdf-lib's AFM metrics (Arial is metric-compatible with Helvetica). The baseline comes from the browser's real font metrics, with a sub-pixel correction because browsers snap baselines to whole pixels. Tests confirm the exported size equals the chosen size, and the on-screen baseline is within 0.25 pt of the exported one.

### Unwanted rectangles behind text
- Focused text boxes painted `#ffffffcc` with a blue border.
- Tools were sticky, so every extra click with Whiteout created another white box that was exported.
- Replaced text showed the original underneath while editing.

**Fix**: text is transparent and outlines exist only in the DOM. Tools revert to Select after one placement. An editor-only mask (sampled paper colour) hides text that will be removed on save. A background is drawn only when explicitly enabled.

### Export coordinates
The export used `pageHeight - y` with the MediaBox height, ignoring `/Rotate` and the CropBox origin.

**Fix**: `viewportTransform()` reproduces pdf.js's viewport matrix, which is verified against pdf.js for 0/90/180/270° and offset boxes. Objects are mapped through its inverse, and text and images are drawn with the page rotation.

## Other issues fixed
- Global keyboard handler: it acted on PDF objects from any tab, and Ctrl+Z inside any textarea ran PDF undo and blocked native undo.
- `todayKey()` used `toISOString()`, a UTC date.
- Backup "include signatures" looked for signatures in localStorage, but they live in IndexedDB.
- Render race: there was no cancellation of the previous pdf.js render task.
- Thumbnails rendered every page on open, and in-progress thumbnails from a previous file could appear in a new one.
- Non-WinAnsi characters crashed pdf-lib.
- No file validation or error handling on open, and no protection against double saves.
- Recovery data containing typed patient text persisted in `localStorage` indefinitely. It now uses `sessionStorage`.
- MuPDF (10 MB) was loaded on startup. It is now dynamically imported on save.
- Dependency advisories: Vite 6.1 (dev-server). Now 0 known vulnerabilities (`npm audit`).

## Post-review fixes (11.1)
A second review found ten issues with adversarial probes (scripts run outside the project). All are fixed and covered by `tests/e2e/review-fixes.spec.js` and new unit tests:
- Shared email variables carried a previous patient's details into other replies. The fix tracks which message the details were typed for (`detailsContext` in `email/ui.js`) and adds a warning, a confirm on copy, and a patient bar.
- pdf-lib refuses owner-password PDFs, so `removeRestrictions()` in `export.js` rewrites them with MuPDF `encrypt=none`.
- pdf.js painted form-widget appearances under our HTML inputs. The page now renders with `AnnotationMode.ENABLE_FORMS` while the overlay is on.
- `drawLayers()` detached the focused textarea. It now keeps the element being edited in place.
- Image `src` from IndexedDB or backups was interpolated unescaped. `safeImageSrc()` now validates it.
- Bold was never detected: pdf.js text content exposes only an internal font id. The font object is now read from `page.commonObjs`.
- Vite pre-bundled `mupdf`, which separated it from its `.wasm` file in dev. It is now in `optimizeDeps.exclude`.

## Verification
- `npm test`: 68 unit tests covering the template engine, the store, text/date utilities, geometry against pdf.js, and export round-trips. The export tests re-open the PDF with pdf.js and check font size, baseline, image rectangle and transparency on portrait, landscape, rotated and cropped pages, plus MuPDF text removal.
- `npm run test:e2e` and `npm run test:prod`: 33 Playwright tests in Chromium, including the production build under the Vercel security headers. They cover dragging at 50/100/150/200 %, wheel-scroll while holding, wheel while selected, release outside, Escape cancel, resize aspect, nudge, undo/redo, page switching, export, invalid files, replies and composer with real clipboard reads, XSS safety, and workspace smoke tests.
- Not automated: Firefox/Safari, touch/pen devices, very large real-world PDFs, and the user's own production documents.
