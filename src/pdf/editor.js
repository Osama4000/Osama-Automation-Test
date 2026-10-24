// PDF editor: rendering (pdf.js), object editing, pointer interaction and saving.
//
// Key design points (see docs/TECHNICAL_AUDIT.md):
// - Objects are stored in "view points" (PDF points, top-left origin of the displayed page).
//   The DOM shows them at `scale` CSS px per point; nothing is ever stored in CSS pixels.
// - Dragging/resizing uses one pointer session captured on the stage. Positions are recomputed
//   from the pointer's *page* position on every move AND every scroll, so wheel-scrolling while
//   holding an object keeps it attached to the cursor instead of jumping.
// - Selection outlines/handles exist only in the DOM; the export draws objects from data.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { $, $$, esc, toast, downloadBlob, isTypingTarget, safeImageSrc, readLocal, writeLocal } from '../lib/dom.js';
import {
  FONT_FAMILIES, FONT_SIZE_PRESETS, DEFAULT_TEXT_SIZE, LINE_HEIGHTS, DEFAULT_LINE_HEIGHT, MIN_FONT_SIZE, MAX_FONT_SIZE,
  layoutText, fontMetrics, normalizeFamily, clamp, clampToPage, parsePageRanges, resizeFromHandle, sanitizeForPdf, roundTo,
} from './geometry.js';
import { buildEditedPdf, isUnchangedReplacement, TEXT_TYPES } from './export.js';
import { createSignatureStore } from './signatureStore.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const PX_PER_PT = 96 / 72;
const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MIN_SCALE = 0.25 * PX_PER_PT, MAX_SCALE = 4 * PX_PER_PT;
const MAX_PDF_BYTES = 200 * 1024 * 1024, WARN_PDF_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600; // px; plenty for a signature printed at a few centimetres
export const PDF_PREF_KEY = 'osama-automation-pdf-prefs-v1';
const DRAG_THRESHOLD_PX = 3;
const HISTORY_LIMIT = 100;
const STANDARD_FONTS_URL = `${import.meta.env?.BASE_URL ?? '/'}pdfjs/standard_fonts/`;

export const PDF_HEADER_ACTIONS = `<div id="pdfHeaderActions"><label class="open btn">Open PDF<input id="pdfInput" type="file" accept="application/pdf,.pdf" hidden></label><button id="save" class="primary" disabled>Save PDF</button></div>`;

export const PDF_PANEL = `<div class="shell" id="pdfPanel">
<aside class="pdfSide" aria-label="PDF tools">
  <div class="sideSection">
    <div class="toolGrid" role="toolbar" aria-label="Editing tools">
      <button data-tool="select" class="active" title="Select, move and edit (V). Click printed text to replace it.">↖ Select</button>
      <button data-tool="text" title="Click on the page to add text (T)">T Add text</button>
      <button id="addImage" class="span2" title="Insert a signature or image (PNG or JPEG)">✍ Signature / image…</button>
      <button id="drawSignature" class="span2" title="Draw a signature with the mouse or a pen">✎ Draw signature…</button>
      <button data-tool="check" title="Tick mark">✓ Tick</button>
      <button data-tool="xmark" title="Cross mark">✕ Cross</button>
      <button data-tool="radio" title="Filled dot">● Dot</button>
      <button data-tool="rect" title="Outline box">□ Box</button>
      <button data-tool="whiteout" class="span2" title="Covers content with a white box. The text underneath is NOT removed from the file.">▭ Whiteout (visual cover)</button>
    </div>
    <input id="imageInput" type="file" accept="image/png,image/jpeg" hidden>
  </div>

  <div class="sideSection" id="selectionPanel">
    <div class="panelTitle">Selected item</div>
    <div id="selectedType" class="mini">Nothing selected. Click an item on the page to select it.</div>
    <div id="textControls" class="selectedControls" hidden>
      <label class="field">Font<select id="fontFamily">${Object.entries(FONT_FAMILIES).map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join('')}</select></label>
      <div class="field"><span>Size (pt)</span><div class="numberRow"><button id="fontMinus" type="button" title="Smaller (0.5 pt)" aria-label="Smaller text">−</button><input id="fontSize" type="number" min="${MIN_FONT_SIZE}" max="${MAX_FONT_SIZE}" step="0.5" aria-label="Font size in points"><button id="fontPlus" type="button" title="Larger (0.5 pt)" aria-label="Larger text">+</button></div>
      <div class="chips" id="sizePresets">${FONT_SIZE_PRESETS.map(s => `<button type="button" data-size="${s}">${s}</button>`).join('')}</div></div>
      <div class="inlineRow">
        <button id="boldBtn" type="button" class="toggle" title="Bold" aria-pressed="false"><b>B</b></button>
        <button id="italicBtn" type="button" class="toggle" title="Italic" aria-pressed="false"><i>I</i></button>
        <label class="colorPick" title="Text colour"><input id="textColor" type="color" value="#000000" aria-label="Text colour"></label>
        <span class="seg" role="group" aria-label="Alignment"><button type="button" data-align="left" title="Align left">⯇</button><button type="button" data-align="center" title="Centre">≡</button><button type="button" data-align="right" title="Align right">⯈</button></span>
      </div>
      <label class="field">Line spacing<select id="lineHeight">${LINE_HEIGHTS.map(v => `<option value="${v}">${v.toFixed(2).replace(/0$/, '')}</option>`).join('')}</select></label>
      <div class="inlineRow"><label class="switch"><input id="bgOn" type="checkbox"> Background fill</label><input id="bgColor" type="color" value="#ffffff" aria-label="Background colour"></div>
      <label class="switch" title="Shrink the text so it never exceeds the box width"><input id="fitToggle" type="checkbox"> Shrink to fit box width</label>
      <div id="charWarning" class="warnNote" hidden></div>
      <div id="fontNote" class="infoNote" hidden></div>
    </div>
    <div id="imageControls" class="selectedControls" hidden>
      <div class="sizeGrid"><label>W<input id="objWidth" type="number" min="4" step="1" aria-label="Width in points"></label><label>H<input id="objHeight" type="number" min="4" step="1" aria-label="Height in points"></label></div>
      <label class="switch"><input id="lockAspect" type="checkbox" checked> Keep proportions</label>
      <button id="whiteToClear" type="button" title="Turn the white paper background of a scanned/photographed signature transparent">Make white background transparent</button>
      <button id="savePresetFromSel" type="button" title="Store this image in this browser for future documents">Save to signature library…</button>
    </div>
    <div id="objControls" class="selectedControls" hidden>
      <div class="sizeGrid"><label>X<input id="objX" type="number" step="0.5" aria-label="X position in points"></label><label>Y<input id="objY" type="number" step="0.5" aria-label="Y position in points"></label></div>
      <div class="nudge" aria-label="Nudge"><span></span><button type="button" data-nudge="0,-1" title="Up 1 pt">↑</button><span></span><button type="button" data-nudge="-1,0" title="Left 1 pt">←</button><button type="button" data-nudge="0,1" title="Down 1 pt">↓</button><button type="button" data-nudge="1,0" title="Right 1 pt">→</button></div>
      <div class="row"><button id="sendBackward" type="button" title="Send backward">⤓ Back</button><button id="bringForward" type="button" title="Bring forward">⤒ Forward</button></div>
      <div class="row"><button id="duplicate" type="button" title="Duplicate (Ctrl+D)">⧉ Duplicate</button><button id="applyPages" type="button" title="Copy this item to other pages">Copy to pages…</button></div>
      <button id="delete" type="button" class="dangerText" title="Delete (Del)">🗑 Delete</button>
    </div>
  </div>

  <div class="sideSection">
    <div class="panelTitle">Signatures</div>
    <div id="sessionSigs" class="sigList"><div class="mini">Signatures you insert are listed here for re-use in this session only.</div></div>
    <details id="savedSigsBox"><summary>Signature library (this device)</summary>
      <p class="mini">Saved only in this browser's storage. Nothing is uploaded. Use on authorised devices only.</p>
      <input id="sigSearch" class="sideInput" placeholder="Search saved signatures" aria-label="Search saved signatures">
      <div id="presets" class="sigList"></div>
      <button id="savePreset" type="button">+ Add signature image to library…</button>
    </details>
  </div>

  <div class="sideSection">
    <div class="panelTitle">Document</div>
    <label class="switch"><input id="existingText" type="checkbox" checked> Click printed text to replace it</label>
    <label class="switch"><input id="nativeFields" type="checkbox" checked> Show fillable form fields</label>
    <label class="switch"><input id="askReview" type="checkbox" checked> Ask for a review before saving</label>
    <div id="info" class="mini"></div>
    <details class="help"><summary>Shortcuts &amp; tips</summary>
      <ul>
        <li><b>Drag</b> an item to move it. Scrolling while dragging keeps it under the cursor.</li>
        <li><b>Corner handles</b> resize; signatures keep proportions.</li>
        <li><b>Arrows</b> nudge 1 pt, <b>Shift+Arrows</b> 10 pt.</li>
        <li><b>Esc</b> deselect / cancel drag • <b>Del</b> delete • <b>Ctrl+D</b> duplicate</li>
        <li><b>Ctrl+Z / Ctrl+Y</b> undo / redo • <b>Ctrl+S</b> save</li>
        <li><b>Ctrl+wheel</b> or <b>Ctrl+= / Ctrl+−</b> zoom • <b>PgUp/PgDn</b> change page</li>
        <li>Text sizes are real PDF points: 10 pt in the editor is 10 pt in the saved file at every zoom level.</li>
        <li><b>Whiteout</b> only covers content visually. Replacing printed text removes the original text from that spot.</li>
      </ul>
    </details>
  </div>
</aside>
<main id="pdfMain">
  <div id="empty" class="emptyState">
    <div class="dropCard">
      <h2>Open a PDF to start</h2>
      <p>Drop a PDF here, or choose a file. Fill form fields, replace printed text, and add text, ticks and signatures.</p>
      <label class="open btn primary">Choose PDF…<input id="pdfInputEmpty" type="file" accept="application/pdf,.pdf" hidden></label>
      <p class="mini">Files are processed in this browser only. Nothing is uploaded.</p>
    </div>
  </div>
  <div id="workspace" hidden><nav id="thumbs" aria-label="Pages"></nav><div id="stageWrap" tabindex="-1"><div id="stage"><canvas id="pdfCanvas"></canvas><div id="interaction"></div><div id="overlay"></div></div></div></div>
  <div id="pdfBusy" class="busy" hidden><span class="spinner" aria-hidden="true"></span><span id="pdfBusyText">Working…</span></div>
</main>
</div>`;

