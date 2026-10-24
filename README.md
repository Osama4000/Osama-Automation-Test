# Osama Automation Test

A local-only productivity toolkit for radiology administration: a PDF editor for forms and
signatures, a quick-reply library, an email composer with dynamic variables, and a small
workspace (queue, tasks, handover, links, notes).

There is no backend, no login and no analytics. PDFs, images and typed details are processed
in the browser and never uploaded.

## Features

### PDF Editor
- Open a PDF by button or drag-and-drop. Files are validated, and damaged, password-protected or oversized (over 200 MB) files fail with a clear message.
- **Add text** in real PDF points (default 10 pt, presets 8–24 pt). Choose the font (Helvetica/Arial, Times, Courier), bold, italic, colour, alignment and line spacing, with multi-line text and an optional background fill (off by default). "Shrink to fit box width" is also available.
- **Replace printed text**: click a line of existing text to edit it. On save, the original glyphs are removed from that spot (MuPDF redaction, text only; borders and shading are kept) and the new text is drawn at the same baseline and size.
- **Fill native form fields** (text, checkboxes, radio buttons, dropdowns).
- **Signatures and images**: upload PNG (transparency preserved) or JPEG (rotation from phone photos is corrected), draw a signature, make a white background transparent, re-use any signature inserted in this session, or keep an optional on-device library.
- **Marks**: tick, cross, dot, box and whiteout. Whiteout is a visual cover only; the text underneath is not removed.
- **Editing**: corner handles (signatures keep proportions by default), X/Y fields, arrow-key nudging, bring forward/send back, duplicate, copy to other pages (e.g. `2-4, 6`), delete, undo/redo (100 steps).
- **Navigation**: thumbnails, page number box, zoom (50–300 %, fit width, fit page, Ctrl+wheel).
- A one-tick **pre-save review** runs before each save. It can be switched off under Document → "Ask for a review before saving". The output is `<original name>_edited.pdf`.
- **"Restrict editing" PDFs** (owner password only) can be edited and saved; the saved copy is unrestricted. PDFs that need a password to *open* are not supported.
- Unsaved edits are kept in this browser tab's session storage, so an accidental reload can be recovered. They are cleared when the tab closes or the file is saved.

**Shortcuts**: `Ctrl+K` quick find (any tab) • `V` select • `T` add text • `Esc` deselect / cancel drag • `Del` delete • arrows nudge 1 pt (Shift = 10 pt) • `Ctrl+D` duplicate • `Ctrl+C/V` copy/paste item • `Ctrl+Z / Ctrl+Y` undo/redo • `Ctrl+S` save • `Ctrl+= / Ctrl+−` zoom • `PgUp/PgDn` pages.

**Signature controls**: drag to move. The grab point stays under the cursor, even if you scroll with the mouse wheel while holding it. Drag a corner to resize. Release anywhere, even outside the window, and the drag ends cleanly. Press `Esc` mid-drag to put the item back where it was.

### Quick Replies
- 18 built-in replies, including these four, verbatim: **Fortius Escalation**, **Queen Square Escalation**, **Patient Contact and Booking**, and **Clinic List Request**. A gender-neutral variant of the third is also included.
- Categories, search (all words must match), favourites, recently used, and one-click copy.
- Fill-in fields with live preview. Unfilled placeholders are highlighted, and copying with empty fields asks for confirmation first.
- **Current patient bar**: shows the details in use, with **Clear details** and an optional **Clear after copying**. If the details were typed for a different message, the reply shows a "Check the patient" warning and asks before copying. One-click Copy never reuses them silently.
- **Keyboard**: in the search box, ↑↓ choose a reply and Enter jumps to its first empty field. Enter moves between fields, and `Ctrl+Enter` copies the message (`Ctrl+Shift+Enter` copies subject + message). `Ctrl+K` from any tab finds a reply: Enter copies it, or opens it if it has fields to fill in.
- Create, edit, duplicate and delete your own replies. Built-in replies can be edited and later restored individually or all at once with **Reset built-ins**. Your custom replies are never touched by a reset.
- Replies that say an action has happened (escalated, booked, contacted) or that a file is attached show a reminder to send them only when that is true.

