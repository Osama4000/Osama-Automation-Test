# Changelog

## 11.1.0 — 2026-10-25 (post-review fixes)

### Fixed
- **Wrong-patient risk (IMP-02)**: patient details typed for one reply used to fill and copy silently into the next one. A "Details in use" bar now shows the current patient, with **Clear details** and an optional **Clear after copying**. Replies opened with details typed for a different message show a "Check the patient" warning and ask before copying. One-click Copy no longer copies another message's details.
- **Clinic list assistant (B6)** no longer overwrites the patient date shared by the other email tools.
- **"Restrict editing" PDFs (IMP-03)**: files with an owner password only used to fail at the very end of saving. They now save, with a note that the saved copy is unrestricted. Files that need a password to open still give a clear message.
- **Doubled form-field text (IMP-04)**: pre-filled fields were drawn twice (the PDF's own appearance plus the editable box).
- **Script injection via signature library (IMP-05)**: image sources are now strictly validated and escaped, and backups are checked on import.
- **Typing lost on resize/zoom (IMP-06)**: redrawing the page no longer destroys the text box being edited, so typing survives window resizes, zoom and tablet keyboards.
- **Large photos (IMP-07)** are scaled to a maximum of 1600 px on insert. If a document becomes too large for automatic recovery, you are now told instead of it failing silently.
- **Dialogs (IMP-08)**: an accidental click outside a dialog, or Escape, now asks before discarding typed text or a drawn signature.
- **Bold text (IMP-11)**: replacing bold or italic printed text keeps the style. A note appears when the original font cannot be used.
- An empty text box was left behind when changing page. Thumbnail "•" edit markers went stale. Re-saving an edited file produced `_edited_edited.pdf` (IMP-17).
- MuPDF failed to load under `npm run dev` because of Vite pre-bundling (production builds were unaffected).

### Added
- **Faster saving (IMP-10)**: the pre-save review is one tick, can be confirmed with Enter, and can be switched off ("Ask for a review before saving").
- **Keyboard flow (IMP-12)**:
  - In Quick Replies, ↑↓ choose a reply and Enter jumps to its first empty field. Enter moves between fields, and Ctrl+Enter copies (Ctrl+Shift+Enter copies subject + message).
  - **Ctrl+K quick find** works from any tab: Enter copies a reply, or opens it if it has fields to fill in.
- The "only send if true" reminder can be hidden (IMP-17).
- **Security headers (IMP-09)** in `vercel.json`: CSP with `connect-src 'self'` (nothing can be sent elsewhere), no framing, no referrer, nosniff, and a permissions policy. `npm run test:prod` checks the production build under these headers.
- `engines.node >= 20` in package.json.

## 11.0.0 — 2026-10-25

### Fixed — PDF editor
- **Signature/image dragging**: dragging is now computed from the pointer's page position on every move and every scroll, so scrolling with the wheel while holding an item no longer makes it jump or drift. Native browser image-dragging is disabled, and drag state is always cleaned up after release (including outside the window), `pointercancel`, window blur, or Escape (which reverts).
- **Oversized text**: new text defaults to 10 pt rather than 16 pt. Replaced printed text keeps its own size: adjacent runs of different sizes are no longer merged with the largest size. Sizes are real PDF points at every zoom level.
- **Preview ≠ export**: the preview and the export share one layout engine (same font metrics, baseline, line spacing and fit-to-box shrinking). Previously the preview used the system UI font and never applied fit-to-box.
- **Unwanted rectangles**: text boxes no longer paint a white background while editing. Placement tools switch back to Select after one use, so repeated clicks no longer drop extra whiteout boxes. Backgrounds are drawn only when "Background fill" is turned on.
- **Rotated / cropped pages**: the export now handles `/Rotate` and CropBox offsets. Text and images used to land in the wrong place, or sideways, on such pages.
- Characters not supported by the standard PDF fonts (e.g. `Ł`) used to crash the save. They are now simplified, with a warning.
- Opening damaged, non-PDF or password-protected files shows a clear message instead of failing silently.
- Overlapping renders, stale thumbnails and double-saves are prevented.

### Fixed — app-wide
- Ctrl+Z / Delete / arrow keys in other tabs or text fields no longer trigger PDF editor actions.
- "Today" used a UTC date, which was wrong just after midnight in BST. It now uses the local date.
- The backup "include signatures" option exported nothing, because signatures live in IndexedDB. It now includes and restores them.
- Copy actions reported success even when the copy failed. A clipboard fallback and accurate feedback were added.
- Follow-up dates used a free-text prompt. They now use a date/time picker dialog.
- Links from imported backups are only made clickable if they are http(s).

### Added
- Quick Replies: 18 built-ins (including the four required replies), categories, search, favourites, recently used, editing with per-reply and global reset, duplicate, and custom replies.
- Template engine with `{patient_name}`, `{date}`/`{Date}`, `{time}`, `{scan_type}` and more. It offers live preview, missing-value warnings, unknown-placeholder warnings, date and time formats, and legacy `{{…}}` support.
- Email Composer: insert placeholders, greetings and sign-offs, tidy tools, editable scan-type shortcuts, a clinic list assistant, and copy subject/message/both.
- PDF editor: font family, bold/italic, colour, alignment, line spacing, size presets, optional background, four-corner resize, X/Y position, arrange, copy to pages, a drawn signature, a white-to-transparent tool, session signature re-use, fit width/page, Ctrl+wheel zoom, a page number box, and lazy thumbnails.
- Unit tests (Vitest) and browser interaction tests (Playwright), plus ESLint.

### Changed
- MuPDF (10 MB WASM) loads only when needed, instead of on every page load.
- pdf.js standard fonts are served locally, so forms with non-embedded fonts render accurately.
- Crash-recovery data uses session storage instead of persistent local storage.
- Vite updated to 6.4.5, which fixes a dev-server advisory.
- Code split from one 75 KB file into focused modules.