export const PDF_FOOTER = `<footer id="pdfFooter" aria-label="Page and zoom controls">
<button id="toggleThumbs" title="Show or hide page thumbnails">☰ Pages</button>
<span class="group"><button id="prev" title="Previous page (PgUp)" aria-label="Previous page">←</button><input id="pageInput" type="number" min="1" value="1" aria-label="Page number"><span id="pageTotal">/ –</span><button id="next" title="Next page (PgDn)" aria-label="Next page">→</button></span>
<span class="group"><button id="zoomOut" title="Zoom out (Ctrl+−)" aria-label="Zoom out">−</button><select id="zoomSelect" aria-label="Zoom"><option value="custom" hidden>100%</option><option value="fit-width">Fit width</option><option value="fit-page">Fit page</option>${ZOOM_PRESETS.map(z => `<option value="${z}">${Math.round(z * 100)}%</option>`).join('')}</select><button id="zoomIn" title="Zoom in (Ctrl+=)" aria-label="Zoom in">+</button></span>
<span class="group"><button id="undo" title="Undo (Ctrl+Z)">↶ Undo</button><button id="redo" title="Redo (Ctrl+Y)">↷ Redo</button></span>
</footer>`;

export const PDF_CHECK_MODAL = `<div id="pdfCheckModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="pdfCheckTitle"><div class="modalCard small"><div class="modalHead"><h2 id="pdfCheckTitle">Pre-save review</h2><button data-close="pdfCheckModal" class="iconBtn" aria-label="Close">×</button></div><p class="mini">A quick human check before the file is written. It is not clinical validation.</p><label class="checkLine"><input type="checkbox" id="pdfReviewed" class="pdfReview"> I have checked the patient/document details, examination, referral details and any signature or marks.</label><label class="checkLine mini"><input type="checkbox" id="skipReview"> Don't ask again on this device (can be turned back on under Document)</label><div class="modalActions"><button data-close="pdfCheckModal">Cancel</button><button id="confirmPdfSave" class="primary">Save PDF</button></div></div></div>
<div id="sigModal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="sigModalTitle"><div class="modalCard"><div class="modalHead"><h2 id="sigModalTitle">Draw signature</h2><button data-close="sigModal" class="iconBtn" aria-label="Close">×</button></div><p class="mini">Sign in the box with a mouse, pen or finger. The background is transparent.</p><canvas id="sigPad" width="900" height="300" aria-label="Signature drawing area"></canvas><div class="inlineRow"><label class="field inline">Ink<select id="sigInk"><option value="#111111">Black</option><option value="#0b2a8a">Blue</option></select></label><label class="field inline">Pen<select id="sigWidth"><option value="2.5">Fine</option><option value="3.5" selected>Medium</option><option value="5">Bold</option></select></label></div><div class="modalActions"><button id="sigClear">Clear</button><button data-close="sigModal">Cancel</button><button id="sigUse" class="primary">Insert signature</button></div></div></div>`;