### Email Composer
- Start from any reply or a blank message, then edit the subject and body.
- Insert placeholders, greetings and sign-offs.
- Tidy tools: trim spaces, fix line breaks, Title Case, clean pasted text, and convert dates to the chosen format.
- Copy the subject, the message, or both.
- **Scan type shortcuts** (MRI, CT, Ultrasound, X-ray, PET-CT, DEXA, Fluoroscopy) are editable. You can also type any custom value.
- Date formats include `28/10/2026`, `28 October 2026` and `Wednesday 28 October 2026`. Time can be 24 h or 12 h.
- **Clinic list assistant**: pick a date, an optional clinic and an optional consultant to generate a "sending" or "requesting" email. "Please find attached" is only used when you tick the attachment box. It never changes the patient details used by other replies.
- **My details** (your name, department, number, clinic) is used in sign-offs. It is stored only if you tick "Remember my details".

### Email variables

| Placeholder | Meaning |
|---|---|
| `{patient_name}` | Patient name |
| `{patient_first_name}` | First name (filled automatically from the full name, skipping titles, unless typed) |
| `{date}` (also `{Date}`, `{appointment_date}`) | Date, in the chosen format |
| `{time}` (also `{appointment_time}`) | Time, 24 h or 12 h |
| `{scan_type}` (also `{scan}`) | Scan type |
| `{location}`, `{clinic_name}`, `{consultant_name}`, `{reference_number}` | Optional details |
| `{sender_name}`, `{department}`, `{contact_number}` | Your sign-off details |

Placeholders are matched case-insensitively. The legacy `{{name}}` syntax from earlier versions still works. Text such as `{1}` or `{ see attached }` is never treated as a variable. Unknown placeholders are left exactly as typed, and the editor warns about them.

### Workspace
Dashboard (with favourite and recent replies), Work Queue with follow-ups and checklists, Daily Tasks (recurring, carry-forward), Shift Handover generator, Quick Links, Quick Notes, workspace search, dark and compact modes, and JSON backup/restore (saved signatures are included only if you choose to include them).

## Privacy
- PDFs, images and typed patient details stay in the browser. Nothing is sent to a server.
- Values typed into reply/composer fields (patient name, dates, references) are kept in memory only. They are never stored or put in URLs.
- What is stored locally (`localStorage`): template text, favourites and recent ids, workspace modules, preferences, and optionally your own sign-off details.
- Signatures are stored (IndexedDB) only when you explicitly save one to the library.
- Do not store patient-identifiable information in the queue, tasks or notes unless your organisation has approved it.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173
npm run lint         # ESLint
npm test             # unit tests (Vitest)
npm run test:e2e     # browser interaction tests (Playwright; first run: npx playwright install chromium)
npm run test:prod    # production build + Vercel security headers smoke test
npm run build        # production build to dist/
npm run preview      # serve the production build
npm run check        # lint + unit tests + build
```

Test documents are generated with fictional data by `tests/fixtures/make-fixtures.js`.

### Deployment
The app is deployed on Vercel as a static Vite site (build command `npm run build`, output `dist/`). No environment variables are required. `vercel.json` adds security headers. The Content-Security-Policy only allows the app to talk to its own origin, so no document or patient data can be sent anywhere else. If you add an external resource in future, the CSP must be updated. Vite targets `esnext` because MuPDF's WASM loader uses top-level await. MuPDF (~10 MB) is loaded only when a document with replaced printed text is saved.

## Project structure
```
src/main.js              app shell, tabs, modal handling
src/pdf/editor.js        PDF editor UI, rendering, pointer interaction
src/pdf/geometry.js      coordinate model, text layout, font metrics (shared by preview + export)
src/pdf/export.js        builds the edited PDF (pdf-lib + MuPDF)
src/pdf/signatureStore.js optional on-device signature library (IndexedDB)
src/email/templateEngine.js  variable engine
src/email/builtins.js    built-in replies
src/email/store.js       reply persistence (built-in overrides + custom)
src/email/ui.js          Quick Replies, Composer, Clinic list assistant
src/workspace.js         dashboard, queue, tasks, handover, links, notes, search, backup
src/lib/                 DOM and text/date helpers
tests/unit, tests/e2e    Vitest and Playwright suites
```

## Known limitations
- Added text uses the standard PDF fonts (Helvetica, Times, Courier). Characters outside Western European (WinAnsi) encoding, such as `Ł` or `→`, are simplified on save, and the editor warns when this happens.
- Replacing printed text works on horizontal text lines. Rotated or vertical text cannot be edited inline. Use whiteout plus new text instead.
- Whiteout is a visual cover, not redaction. For secure redaction of sensitive content, use dedicated redaction software.
- PDFs that need a password to open must be unlocked in other software first. Saving any PDF rewrites it, so existing digital signatures in the file become invalid.
- Signatures cannot be rotated.
- The editor shows one page at a time; use the thumbnails or page box to move between pages.
- The date picker's display format follows the browser/OS locale. The message always uses the format chosen in the composer.
