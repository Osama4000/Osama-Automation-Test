// Builds the edited PDF. Works in the browser and in Node (used by the automated tests).
//
// Original pages are kept as vector content: new text, images and marks are drawn on top with
// pdf-lib, and nothing is rasterised. Positions are converted from view points to PDF user
// space per page (handles /Rotate, CropBox offsets, portrait and landscape).
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { layoutText, pageMapper, hexToRgb01, sanitizeForPdf, standardFontName, fontMetrics } from './geometry.js';

export const TEXT_TYPES = ['text', 'replaceText'];

/** A replacement of existing text that the user opened but did not actually change. */
export function isUnchangedReplacement(o) {
  if (o.type !== 'replaceText' || !o.original) return false;
  const a = o.original;
  const same = (p, q) => Math.abs((p ?? 0) - (q ?? 0)) < 0.01;
  return o.text === a.text && same(o.x, a.x) && same(o.y, a.y) && same(o.fontSize, a.fontSize)
    && !!o.bold === !!a.bold && !!o.italic === !!a.italic && (o.color || '#000000') === '#000000' && !o.bg
    && (o.fontFamily || 'helvetica') === (a.fontFamily || 'helvetica') && (o.align || 'left') === 'left' && !o.fitToBox;
}

export function dataUrlToBytes(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Unsupported image data.');
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { bytes, mime: m[1] || '' };
}

/**
 * Remove the original text under "replace text" objects using MuPDF redaction.
 * Only text glyphs are removed; images and line art (field borders, shading) are preserved,
 * so no white box is painted over the form. MuPDF is loaded lazily (it is ~10 MB of WASM).
 */
export async function removeOriginalText(inputBytes, replacements) {
  if (!replacements.length) return inputBytes;
  const mupdf = await import('mupdf');
  let mdoc;
  try {
    mdoc = mupdf.Document.openDocument(inputBytes.slice(), 'application/pdf');
    const pdfDoc = mdoc.asPDF();
    if (!pdfDoc) throw new Error('Not a PDF document.');
    const byPage = new Map();
    for (const o of replacements) {
      if (!byPage.has(o.page)) byPage.set(o.page, []);
      byPage.get(o.page).push(o);
    }
    for (const [pageNo, items] of byPage) {
      const page = pdfDoc.loadPage(pageNo - 1);
      for (const o of items) {
        // MuPDF page space is top-left based, matching our view points.
        const s = o.source;
        const padX = Math.min(0.8, Math.max(0.15, s.fontSize * 0.035));
        const padY = Math.min(0.5, Math.max(0.1, s.fontSize * 0.025));
        const red = page.createAnnotation('Redact');
        red.setRect([Math.max(0, s.x - padX), Math.max(0, s.y - padY), s.x + s.w + padX, s.y + s.h + padY]);
        red.update();
      }
      page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
      page.destroy?.();
    }
    // encrypt=none also drops "restrict editing" (owner-password) protection; see removeRestrictions.
    return new Uint8Array(pdfDoc.saveToBuffer('garbage,compress,encrypt=none').asUint8Array());
  } catch (err) {
    throw new Error('The original text could not be removed from this PDF, so nothing was saved. ' + (err?.message || ''));
  } finally {
    try { mdoc?.destroy(); } catch { /* ignore */ }
  }
}

/**
 * Many system-generated PDFs are "restricted" with an owner password only: anyone can open
 * them, but pdf-lib refuses to load them for saving. MuPDF can rewrite such a file without the
 * restriction. Files that need a password to OPEN cannot be handled and are reported clearly.
 */
export async function removeRestrictions(inputBytes) {
  const mupdf = await import('mupdf');
  let mdoc;
  try {
    mdoc = mupdf.Document.openDocument(inputBytes.slice(), 'application/pdf');
    if (mdoc.needsPassword()) throw new Error('needs-password');
    return new Uint8Array(mdoc.asPDF().saveToBuffer('encrypt=none').asUint8Array());
  } catch (err) {
    throw new Error(err?.message === 'needs-password'
      ? 'This PDF needs a password to open, so it cannot be saved with edits. Remove the password in your PDF software first.'
      : 'This PDF is protected and could not be prepared for saving.');
  } finally {
    try { mdoc?.destroy(); } catch { /* ignore */ }
  }
}

const isEncryptedError = err => /encrypt/i.test(err?.message || '') || err?.constructor?.name === 'EncryptedPDFError';

async function applyFormEdits(doc, formEdits) {
  if (!formEdits?.size) return [];
  const warnings = [];
  let form;
  try { form = doc.getForm(); } catch { return ['Form fields could not be read; field values were not saved.']; }
  for (const [key, val] of formEdits) {
    const name = key.slice(key.indexOf(':') + 1);
    let f;
    try { f = form.getField(name); } catch { warnings.push(`Field "${name}" was not found.`); continue; }
    try {
      const kind = f.constructor.name;
      if (kind.includes('CheckBox')) (val ? f.check() : f.uncheck());
      else if (kind.includes('RadioGroup') || kind.includes('Dropdown') || kind.includes('OptionList')) f.select(String(val));
      else if (kind.includes('TextField')) f.setText(sanitizeForPdf(String(val)).text);
    } catch { warnings.push(`Field "${name}" could not be updated.`); }
  }
  try { form.updateFieldAppearances(await doc.embedFont(StandardFonts.Helvetica)); } catch { /* keep existing appearances */ }
  return warnings;
}