export function initPdfEditor({ isActive }) {
  const stage = $('#stage'), wrap = $('#stageWrap'), canvas = $('#pdfCanvas'), interaction = $('#interaction'), overlay = $('#overlay');
  const sigStore = createSignatureStore();
  const S = {
    pdf: null, bytes: null, file: null, pageNum: 1, scale: PX_PER_PT, zoomMode: 'fit-width',
    objects: [], images: new Map(), formEdits: new Map(), selectedId: null, tool: 'select',
    history: [], future: [], dirty: false, recoveryKey: null, pages: new Map(),
    renderTask: null, token: 0, docToken: 0, saving: false, sessionImages: [],
    textDefaults: { fontFamily: 'helvetica', fontSize: DEFAULT_TEXT_SIZE, color: '#000000', lineHeight: DEFAULT_LINE_HEIGHT },
  };
  let drag = null, clipboardObj = null, recoveryTimer = null, autoScrollRaf = 0, thumbObserver = null;

  const obj = id => S.objects.find(o => o.id === id);
  const selectedObj = () => (S.selectedId ? obj(S.selectedId) : null);
  const pageInfo = () => S.pages.get(S.pageNum);
  const elFor = id => overlay.querySelector(`[data-id="${CSS.escape(id)}"]`);
  const newId = () => crypto.randomUUID();
  const isText = o => !!o && TEXT_TYPES.includes(o.type);

  // ---------- busy / status ----------
  function busy(text) {
    $('#pdfBusy').hidden = !text;
    if (text) $('#pdfBusyText').textContent = text;
  }

  // ---------- history ----------
  const snapshot = () => JSON.stringify({ objects: S.objects, formEdits: [...S.formEdits] });
  function commitHistory(before) {
    if (before === snapshot()) return;
    S.history.push(before);
    if (S.history.length > HISTORY_LIMIT) S.history.shift();
    S.future = [];
    markDirty();
    updateThumbMarkers();
  }
  function restore(state) {
    const d = JSON.parse(state);
    S.objects = d.objects || [];
    S.formEdits = new Map(d.formEdits || []);
    if (S.selectedId && !obj(S.selectedId)) S.selectedId = null;
    markDirty();
    drawLayers();
    updateMasks();
    updateThumbMarkers();
  }
  function undo() { if (drag || !S.history.length) return; S.future.push(snapshot()); restore(S.history.pop()); }
  function redo() { if (drag || !S.future.length) return; S.history.push(snapshot()); restore(S.future.pop()); }
  function updateUndoButtons() { $('#undo').disabled = !S.history.length; $('#redo').disabled = !S.future.length; }

  // ---------- recovery (sessionStorage: survives reloads, cleared when the tab closes) ----------
  function markDirty() {
    S.dirty = true;
    updateUndoButtons();
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(saveRecovery, 700);
  }
  function saveRecovery() {
    if (!S.recoveryKey || !S.dirty) return;
    const used = new Set(S.objects.filter(o => o.imageId).map(o => o.imageId));
    const images = [...S.images].filter(([id]) => used.has(id));
    try { sessionStorage.setItem(S.recoveryKey, JSON.stringify({ objects: S.objects, formEdits: [...S.formEdits], images, savedAt: Date.now() })); }
    catch {
      // Quota exceeded (usually large images). Tell the user once rather than failing silently.
      if (!S.recoveryWarned) { S.recoveryWarned = true; toast('This document is too large for automatic recovery. Save the PDF before closing this tab.', 'error'); }
    }
  }
  function clearRecovery() { try { if (S.recoveryKey) sessionStorage.removeItem(S.recoveryKey); } catch { /* ignore */ } }

  // ---------- opening ----------
  async function openFile(file) {
    if (!file) return;
    if (S.dirty && !confirm('You have unsaved changes in the current PDF. Discard them and open another file?')) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast('Please choose a PDF file.', 'error');
    if (file.size > MAX_PDF_BYTES) return toast('This PDF is larger than 200 MB and cannot be opened in the browser editor.', 'error');
    if (file.size > WARN_PDF_BYTES && !confirm(`This PDF is ${(file.size / 1048576).toFixed(0)} MB. Large files can be slow. Continue?`)) return;
    busy('Opening PDF…');
    const myDoc = ++S.docToken;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
      if (!head.includes('%PDF-')) throw new Error('This file does not look like a PDF.');
      const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, standardFontDataUrl: STANDARD_FONTS_URL }).promise;
      if (myDoc !== S.docToken) { doc.destroy(); return; }
      S.pdf?.destroy();
      Object.assign(S, {
        pdf: doc, bytes, file, pageNum: 1, objects: [], images: new Map(), formEdits: new Map(), selectedId: null,
        history: [], future: [], dirty: false, pages: new Map(), zoomMode: 'fit-width', recoveryWarned: false,
        recoveryKey: `pdf-editor-recovery:${file.name}:${file.size}:${file.lastModified}`,
      });
      setTool('select');
      $('#empty').hidden = true;
      $('#workspace').hidden = false;
      $('#save').disabled = false;
      $('#pageTotal').textContent = `/ ${doc.numPages}`;
      $('#pageInput').max = doc.numPages;
      await ensurePage(1);
      await render();
      buildThumbnails();
      offerRecovery();
      updateUndoButtons();
    } catch (err) {
      const msg = err?.name === 'PasswordException'
        ? 'This PDF is password-protected. Remove the password in your PDF software first, then open it here.'
        : err?.name === 'InvalidPDFException' || /does not look like a PDF/.test(err?.message || '')
          ? 'This file could not be read as a PDF. It may be damaged or not a real PDF.'
          : 'The PDF could not be opened.';
      toast(msg, 'error');
    } finally {
      if (myDoc === S.docToken) busy(null);
    }
  }

  function offerRecovery() {
    let saved;
    try { saved = sessionStorage.getItem(S.recoveryKey); } catch { return; }
    if (!saved) return;
    try {
      const d = JSON.parse(saved);
      if (!d.objects?.length && !d.formEdits?.length) return;
      if (!confirm('Unsaved edits for this PDF were found from earlier in this browser tab. Restore them?')) { clearRecovery(); return; }
      for (const [id, img] of d.images || []) S.images.set(id, img);
      S.objects = d.objects || [];
      S.formEdits = new Map(d.formEdits || []);
      S.dirty = true;
      drawLayers();
      updateMasks();
      refreshSessionSigs();
    } catch { clearRecovery(); }
  }

  // ---------- page inspection (scale 1, cached) ----------
  async function ensurePage(n) {
    if (S.pages.has(n)) return S.pages.get(n);
    const page = await S.pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const info = { view: [...page.view], rotate: page.rotate, width: vp.width, height: vp.height, lines: [], fields: [], proxy: page };
    S.pages.set(n, info);
    try {
      const [tc, anns] = await Promise.all([page.getTextContent(), page.getAnnotations({ intent: 'display' })]);
      info.lines = mergeTextRuns(tc, vp);
      info.fields = anns.filter(a => a.subtype === 'Widget' && !a.hidden).map(a => {
        const r = vp.convertToViewportRectangle(a.rect);
        return {
          id: a.id, name: a.fieldName || '', type: a.fieldType || '', value: a.fieldValue ?? '', options: a.options || [],
          checkBox: !!a.checkBox, radioButton: !!a.radioButton, buttonValue: a.buttonValue || a.exportValue || '', readOnly: !!a.readOnly,
          x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]),
        };
      });
    } catch { /* text/fields are optional extras; the page still renders */ }
    return info;
  }

  function mergeTextRuns(tc, vp) {
    const pieces = [];
    for (const item of tc.items) {
      if (!item.str?.trim()) continue;
      const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
      if (Math.abs(tx[1]) > 0.01 || Math.abs(tx[2]) > 0.01) continue; // rotated/skewed text: not editable inline
      const fontSize = Math.abs(tx[3]);
      if (fontSize < 2) continue;
      const st = tc.styles?.[item.fontName] || {};
      pieces.push({
        str: item.str, x: tx[4], baseline: tx[5], w: Math.max(2, item.width), fontSize, fontName: item.fontName,
        family: normalizeFamily(st.fontFamily), bold: /bold|black|heavy/i.test(`${item.fontName} ${st.fontFamily || ''}`),
      });
    }
    // Merge runs on the same baseline that are close together AND of similar size/family, so a
    // label and a differently-sized value next to it are never fused into one oversized line.
    pieces.sort((a, b) => (Math.abs(a.baseline - b.baseline) < 1.5 ? a.x - b.x : a.baseline - b.baseline));
    const lines = [];
    for (const p of pieces) {
      const last = lines.at(-1);
      const gap = last ? p.x - (last.x + last.w) : Infinity;
      if (last && Math.abs(last.baseline - p.baseline) < Math.max(1.5, p.fontSize * 0.25) && gap < Math.max(3, p.fontSize * 1.0) && gap > -p.fontSize
        && p.fontSize / last.fontSize > 0.85 && p.fontSize / last.fontSize < 1.18 && p.family === last.family) {
        last.str += (gap > p.fontSize * 0.15 && !last.str.endsWith(' ') && !p.str.startsWith(' ') ? ' ' : '') + p.str;
        last.w = Math.max(last.w, p.x + p.w - last.x);
        last.bold ||= p.bold;
      } else lines.push({ ...p });
    }
    // Hit box used for clicking and for removing the original text on save.
    return lines.map((l, i) => ({ ...l, index: i, y: l.baseline - l.fontSize, h: l.fontSize * 1.12 }));
  }

  // ---------- rendering ----------
  async function render() {
    if (!S.pdf) return;
    const t = ++S.token;
    const info = await ensurePage(S.pageNum);
    if (t !== S.token) return;
    if (S.zoomMode) S.scale = fitScale(S.zoomMode, info);
    applyStageSize(info);
    drawLayers();
    updatePageUI();
    updateZoomUI();
    // Render into an off-screen canvas, then swap, so zooming never flashes a blank page.
    S.renderTask?.cancel();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const page = await S.pdf.getPage(S.pageNum);
    if (t !== S.token) return;
    const vp = page.getViewport({ scale: S.scale * dpr });
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width);
    off.height = Math.floor(vp.height);
    // When our editable inputs are shown, let them be the only rendering of form fields;
    // otherwise pdf.js paints the field's stored appearance too and values appear twice.
    const annotationMode = $('#nativeFields').checked ? pdfjsLib.AnnotationMode.ENABLE_FORMS : pdfjsLib.AnnotationMode.ENABLE;
    const task = page.render({ canvasContext: off.getContext('2d'), viewport: vp, annotationMode });
    S.renderTask = task;
    try { await task.promise; } catch (err) { if (err?.name !== 'RenderingCancelledException') toast('Part of this page could not be drawn.', 'error'); return; }
    if (t !== S.token) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d').drawImage(off, 0, 0);
    S.renderTask = null;
    updateMasks();
  }

  function applyStageSize(info) {
    const w = info.width * S.scale, h = info.height * S.scale;
    for (const el of [stage, interaction, overlay, canvas]) { el.style.width = `${w}px`; el.style.height = `${h}px`; }
  }

  function fitScale(mode, info) {
    const availW = Math.max(200, wrap.clientWidth - 48), availH = Math.max(200, wrap.clientHeight - 48);
    const s = mode === 'fit-page' ? Math.min(availW / info.width, availH / info.height) : availW / info.width;
    return clamp(s, MIN_SCALE, MAX_SCALE);
  }

  function setScale(scale, anchor) {
    if (!S.pdf || drag) return;
    const info = pageInfo();
    const old = S.scale;
    S.zoomMode = null;
    S.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    // Keep the page point under the anchor (cursor or viewport centre) in place.
    const r = wrap.getBoundingClientRect();
    const ax = anchor?.x ?? r.left + r.width / 2, ay = anchor?.y ?? r.top + r.height / 2;
    const sr = stage.getBoundingClientRect();
    const px = (ax - sr.left) / old, py = (ay - sr.top) / old;
    if (info) {
      applyStageSize(info);
      const nr = stage.getBoundingClientRect();
      wrap.scrollLeft += nr.left + px * S.scale - ax;
      wrap.scrollTop += nr.top + py * S.scale - ay;
    }
    render();
  }
  function setZoomMode(mode) { if (!S.pdf || drag) return; S.zoomMode = mode; render(); }
  function zoomStep(dir) {
    const pct = S.scale / PX_PER_PT;
    const next = dir > 0 ? ZOOM_PRESETS.find(z => z > pct + 0.01) ?? pct * 1.25 : [...ZOOM_PRESETS].reverse().find(z => z < pct - 0.01) ?? pct / 1.25;
    setScale(next * PX_PER_PT);
  }
  function updateZoomUI() {
    const sel = $('#zoomSelect'), pct = S.scale / PX_PER_PT;
    const preset = ZOOM_PRESETS.find(z => Math.abs(z - pct) < 0.005);
    const custom = sel.querySelector('option[value="custom"]');
    custom.textContent = `${Math.round(pct * 100)}%`;
    sel.value = S.zoomMode || (preset ? String(preset) : 'custom');
    sel.title = `Zoom ${Math.round(pct * 100)}%`;
  }
  function updatePageUI() {
    $('#pageInput').value = S.pageNum;
    $('#prev').disabled = S.pageNum <= 1;
    $('#next').disabled = !S.pdf || S.pageNum >= S.pdf.numPages;
    $$('.thumb').forEach(b => { const cur = +b.dataset.page === S.pageNum; b.classList.toggle('current', cur); b.setAttribute('aria-current', cur ? 'page' : 'false'); });
    const info = pageInfo();
    if (info) $('#info').textContent = `Page ${S.pageNum}: ${info.lines.length} text lines • ${info.fields.length} form fields${info.rotate ? ` • rotated ${info.rotate}°` : ''}`;
  }
  async function goToPage(n) {
    if (!S.pdf) return;
    n = clamp(Math.round(n) || 1, 1, S.pdf.numPages);
    if (n === S.pageNum) { updatePageUI(); return; }
    if (drag) finishDrag(true);
    document.activeElement?.blur?.();
    select(null); // also removes a just-placed text box that was left empty
    S.pageNum = n;
    wrap.scrollTop = 0;
    await render();
    $(`.thumb[data-page="${n}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---------- layers ----------
  function drawLayers() {
    drawInteraction();
    // Rebuild object elements, but never detach the one being typed in: removing a focused
    // textarea drops focus and the caret (e.g. on window resize, zoom, or a tablet keyboard).
    const active = document.activeElement?.classList?.contains('inlineText') ? document.activeElement.closest('.obj') : null;
    const items = S.objects.filter(o => o.page === S.pageNum);
    const keep = active && overlay.contains(active) && items.some(o => o.id === active.dataset.id) ? active : null;
    for (const child of [...overlay.children]) if (child !== keep) child.remove();
    let before = true;
    for (const o of items) {
      if (keep && o.id === keep.dataset.id) { layoutObjEl(o, keep); before = false; continue; }
      const el = createObjEl(o);
      if (keep && before) overlay.insertBefore(el, keep); else overlay.appendChild(el);
    }
    refreshControls();
    updateUndoButtons();
  }

  function drawInteraction() {
    interaction.replaceChildren();
    const info = pageInfo();
    if (!info) return;
    const s = S.scale;
    // Editor-only masks hiding original text that will be removed on save.
    for (const o of S.objects) {
      if (o.page !== S.pageNum || o.type !== 'replaceText' || !o.source || isUnchangedReplacement(o)) continue;
      const m = document.createElement('div');
      m.className = 'previewMask';
      m.dataset.mask = o.id;
      Object.assign(m.style, { left: `${(o.source.x - 0.5) * s}px`, top: `${(o.source.y - 0.5) * s}px`, width: `${(o.source.w + 1) * s}px`, height: `${(o.source.h + 1) * s}px` });
      interaction.appendChild(m);
    }
    if ($('#existingText').checked) {
      for (const line of info.lines) {
        const hit = document.createElement('button');
        hit.type = 'button';
        hit.className = 'textHit';
        hit.tabIndex = -1;
        hit.title = `Replace: ${line.str}`;
        hit.setAttribute('aria-label', `Replace printed text: ${line.str}`);
        Object.assign(hit.style, { left: `${line.x * s}px`, top: `${line.y * s}px`, width: `${Math.max(6, line.w * s)}px`, height: `${Math.max(8, line.h * s)}px` });
        hit.addEventListener('click', e => { e.stopPropagation(); if (S.tool === 'select') editLine(line); });
        interaction.appendChild(hit);
      }
    }
    if ($('#nativeFields').checked) info.fields.forEach(drawField);
  }

  function updateMasks() {
    const ctx = canvas.width ? canvas.getContext('2d', { willReadFrequently: true }) : null;
    for (const m of $$('.previewMask', interaction)) {
      const o = obj(m.dataset.mask);
      m.style.background = ctx && o ? sampleBackground(ctx, o.source) : '#fff';
    }
  }
  // Most common colour just outside the original text box: approximates the paper/field colour.
  function sampleBackground(ctx, r) {
    const k = canvas.width / (pageInfo()?.width || 1);
    const pts = [[r.x - 2, r.y + r.h / 2], [r.x + r.w + 2, r.y + r.h / 2], [r.x + r.w / 2, r.y - 1.5], [r.x + r.w / 2, r.y + r.h + 1.5], [r.x - 2, r.y - 1.5]];
    const counts = new Map();
    for (const [x, y] of pts) {
      try {
        const d = ctx.getImageData(clamp(Math.round(x * k), 0, canvas.width - 1), clamp(Math.round(y * k), 0, canvas.height - 1), 1, 1).data;
        const key = `rgb(${d[0]},${d[1]},${d[2]})`;
        counts.set(key, (counts.get(key) || 0) + 1);
      } catch { /* ignore */ }
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '#fff';
  }

  const fieldKey = f => `${S.pageNum}:${f.name || f.id}`;
  function drawField(f) {
    const key = fieldKey(f), current = S.formEdits.has(key) ? S.formEdits.get(key) : f.value;
    const set = v => { const before = snapshot(); S.formEdits.set(key, v); commitHistory(before); };
    let el;
    if (f.type === 'Btn' && f.radioButton) {
      el = document.createElement('input');
      el.type = 'radio';
      el.className = 'nativeField radio';
      el.name = `radio_${S.pageNum}_${f.name || f.id}`;
      el.checked = String(current) === String(f.buttonValue) || current === true;
      el.onchange = () => { if (el.checked) set(f.buttonValue || 'Yes'); };
    } else if (f.type === 'Btn' && f.checkBox) {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.className = 'nativeField checkbox';
      el.checked = !!current && current !== 'Off';
      el.onchange = () => set(el.checked);
    } else if (f.type === 'Ch' && f.options?.length) {
      el = document.createElement('select');
      el.className = 'nativeField';
      for (const op of f.options) {
        const opt = document.createElement('option');
        opt.value = op.exportValue ?? op.displayValue ?? op;
        opt.textContent = op.displayValue ?? op.exportValue ?? op;
        el.appendChild(opt);
      }
      el.value = Array.isArray(current) ? current[0] : current || '';
      el.onchange = () => set(el.value);
    } else if (f.type === 'Tx') {
      el = document.createElement('input');
      el.type = 'text';
      el.className = 'nativeField';
      el.value = current || '';
      el.style.fontSize = `${clamp(f.h * 0.65, 6, 12) * S.scale}px`; // preview only; the PDF draws its own field appearance
      el.onchange = () => set(el.value);
    } else return;
    el.title = f.name || 'PDF form field';
    el.setAttribute('aria-label', f.name || 'PDF form field');
    if (f.readOnly) el.disabled = true;
    Object.assign(el.style, { left: `${f.x * S.scale}px`, top: `${f.y * S.scale}px`, width: `${Math.max(8, f.w * S.scale)}px`, height: `${Math.max(8, f.h * S.scale)}px` });
    interaction.appendChild(el);
  }

  // ---------- objects ----------
  function syncTextBox(o) {
    const lay = layoutText(o);
    o.w = lay.width;
    o.h = lay.height;
    return lay;
  }

  function createObjEl(o) {
    const el = document.createElement('div');
    el.className = `obj ${o.type}`;
    el.dataset.id = o.id;
    if (isText(o)) {
      const ta = document.createElement('textarea');
      ta.className = 'inlineText';
      ta.spellcheck = false;
      ta.rows = 1;
      ta.wrap = 'off';
      ta.value = o.text || '';
      ta.setAttribute('aria-label', 'Text on PDF');
      wireTextarea(o, ta);
      el.appendChild(ta);
      el.insertAdjacentHTML('beforeend', '<i class="handle" data-h="e" title="Drag to set box width"></i>');
    } else if (o.type === 'image') {
      const img = document.createElement('img');
      img.src = S.images.get(o.imageId)?.src || '';
      img.alt = 'Signature or image';
      img.draggable = false; // stop the browser's native image drag from hijacking the pointer
      el.appendChild(img);
    } else if (['check', 'xmark', 'radio'].includes(o.type)) {
      el.innerHTML = { check: '<svg viewBox="0 0 1 1" preserveAspectRatio="none"><polyline points="0.16,0.52 0.39,0.76 0.86,0.2"/></svg>', xmark: '<svg viewBox="0 0 1 1" preserveAspectRatio="none"><line x1=".2" y1=".2" x2=".8" y2=".8"/><line x1=".2" y1=".8" x2=".8" y2=".2"/></svg>', radio: '<svg viewBox="0 0 1 1" preserveAspectRatio="none"><ellipse cx=".5" cy=".5" rx=".24" ry=".24"/></svg>' }[o.type];
    }
    if (!isText(o)) for (const h of ['nw', 'ne', 'sw', 'se']) el.insertAdjacentHTML('beforeend', `<i class="handle" data-h="${h}"></i>`);
    if (o.id === S.selectedId) el.classList.add('selected');
    layoutObjEl(o, el);
    return el;
  }

  // Browsers snap the text baseline to whole pixels, so the on-screen baseline can sit up to
  // 1px away from the exact (exported) baseline. Measure where the browser really puts it for
  // this font/size and shift the preview by the sub-pixel difference.
  const baselineCache = new Map();
  let baselineProbe = null;
  function cssBaseline(ta) {
    const cs = ta.style;
    const key = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.fontStyle}|${cs.lineHeight}`;
    if (baselineCache.has(key)) return baselineCache.get(key);
    if (!baselineProbe) {
      baselineProbe = document.createElement('div');
      baselineProbe.setAttribute('aria-hidden', 'true');
      baselineProbe.style.cssText = 'position:absolute;left:-10000px;top:0;white-space:pre;padding:0;margin:0;border:0;visibility:hidden;font-kerning:none';
      baselineProbe.innerHTML = 'Hg<span style="display:inline-block;width:1px;height:0"></span>';
      document.body.appendChild(baselineProbe);
    }
    Object.assign(baselineProbe.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, lineHeight: cs.lineHeight });
    const y = baselineProbe.lastChild.getBoundingClientRect().top - baselineProbe.getBoundingClientRect().top;
    baselineCache.set(key, y);
    return y;
  }

  function layoutObjEl(o, el = elFor(o.id)) {
    if (!el) return;
    const s = S.scale;
    if (isText(o)) {
      const lay = syncTextBox(o);
      const ta = el.querySelector('textarea');
      const fam = FONT_FAMILIES[normalizeFamily(o.fontFamily)];
      Object.assign(ta.style, {
        fontFamily: fam.css, fontSize: `${lay.fontSize * s}px`, lineHeight: `${lay.lineGap * s}px`,
        fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal',
        color: o.color || '#000000', textAlign: o.align || 'left',
      });
      ta.style.transform = `translateY(${lay.lines[0].baseline * s - cssBaseline(ta)}px)`;
      el.style.background = o.bg || 'transparent';
      el.classList.toggle('fit', !!o.fitToBox);
    } else if (o.type === 'xmark' || o.type === 'check') {
      el.style.setProperty('--stroke', `${Math.max(1, Math.min(o.w, o.h) * (o.type === 'check' ? 0.085 : 0.075)) * s}px`);
    }
    Object.assign(el.style, { left: `${o.x * s}px`, top: `${o.y * s}px`, width: `${o.w * s}px`, height: `${o.h * s}px` });
  }

  function wireTextarea(o, ta) {
    let before = null;
    ta.addEventListener('focus', () => { select(o.id); before = snapshot(); ta.closest('.obj')?.classList.add('typing'); });
    ta.addEventListener('blur', () => {
      ta.closest('.obj')?.classList.remove('typing');
      if (before) commitHistory(before);
      before = null;
    });
    ta.addEventListener('input', () => {
      const wasUnchanged = isUnchangedReplacement(o);
      o.text = ta.value;
      layoutObjEl(o);
      if (o.type === 'replaceText' && wasUnchanged !== isUnchangedReplacement(o)) drawInteractionMasksOnly();
      refreshCharWarning(o);
      markDirty();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); ta.blur(); }
    });
  }
  function drawInteractionMasksOnly() { drawInteraction(); updateMasks(); }

  function addObject(o, { select: sel = true } = {}) {
    const before = snapshot();
    const full = { id: newId(), page: S.pageNum, ...o };
    if (isText(full)) syncTextBox(full);
    S.objects.push(full);
    commitHistory(before);
    overlay.appendChild(createObjEl(full));
    if (sel) select(full.id);
    return full;
  }

  function select(id) {
    if (S.selectedId === id) { refreshControls(); return; }
    pruneEmptyText(S.selectedId);
    S.selectedId = id;
    $$('.obj.selected', overlay).forEach(x => x.classList.remove('selected'));
    if (id) elFor(id)?.classList.add('selected');
    refreshControls();
  }

  // A new text box that was left empty is removed when it loses selection (not merely focus,
  // so the user can still adjust font settings before typing).
  function pruneEmptyText(id) {
    const o = id && obj(id);
    if (o?.type !== 'text' || String(o.text || '').trim()) return;
    S.objects = S.objects.filter(x => x !== o);
    if (S.history.at(-1) === snapshot()) S.history.pop(); // the placement step is now a no-op
    elFor(o.id)?.remove();
    updateUndoButtons();
  }

  function refreshControls() {
    const o = selectedObj();
    const text = isText(o), image = o?.type === 'image';
    const labels = { text: 'Text', replaceText: 'Replaced printed text', image: 'Signature / image', check: 'Tick', xmark: 'Cross', radio: 'Dot', rect: 'Box', whiteout: 'Whiteout (visual cover only)' };
    $('#selectedType').textContent = o ? `${labels[o.type] || o.type} — page ${o.page}` : 'Nothing selected. Click an item on the page to select it.';
    $('#textControls').hidden = !text;
    $('#imageControls').hidden = !image;
    $('#objControls').hidden = !o;
    if (!o) return;
    $('#objX').value = roundTo(o.x, 0.1).toFixed(1);
    $('#objY').value = roundTo(o.y, 0.1).toFixed(1);
    if (text) {
      $('#fontFamily').value = normalizeFamily(o.fontFamily);
      $('#fontSize').value = roundTo(o.fontSize, 0.5);
      $$('#sizePresets [data-size]').forEach(b => b.classList.toggle('active', +b.dataset.size === o.fontSize));
      $('#boldBtn').setAttribute('aria-pressed', String(!!o.bold));
      $('#italicBtn').setAttribute('aria-pressed', String(!!o.italic));
      $('#textColor').value = o.color || '#000000';
      $$('[data-align]').forEach(b => b.classList.toggle('active', (o.align || 'left') === b.dataset.align));
      $('#lineHeight').value = String(o.lineHeight || DEFAULT_LINE_HEIGHT);
      $('#bgOn').checked = !!o.bg;
      $('#bgColor').value = o.bg || '#ffffff';
      $('#fitToggle').checked = !!o.fitToBox;
      refreshCharWarning(o);
      $('#fontNote').hidden = !o.originalFont;
      if (o.originalFont) $('#fontNote').textContent = `Original font "${o.originalFont}" is not available for saving; the closest standard font (${FONT_FAMILIES[normalizeFamily(o.fontFamily)].label}) is used.`;
    }
    if (image) {
      $('#objWidth').value = Math.round(o.w * 10) / 10;
      $('#objHeight').value = Math.round(o.h * 10) / 10;
      $('#lockAspect').checked = o.lockAspect !== false;
    }
  }
  function refreshCharWarning(o) {
    const { replaced } = sanitizeForPdf(o.text);
    const w = $('#charWarning');
    w.hidden = !replaced.length;
    if (replaced.length) w.textContent = `Not supported by standard PDF fonts and will be simplified on save: ${replaced.join(' ')}`;
  }

  /** Apply a change to the selected object as one undoable step. */
  function changeSelected(mutate, { remember } = {}) {
    const o = selectedObj();
    if (!o) return;
    const before = snapshot();
    mutate(o);
    if (isText(o)) {
      syncTextBox(o);
      if (remember) Object.assign(S.textDefaults, remember(o));
    }
    const p = pageInfo();
    if (p && o.page === S.pageNum) Object.assign(o, clampToPage(o, p.width, p.height));
    commitHistory(before);
    layoutObjEl(o);
    refreshControls();
  }

  function setFontSize(v) {
    const n = roundTo(clamp(Number(v) || DEFAULT_TEXT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE), 0.5);
    changeSelected(o => { o.fontSize = n; }, { remember: o => ({ fontSize: o.fontSize }) });
  }

  function deleteSelected() {
    const o = selectedObj();
    if (!o) return;
    const before = snapshot();
    S.objects = S.objects.filter(x => x.id !== o.id);
    S.selectedId = null;
    commitHistory(before);
    drawLayers();
    updateMasks();
  }

  function duplicateSelected() {
    const o = selectedObj();
    if (!o) return;
    const copy = structuredClone(o);
    delete copy.id;
    copy.x += 12;
    copy.y += 12;
    if (copy.type === 'replaceText') { copy.type = 'text'; delete copy.source; delete copy.original; }
    const p = pageInfo();
    Object.assign(copy, clampToPage(copy, p.width, p.height));
    addObject(copy);
  }

  function arrange(dir) {
    const o = selectedObj();
    if (!o) return;
    const same = S.objects.filter(x => x.page === o.page);
    const i = same.indexOf(o), j = i + dir;
    if (j < 0 || j >= same.length) return toast(dir > 0 ? 'Already at the front.' : 'Already at the back.');
    const before = snapshot();
    const a = S.objects.indexOf(o), b = S.objects.indexOf(same[j]);
    [S.objects[a], S.objects[b]] = [S.objects[b], S.objects[a]];
    commitHistory(before);
    drawLayers();
  }

  async function copyToPages() {
    const o = selectedObj();
    if (!o) return;
    const input = prompt(`Copy this item to which pages? (1-${S.pdf.numPages}, e.g. "2-4, 6")`, '');
    if (input === null) return;
    let pages;
    try { pages = parsePageRanges(input, S.pdf.numPages).filter(p => p !== o.page); }
    catch (err) { return toast(err.message, 'error'); }
    if (!pages.length) return toast('No other pages selected.');
    const before = snapshot();
    for (const p of pages) {
      const info = await ensurePage(p);
      const copy = structuredClone(o);
      copy.id = newId();
      copy.page = p;
      if (copy.type === 'replaceText') { copy.type = 'text'; delete copy.source; delete copy.original; }
      Object.assign(copy, clampToPage(copy, info.width, info.height));
      S.objects.push(copy);
    }
    commitHistory(before);
    toast(`Copied to ${pages.length} page${pages.length > 1 ? 's' : ''}.`);
  }

  // pdf.js only exposes an internal id + generic family in text content; the loaded font object
  // (available once the page has rendered) has the real PostScript name and bold/italic flags.
  function describeFont(fontName) {
    let f = null;
    try { const co = pageInfo()?.proxy?.commonObjs; if (fontName && co?.has(fontName)) f = co.get(fontName); } catch { /* not loaded */ }
    const name = String(f?.name || f?.fallbackName || '').replace(/^[A-Z]{6}\+/, '');
    return {
      name,
      bold: !!(f?.bold || f?.black) || /bold|black|heavy|semibold|demi/i.test(name),
      italic: !!f?.italic || /italic|oblique/i.test(name),
      family: name ? normalizeFamily(name) : null,
      standard: !name || /helvetica|arial|times|courier|liberation|nimbus/i.test(name),
    };
  }

  function editLine(line) {
    let o = S.objects.find(x => x.type === 'replaceText' && x.page === S.pageNum && x.sourceKey === `${line.index}:${line.str}`);
    if (!o) {
      const f = describeFont(line.fontName);
      const base = {
        type: 'replaceText', text: line.str, fontSize: roundTo(line.fontSize, 0.1), fontFamily: f.family || line.family,
        bold: f.bold || line.bold, italic: f.italic, color: '#000000', lineHeight: DEFAULT_LINE_HEIGHT, align: 'left', minW: line.w,
        originalFont: f.standard ? '' : f.name,
      };
      const k = layoutText({ ...base, text: 'x' }).lines[0].baseline;
      const x = line.x, y = line.baseline - k;
      o = addObject({
        ...base, x, y, sourceKey: `${line.index}:${line.str}`,
        source: { x: line.x, y: line.y, w: line.w, h: line.h, fontSize: line.fontSize },
        original: { text: line.str, x, y, fontSize: base.fontSize, bold: base.bold, italic: base.italic, fontFamily: base.fontFamily },
      });
      drawInteractionMasksOnly();
    } else select(o.id);
    const ta = elFor(o.id)?.querySelector('textarea');
    if (ta) { ta.focus(); ta.select(); }
  }

  // ---------- pointer interaction ----------
  const clientToPage = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left) / S.scale, y: (cy - r.top) / S.scale }; };

  stage.addEventListener('pointerdown', e => {
    if (!S.pdf || (e.pointerType === 'mouse' && e.button !== 0) || drag) return;
    const el = e.target.closest('.obj');
    if (el) return onObjectPointerDown(e, el);
    if (e.target.closest('.nativeField, .textHit')) return;
    const pt = clientToPage(e.clientX, e.clientY);
    if (S.tool !== 'select') {
      e.preventDefault();
      placeWithTool(pt, e.shiftKey);
      return;
    }
    if (document.activeElement?.classList.contains('inlineText')) document.activeElement.blur();
    select(null);
  });

  function onObjectPointerDown(e, el) {
    const o = obj(el.dataset.id);
    if (!o) return;
    const handle = e.target.closest('.handle');
    const ta = el.querySelector('textarea');
    // While a text box is being edited, let the pointer place the caret / select text.
    if (!handle && ta && document.activeElement === ta) return;
    e.preventDefault();
    e.stopPropagation();
    select(o.id);
    wrap.focus({ preventScroll: true });
    const pt = clientToPage(e.clientX, e.clientY);
    drag = {
      pointerId: e.pointerId, id: o.id, mode: handle ? 'resize' : 'move', handle: handle?.dataset.h,
      cx: e.clientX, cy: e.clientY, startPt: pt, grab: { x: pt.x - o.x, y: pt.y - o.y },
      orig: { x: o.x, y: o.y, w: o.w, h: o.h, fixedWidth: o.fixedWidth }, before: snapshot(), moved: false,
    };
    try { stage.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ }
    document.body.classList.add('dragging');
    if (handle) document.body.dataset.dragHandle = handle.dataset.h;
  }

  function updateDrag() {
    const o = drag && obj(drag.id);
    if (!o) return;
    const info = pageInfo();
    const pt = clientToPage(drag.cx, drag.cy);
    if (!drag.moved) {
      if (Math.hypot(pt.x - drag.startPt.x, pt.y - drag.startPt.y) * S.scale < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
    }
    if (drag.mode === 'move') {
      o.x = pt.x - drag.grab.x;
      o.y = pt.y - drag.grab.y;
    } else if (isText(o)) {
      o.fixedWidth = true;
      o.w = clamp(pt.x - o.x, 12, info.width - o.x);
      syncTextBox(o);
    } else {
      const aspect = o.type === 'image' && o.lockAspect !== false ? drag.orig.w / drag.orig.h : null;
      Object.assign(o, resizeFromHandle(drag.orig, drag.handle, pt, { aspect, minSize: 4 }));
    }
    Object.assign(o, clampToPage(o, info.width, info.height));
    layoutObjEl(o);
    $('#objX').value = o.x.toFixed(1);
    $('#objY').value = o.y.toFixed(1);
    autoScroll();
  }

  // Scroll the page when dragging near the edge of the viewport.
  function autoScroll() {
    cancelAnimationFrame(autoScrollRaf);
    if (!drag) return;
    const r = wrap.getBoundingClientRect(), edge = 28;
    const dx = drag.cx < r.left + edge ? -1 : drag.cx > r.right - edge ? 1 : 0;
    const dy = drag.cy < r.top + edge ? -1 : drag.cy > r.bottom - edge ? 1 : 0;
    if (!dx && !dy) return;
    autoScrollRaf = requestAnimationFrame(() => {
      if (!drag) return;
      wrap.scrollLeft += dx * 10;
      wrap.scrollTop += dy * 10;
      // the scroll listener recomputes the position; keep going while near the edge
    });
  }

  function finishDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(autoScrollRaf);
    document.body.classList.remove('dragging');
    delete document.body.dataset.dragHandle;
    try { if (stage.hasPointerCapture(d.pointerId)) stage.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
    const o = obj(d.id);
    if (!o) return;
    if (!commit) {
      Object.assign(o, d.orig);
      if (isText(o)) syncTextBox(o);
      layoutObjEl(o);
      refreshControls();
      return;
    }
    if (d.moved) { commitHistory(d.before); refreshControls(); }
    else if (isText(o) && d.mode === 'move') {
      const ta = elFor(o.id)?.querySelector('textarea');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }
  }

  stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.cx = e.clientX;
    drag.cy = e.clientY;
    updateDrag();
  });
  stage.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pointerId) finishDrag(true); });
  stage.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.pointerId) finishDrag(false); });
  stage.addEventListener('lostpointercapture', e => { if (drag && e.pointerId === drag.pointerId) finishDrag(true); });
  // Wheel/keyboard scrolling during a drag: re-derive the page position from the last pointer
  // position, so the object stays exactly under the cursor instead of drifting or jumping.
  wrap.addEventListener('scroll', () => { if (drag) updateDrag(); }, { passive: true });
  window.addEventListener('blur', () => finishDrag(true));
  stage.addEventListener('dragstart', e => e.preventDefault());

  wrap.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey) || !S.pdf) return;
    e.preventDefault();
    if (drag) return;
    setScale(S.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // ---------- tools ----------
  function setTool(t) {
    S.tool = t;
    $$('[data-tool]').forEach(b => { const on = b.dataset.tool === t; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
    stage.classList.toggle('placing', t !== 'select');
  }

  function placeWithTool(pt, keepTool) {
    const info = pageInfo();
    const t = S.tool;
    if (t === 'text') {
      const d = S.textDefaults;
      const base = { type: 'text', text: '', fontFamily: d.fontFamily, fontSize: d.fontSize, color: d.color, lineHeight: d.lineHeight, align: 'left', minW: 24 };
      const lay = layoutText({ ...base, text: 'x' });
      const o = addObject({ ...base, x: pt.x, y: pt.y - lay.lineGap / 2 });
      Object.assign(o, clampToPage(o, info.width, info.height));
      layoutObjEl(o);
      // Focus immediately (pointerdown's default was prevented, so nothing steals focus) so that
      // typing straight after the click is never lost.
      elFor(o.id)?.querySelector('textarea')?.focus();
    } else if (t === 'whiteout' || t === 'rect') {
      const w = 120, h = t === 'whiteout' ? 16 : 28;
      const o = addObject({ type: t, x: pt.x, y: pt.y, w, h });
      Object.assign(o, clampToPage(o, info.width, info.height));
      layoutObjEl(o);
    } else if (['check', 'xmark', 'radio'].includes(t)) {
      const box = detectPrintedBox(pt);
      const size = 10;
      addObject({ type: t, x: box?.x ?? pt.x - size / 2, y: box?.y ?? pt.y - size / 2, w: box?.w ?? size, h: box?.h ?? size });
    }
    if (!keepTool) setTool('select');
  }

  // Snap tick/cross/dot to a small printed checkbox under the click, if one is found.
  function detectPrintedBox(pt) {
    try {
      const k = canvas.width / pageInfo().width;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const R = Math.round(22 * k), cx = Math.round(pt.x * k), cy = Math.round(pt.y * k);
      const x0 = Math.max(0, cx - R), y0 = Math.max(0, cy - R), x1 = Math.min(canvas.width - 1, cx + R), y1 = Math.min(canvas.height - 1, cy + R);
      const im = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1), W = im.width, H = im.height;
      const dark = (x, y) => { const i = (y * W + x) * 4; return (im.data[i] + im.data[i + 1] + im.data[i + 2]) / 3 < 145; };
      const vs = [], hs = [];
      for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (dark(x, y)) n++; if (n / H > 0.28) vs.push(x); }
      for (let y = 0; y < H; y++) { let n = 0; for (let x = 0; x < W; x++) if (dark(x, y)) n++; if (n / W > 0.28) hs.push(y); }
      const L = vs.filter(x => x <= cx - x0).at(-1), Rt = vs.find(x => x >= cx - x0), T = hs.filter(y => y <= cy - y0).at(-1), B = hs.find(y => y >= cy - y0);
      if (L == null || Rt == null || T == null || B == null) return null;
      const w = (Rt - L) / k, h = (B - T) / k;
      if (w < 5 || h < 5 || w > 28 || h > 28 || Math.abs(w - h) > Math.max(w, h) * 0.45) return null;
      return { x: (x0 + L + 1) / k, y: (y0 + T + 1) / k, w: Math.max(6, w - 2 / k), h: Math.max(6, h - 2 / k) };
    } catch { return null; }
  }

  // ---------- images & signatures ----------
  function loadImage(src) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Image could not be read.')); img.src = src; });
  }
  const readAsDataURL = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

  /** Normalise an uploaded image: PNG kept as-is (transparency preserved); JPEG re-encoded so EXIF rotation is baked in. */
  async function normaliseImageFile(file) {
    if (!['image/png', 'image/jpeg'].includes(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) throw new Error('Please choose a PNG or JPEG image.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 15 MB. Please use a smaller image.');
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
    const src = await readAsDataURL(file);
    const img = await loadImage(src);
    const k = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    if (isPng && k === 1) return { src, width: img.naturalWidth, height: img.naturalHeight };
    // Large photos are scaled down (memory, recovery storage and saved-file size); JPEGs are
    // also redrawn so phone-camera EXIF rotation is baked in. PNG transparency is kept.
    const bmp = isPng ? img : await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => img);
    const bw = bmp.naturalWidth || bmp.width, bh = bmp.naturalHeight || bmp.height;
    const kk = Math.min(1, MAX_IMAGE_EDGE / Math.max(bw, bh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bw * kk));
    c.height = Math.max(1, Math.round(bh * kk));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return { src: isPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height };
  }

  function registerImage({ src, width, height }, name = 'Signature') {
    const existing = [...S.images].find(([, v]) => v.src === src);
    if (existing) return existing[0];
    const id = newId();
    S.images.set(id, { src, width, height, name });
    return id;
  }

  function placeImage(imageId) {
    if (!S.pdf) return toast('Open a PDF first.', 'error');
    const img = S.images.get(imageId);
    const info = pageInfo();
    let w = Math.min(150, img.width * 0.75), h = (w * img.height) / img.width;
    if (h > 60) { h = 60; w = (h * img.width) / img.height; }
    // Centre of the visible part of the page.
    const r = wrap.getBoundingClientRect();
    const c = clientToPage(r.left + r.width / 2, r.top + r.height / 2);
    const o = addObject({ type: 'image', imageId, w, h, x: c.x - w / 2, y: c.y - h / 2, lockAspect: true });
    Object.assign(o, clampToPage(o, info.width, info.height));
    layoutObjEl(o);
    if (!S.sessionImages.includes(imageId)) S.sessionImages.unshift(imageId);
    refreshSessionSigs();
    setTool('select');
  }

  async function insertImageFile(file) {
    try {
      const data = await normaliseImageFile(file);
      placeImage(registerImage(data, file.name.replace(/\.[^.]+$/, '')));
    } catch (err) { toast(err.message || 'Image could not be added.', 'error'); }
  }

  function refreshSessionSigs() {
    const box = $('#sessionSigs');
    const ids = S.sessionImages.filter(id => S.images.has(id));
    if (!ids.length) { box.innerHTML = '<div class="mini">Signatures you insert are listed here for re-use in this session only.</div>'; return; }
    box.innerHTML = ids.map(id => `<button type="button" class="sigPick" data-session-img="${id}" title="Place again on this page"><img src="${esc(safeImageSrc(S.images.get(id).src))}" alt=""><span>${esc(S.images.get(id).name || 'Signature')}</span></button>`).join('');
    $$('[data-session-img]', box).forEach(b => { b.onclick = () => placeImage(b.dataset.sessionImg); });
  }

  async function makeWhiteTransparent() {
    const o = selectedObj();
    if (o?.type !== 'image') return;
    const src = S.images.get(o.imageId);
    const img = await loadImage(src.src);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
      if (lum > 235) d.data[i + 3] = 0;
      else if (lum > 200) d.data[i + 3] = Math.round(d.data[i + 3] * (235 - lum) / 35); // soften the edge
    }
    ctx.putImageData(d, 0, 0);
    const id = registerImage({ src: c.toDataURL('image/png'), width: c.width, height: c.height }, `${src.name || 'Signature'} (transparent)`);
    changeSelected(x => { x.imageId = id; });
    const el = elFor(o.id);
    if (el) el.querySelector('img').src = S.images.get(id).src;
    S.sessionImages = [id, ...S.sessionImages.filter(x => x !== o.imageId && x !== id)];
    refreshSessionSigs();
    toast('White background removed.');
  }

  async function showPresets() {
    let list = [];
    try { list = await sigStore.all(); } catch { $('#presets').innerHTML = '<div class="mini">Signature library is unavailable in this browser.</div>'; return; }
    const q = $('#sigSearch').value.trim().toLowerCase();
    list.sort((a, b) => (b.lastUsed || b.createdAt || 0) - (a.lastUsed || a.createdAt || 0));
    if (q) list = list.filter(x => x.name.toLowerCase().includes(q));
    $('#presets').innerHTML = list.length
      ? list.map(x => `<div class="preset"><button type="button" data-p="${x.id}" class="sigPick" title="Place on this page"><img src="${esc(safeImageSrc(x.src))}" alt=""><span>${esc(x.name)}</span></button><button type="button" data-r="${x.id}" title="Rename" aria-label="Rename ${esc(x.name)}">✎</button><button type="button" data-d="${x.id}" title="Delete" aria-label="Delete ${esc(x.name)}">×</button></div>`).join('')
      : '<div class="mini">No saved signatures.</div>';
    $$('[data-p]', $('#presets')).forEach(b => {
      b.onclick = async () => {
        const x = (await sigStore.all()).find(v => v.id === b.dataset.p);
        if (!x) return;
        x.lastUsed = Date.now();
        await sigStore.put(x);
        const img = await loadImage(x.src);
        placeImage(registerImage({ src: x.src, width: img.naturalWidth, height: img.naturalHeight }, x.name));
      };
    });
    $$('[data-r]', $('#presets')).forEach(b => {
      b.onclick = async () => {
        const x = (await sigStore.all()).find(v => v.id === b.dataset.r);
        const name = x && prompt('Signature name:', x.name);
        if (name?.trim()) { x.name = name.trim(); await sigStore.put(x); showPresets(); }
      };
    });
    $$('[data-d]', $('#presets')).forEach(b => {
      b.onclick = async () => { if (confirm('Delete this saved signature from this device?')) { await sigStore.remove(b.dataset.d); showPresets(); } };
    });
  }

  async function saveToLibrary(src, defaultName) {
    const name = prompt('Name for this signature (stored in this browser only):', defaultName || 'My signature');
    if (!name?.trim()) return;
    try { await sigStore.put({ id: newId(), name: name.trim(), src, createdAt: Date.now() }); toast('Saved to the signature library on this device.'); $('#savedSigsBox').open = true; showPresets(); }
    catch { toast('Could not save the signature in this browser.', 'error'); }
  }

  // Signature pad
  function initSignaturePad() {
    const pad = $('#sigPad'), ctx = pad.getContext('2d');
    let drawing = false, last = null, hasInk = false;
    const pos = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
    const clear = () => { ctx.clearRect(0, 0, pad.width, pad.height); hasInk = false; delete $('#sigModal').dataset.dirty; };
    pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); drawing = true; last = pos(e); });
    pad.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = $('#sigInk').value;
      ctx.lineWidth = +$('#sigWidth').value * (e.pressure && e.pointerType === 'pen' ? 0.6 + e.pressure : 1);
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      hasInk = true;
      $('#sigModal').dataset.dirty = '1';
    });
    const end = () => { drawing = false; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    $('#sigClear').onclick = clear;
    $('#drawSignature').onclick = () => { clear(); $('#sigModal').hidden = false; };
    $('#sigUse').onclick = () => {
      if (!hasInk) return toast('Draw a signature first.', 'error');
      // Trim to the inked area.
      const d = ctx.getImageData(0, 0, pad.width, pad.height).data;
      let minX = pad.width, minY = pad.height, maxX = 0, maxY = 0;
      for (let y = 0; y < pad.height; y++) for (let x = 0; x < pad.width; x++) if (d[(y * pad.width + x) * 4 + 3] > 10) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const m = 6, w = maxX - minX + 1 + 2 * m, h = maxY - minY + 1 + 2 * m;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      out.getContext('2d').drawImage(pad, minX - m, minY - m, w, h, 0, 0, w, h);
      $('#sigModal').hidden = true;
      placeImage(registerImage({ src: out.toDataURL('image/png'), width: w, height: h }, 'Drawn signature'));
    };
  }

  // ---------- thumbnails (lazy) ----------
  function buildThumbnails() {
    const nav = $('#thumbs');
    thumbObserver?.disconnect();
    nav.replaceChildren();
    if (!S.pdf) return;
    const myDoc = S.docToken;
    const withObjects = new Set(S.objects.map(o => o.page));
    thumbObserver = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting || en.target.dataset.rendered) continue;
        en.target.dataset.rendered = '1';
        renderThumb(en.target, +en.target.dataset.page, myDoc);
      }
    }, { root: nav, rootMargin: '200px' });
    for (let n = 1; n <= S.pdf.numPages; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'thumb';
      b.dataset.page = n;
      b.setAttribute('aria-label', `Page ${n}`);
      b.innerHTML = `<canvas width="80" height="104"></canvas><span>${n}${withObjects.has(n) ? ' •' : ''}</span>`;
      b.title = withObjects.has(n) ? `Page ${n} (has edits)` : `Page ${n}`;
      b.onclick = () => goToPage(n);
      nav.appendChild(b);
      thumbObserver.observe(b);
    }
    updatePageUI();
  }
  function updateThumbMarkers() {
    const pages = new Set(S.objects.map(o => o.page));
    for (const b of $$('.thumb')) {
      const n = +b.dataset.page;
      b.querySelector('span').textContent = `${n}${pages.has(n) ? ' •' : ''}`;
      b.title = pages.has(n) ? `Page ${n} (has edits)` : `Page ${n}`;
    }
  }
  async function renderThumb(btn, n, myDoc) {
    try {
      const page = await S.pdf.getPage(n);
      if (myDoc !== S.docToken) return;
      const vp = page.getViewport({ scale: 0.18 });
      const c = btn.querySelector('canvas');
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    } catch { /* thumbnail failures are non-fatal */ }
  }

  // ---------- saving ----------
  function requestSave() {
    if (!S.pdf || S.saving) return;
    if (drag) finishDrag(true);
    document.activeElement?.blur?.();
    if (!$('#askReview').checked) { doSave(); return; }
    $('#pdfReviewed').checked = false;
    $('#skipReview').checked = false;
    $('#pdfCheckModal').hidden = false;
  }

  async function doSave() {
    if (S.saving) return;
    S.saving = true;
    $('#save').disabled = true;
    $('#save').textContent = 'Saving…';
    busy('Preparing PDF…');
    try {
      for (const p of new Set(S.objects.map(o => o.page))) await ensurePage(p);
      const pages = new Map([...S.pages].map(([n, p]) => [n, { view: p.view, rotate: p.rotate }]));
      const { bytes, warnings } = await buildEditedPdf({ pdfBytes: S.bytes, objects: S.objects, images: S.images, formEdits: S.formEdits, pages });
      const base = (S.file?.name || 'document.pdf').replace(/\.pdf$/i, '').replace(/(_edited)+$/i, '');
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${base}_edited.pdf`);
      S.dirty = false;
      clearRecovery();
      if (warnings.length) alert(`Saved with notes:\n\n• ${warnings.join('\n• ')}`);
      else toast('PDF saved to your downloads.');
    } catch (err) {
      alert(err?.message || 'The PDF could not be saved. No file was written.');
    } finally {
      S.saving = false;
      $('#save').disabled = !S.pdf;
      $('#save').textContent = 'Save PDF';
      busy(null);
    }
  }

  // ---------- wiring ----------
  $('#pdfInput').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  $('#pdfInputEmpty').onchange = e => { openFile(e.target.files[0]); e.target.value = ''; };
  $('#save').onclick = requestSave;
  $('#confirmPdfSave').onclick = () => {
    if (!$('#pdfReviewed').checked) return toast('Tick the review box to confirm, then save.', 'error');
    if ($('#skipReview').checked) { $('#askReview').checked = false; writeLocal(PDF_PREF_KEY, { ...readLocal(PDF_PREF_KEY, {}), skipReview: true }); }
    $('#pdfCheckModal').hidden = true;
    doSave();
  };
  $('#pdfCheckModal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.type === 'checkbox') { e.preventDefault(); $('#confirmPdfSave').click(); } });
  $('#askReview').checked = !readLocal(PDF_PREF_KEY, {}).skipReview;
  $('#askReview').onchange = e => writeLocal(PDF_PREF_KEY, { ...readLocal(PDF_PREF_KEY, {}), skipReview: !e.target.checked });
  $$('[data-tool]').forEach(b => { b.onclick = () => setTool(S.tool === b.dataset.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool); });
  $('#addImage').onclick = () => (S.pdf ? $('#imageInput').click() : toast('Open a PDF first.', 'error'));
  $('#imageInput').onchange = e => { if (e.target.files[0]) insertImageFile(e.target.files[0]); e.target.value = ''; };
  $('#existingText').onchange = drawInteractionMasksOnly;
  $('#nativeFields').onchange = () => render();

  $('#fontFamily').onchange = e => changeSelected(o => { o.fontFamily = e.target.value; }, { remember: o => ({ fontFamily: o.fontFamily }) });
  $('#fontSize').onchange = e => setFontSize(e.target.value);
  $('#fontMinus').onclick = () => { const o = selectedObj(); if (o) setFontSize(o.fontSize - 0.5); };
  $('#fontPlus').onclick = () => { const o = selectedObj(); if (o) setFontSize(o.fontSize + 0.5); };
  $$('#sizePresets [data-size]').forEach(b => { b.onclick = () => setFontSize(b.dataset.size); });
  $('#boldBtn').onclick = () => changeSelected(o => { o.bold = !o.bold; });
  $('#italicBtn').onclick = () => changeSelected(o => { o.italic = !o.italic; });
  $('#textColor').onchange = e => changeSelected(o => { o.color = e.target.value; }, { remember: o => ({ color: o.color }) });
  $$('[data-align]').forEach(b => { b.onclick = () => changeSelected(o => { o.align = b.dataset.align; }); });
  $('#lineHeight').onchange = e => changeSelected(o => { o.lineHeight = +e.target.value; }, { remember: o => ({ lineHeight: o.lineHeight }) });
  $('#bgOn').onchange = e => changeSelected(o => { o.bg = e.target.checked ? $('#bgColor').value : null; });
  $('#bgColor').onchange = e => { $('#bgOn').checked = true; changeSelected(o => { o.bg = e.target.value; }); };
  $('#fitToggle').onchange = e => changeSelected(o => { o.fitToBox = e.target.checked; if (o.fitToBox) o.fixedWidth = true; });

  $('#lockAspect').onchange = e => changeSelected(o => { o.lockAspect = e.target.checked; });
  $('#objWidth').onchange = e => changeSelected(o => { const n = Math.max(4, +e.target.value || 4); if (o.lockAspect !== false) o.h *= n / o.w; o.w = n; });
  $('#objHeight').onchange = e => changeSelected(o => { const n = Math.max(4, +e.target.value || 4); if (o.lockAspect !== false) o.w *= n / o.h; o.h = n; });
  $('#objX').onchange = e => changeSelected(o => { o.x = +e.target.value || 0; });
  $('#objY').onchange = e => changeSelected(o => { o.y = +e.target.value || 0; });
  $$('[data-nudge]').forEach(b => { b.onclick = () => { const [dx, dy] = b.dataset.nudge.split(',').map(Number); changeSelected(o => { o.x += dx; o.y += dy; }); }; });
  $('#whiteToClear').onclick = () => makeWhiteTransparent();
  $('#savePresetFromSel').onclick = () => { const o = selectedObj(); if (o?.type === 'image') saveToLibrary(S.images.get(o.imageId).src, S.images.get(o.imageId).name); };
  $('#bringForward').onclick = () => arrange(1);
  $('#sendBackward').onclick = () => arrange(-1);
  $('#duplicate').onclick = duplicateSelected;
  $('#applyPages').onclick = copyToPages;
  $('#delete').onclick = deleteSelected;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#prev').onclick = () => goToPage(S.pageNum - 1);
  $('#next').onclick = () => goToPage(S.pageNum + 1);
  $('#pageInput').onchange = e => goToPage(+e.target.value);
  $('#zoomIn').onclick = () => zoomStep(1);
  $('#zoomOut').onclick = () => zoomStep(-1);
  $('#zoomSelect').onchange = e => { const v = e.target.value; if (v === 'fit-width' || v === 'fit-page') setZoomMode(v); else if (v !== 'custom') setScale(+v * PX_PER_PT); };
  $('#toggleThumbs').onclick = () => $('#thumbs').classList.toggle('hidden');
  $('#sigSearch').oninput = showPresets;
  $('#savePreset').onclick = () => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/png,image/jpeg';
    i.onchange = async () => {
      if (!i.files[0]) return;
      try { const data = await normaliseImageFile(i.files[0]); await saveToLibrary(data.src, i.files[0].name.replace(/\.[^.]+$/, '')); }
      catch (err) { toast(err.message, 'error'); }
    };
    i.click();
  };
  initSignaturePad();
  showPresets();
  if (window.innerWidth < 900) $('#thumbs').classList.add('hidden'); // give the page room on phones

  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (S.pdf && S.zoomMode && isActive()) render(); }, 150); });

  const main = $('#pdfMain');
  ['dragenter', 'dragover'].forEach(ev => main.addEventListener(ev, e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); main.classList.add('dropping'); } }));
  main.addEventListener('dragleave', e => { if (!main.contains(e.relatedTarget)) main.classList.remove('dropping'); });
  main.addEventListener('drop', e => {
    main.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    const pdfFile = files.find(x => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
    const image = files.find(x => /^image\/(png|jpeg)$/.test(x.type));
    if (pdfFile) openFile(pdfFile);
    else if (image && S.pdf) insertImageFile(image);
    else toast('Drop a PDF to open it, or a PNG/JPEG to insert it.', 'error');
  });

  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

  window.addEventListener('keydown', e => {
    if (!isActive() || document.querySelector('.modal:not([hidden])')) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); requestSave(); return; }
    if (drag && e.key === 'Escape') { e.preventDefault(); finishDrag(false); return; }
    if (isTypingTarget(e.target)) return; // native undo/arrows inside text fields keep working
    if (mod && (key === '=' || key === '+')) { e.preventDefault(); zoomStep(1); return; }
    if (mod && key === '-') { e.preventDefault(); zoomStep(-1); return; }
    if (mod && key === '0') { e.preventDefault(); setZoomMode('fit-width'); return; }
    if (e.key === 'PageDown') { e.preventDefault(); goToPage(S.pageNum + 1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); goToPage(S.pageNum - 1); return; }
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (mod && key === 'c' && selectedObj()) { clipboardObj = structuredClone(selectedObj()); return; }
    if (mod && key === 'v' && clipboardObj && S.pdf) {
      e.preventDefault();
      const copy = structuredClone(clipboardObj);
      delete copy.id;
      copy.page = S.pageNum;
      copy.x += 12;
      copy.y += 12;
      if (copy.type === 'replaceText') { copy.type = 'text'; delete copy.source; delete copy.original; }
      const p = pageInfo();
      Object.assign(copy, clampToPage(copy, p.width, p.height));
      addObject(copy);
      return;
    }
    if (mod) return;
    const o = selectedObj();
    if (e.key === 'Escape') { if (o) select(null); else setTool('select'); return; }
    if (!o) {
      if (key === 'v') setTool('select');
      if (key === 't' && S.pdf) setTool('text');
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (e.key === 'Enter' && isText(o)) { e.preventDefault(); elFor(o.id)?.querySelector('textarea')?.focus(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      changeSelected(x => { x.x += arrows[e.key][0] * step; x.y += arrows[e.key][1] * step; });
    }
  });

  // Test hook for the Playwright suite (development server only; never in production builds).
  if (import.meta.env?.DEV) window.__pdfEditor = { state: S, layoutText, fontMetrics };
  return { openFile, hasPdf: () => !!S.pdf, onShow: () => { if (S.pdf && S.zoomMode) render(); } };
}