/**
 * @param {object} args
 * @param {Uint8Array} args.pdfBytes original document
 * @param {object[]} args.objects editor objects (view points)
 * @param {Map<string,{src:string}>} args.images image store referenced by object.imageId
 * @param {Map<string,any>} [args.formEdits]
 * @param {Map<number,{view:number[],rotate:number}>} args.pages page geometry from pdf.js
 * @param {(family:string,bold:boolean)=>number[]} [args.metrics] font metrics used by the preview
 */
export async function buildEditedPdf({ pdfBytes, objects, images, formEdits, pages, metrics = fontMetrics }) {
  const warnings = [];
  const active = objects.filter(o => !isUnchangedReplacement(o) && !(TEXT_TYPES.includes(o.type) && !String(o.text || '').trim() && o.type === 'text'));
  const replacements = active.filter(o => o.type === 'replaceText' && o.source);
  const cleaned = await removeOriginalText(pdfBytes, replacements);

  let doc;
  try { doc = await PDFDocument.load(cleaned, { updateMetadata: false }); }
  catch (err) {
    if (!isEncryptedError(err)) throw new Error('This PDF could not be prepared for saving.');
    doc = await PDFDocument.load(await removeRestrictions(cleaned), { updateMetadata: false });
    warnings.push('This PDF had "restrict editing" protection. The saved copy is unrestricted so your edits could be kept.');
  }
  warnings.push(...await applyFormEdits(doc, formEdits));

  const fonts = new Map();
  const font = async name => { if (!fonts.has(name)) fonts.set(name, await doc.embedFont(name)); return fonts.get(name); };
  const embedded = new Map();
  const replacedChars = new Set();

  for (const o of active) {
    const geo = pages.get(o.page);
    if (!geo || o.page < 1 || o.page > doc.getPageCount()) { warnings.push(`An item on page ${o.page} was skipped because the page does not exist.`); continue; }
    const page = doc.getPage(o.page - 1);
    const map = pageMapper(geo.view, geo.rotate);
    const rot = degrees(map.rotate);
    const anchor = (x, y) => map.toPdf(x, y); // bottom-left of an upright box = view (x, y + h)
    const black = rgb(0, 0, 0);

    if (o.type === 'whiteout' || o.type === 'rect') {
      const a = anchor(o.x, o.y + o.h);
      page.drawRectangle({ x: a.x, y: a.y, width: o.w, height: o.h, rotate: rot,
        ...(o.type === 'whiteout' ? { color: rgb(1, 1, 1) } : { borderColor: black, borderWidth: 1 }) });
    } else if (TEXT_TYPES.includes(o.type)) {
      const lay = layoutText(o, metrics(o.fontFamily, o.bold));
      sanitizeForPdf(o.text).replaced.forEach(c => replacedChars.add(c));
      if (o.bg) {
        const a = anchor(o.x, o.y + lay.height);
        const c = hexToRgb01(o.bg);
        page.drawRectangle({ x: a.x, y: a.y, width: lay.width, height: lay.height, color: rgb(c.r, c.g, c.b), rotate: rot });
      }
      const f = await font(standardFontName(o.fontFamily, o.bold, o.italic));
      const c = hexToRgb01(o.color || '#000000');
      for (const line of lay.lines) {
        if (!line.text) continue;
        const a = anchor(o.x + line.dx, o.y + line.baseline);
        page.drawText(line.text, { x: a.x, y: a.y, size: lay.fontSize, font: f, color: rgb(c.r, c.g, c.b), rotate: rot });
      }
    } else if (o.type === 'check' || o.type === 'xmark') {
      // Vector strokes rather than a glyph: standard fonts have no reliable check mark.
      const t = Math.max(1, Math.min(o.w, o.h) * (o.type === 'check' ? 0.085 : 0.075));
      const pts = o.type === 'check'
        ? [[[0.16, 0.52], [0.39, 0.76]], [[0.39, 0.76], [0.86, 0.2]]]
        : [[[0.2, 0.2], [0.8, 0.8]], [[0.2, 0.8], [0.8, 0.2]]];
      for (const [[x1, y1], [x2, y2]] of pts) {
        page.drawLine({ start: anchor(o.x + o.w * x1, o.y + o.h * y1), end: anchor(o.x + o.w * x2, o.y + o.h * y2), thickness: t, color: black });
      }
    } else if (o.type === 'radio') {
      const c = anchor(o.x + o.w / 2, o.y + o.h / 2);
      const swap = map.rotate % 180 !== 0;
      page.drawEllipse({ x: c.x, y: c.y, xScale: (swap ? o.h : o.w) * 0.24, yScale: (swap ? o.w : o.h) * 0.24, color: black });
    } else if (o.type === 'image') {
      const img = images.get(o.imageId);
      if (!img) { warnings.push('An image was skipped because its data is missing.'); continue; }
      if (!embedded.has(o.imageId)) {
        const { bytes, mime } = dataUrlToBytes(img.src);
        let im;
        try { im = mime.includes('png') ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
        catch { im = mime.includes('png') ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); }
        embedded.set(o.imageId, im);
      }
      const a = anchor(o.x, o.y + o.h);
      page.drawImage(embedded.get(o.imageId), { x: a.x, y: a.y, width: o.w, height: o.h, rotate: rot, opacity: o.opacity ?? 1 });
    }
  }
  if (replacedChars.size) warnings.push(`These characters are not supported by the standard PDF fonts and were simplified: ${[...replacedChars].join(' ')}`);
  return { bytes: await doc.save(), warnings };
}
