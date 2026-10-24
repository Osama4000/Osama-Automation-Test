// End-to-end export checks in Node: build an edited PDF from editor objects, re-open it with
// pdf.js and verify that sizes and positions match what the editor model says.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { makeFixtures } from '../fixtures/make-fixtures.js';
import { buildEditedPdf, isUnchangedReplacement, removeRestrictions } from '../../src/pdf/export.js';
import { layoutText, fontMetrics } from '../../src/pdf/geometry.js';

let dir;
beforeAll(async () => { dir = await makeFixtures(); });
const bytesOf = name => new Uint8Array(readFileSync(join(dir, name)));
const pngDataUrl = () => `data:image/png;base64,${readFileSync(join(dir, 'signature.png')).toString('base64')}`;

async function open(bytes) { return pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; }
async function pageGeometry(doc) {
  const pages = new Map();
  for (let n = 1; n <= doc.numPages; n++) { const p = await doc.getPage(n); pages.set(n, { view: [...p.view], rotate: p.rotate }); }
  return pages;
}
/** Text items of a page in view coordinates (top-left origin, as the editor sees them). */
async function viewText(doc, n) {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items.filter(i => i.str.trim()).map(i => {
    const t = pdfjs.Util.transform(vp.transform, i.transform);
    return { str: i.str, x: t[4], baseline: t[5], size: Math.hypot(t[2], t[3]), horizontal: Math.abs(t[1]) < 1e-6 };
  });
}
const text = (o) => ({ id: o.str, type: 'text', page: o.page ?? 1, fontFamily: 'helvetica', lineHeight: 1.2, color: '#000000', align: 'left', ...o });

describe('PDF export', () => {
  it('embeds text at exactly 10, 12 and 14 pt at the previewed baseline, without any background box', async () => {
    const src = bytesOf('single.pdf');
    const doc = await open(src);
    const objects = [10, 12, 14].map((size, i) => text({ text: `Size ${size} sample`, fontSize: size, x: 300, y: 100 + i * 40 }));
    const { bytes, warnings } = await buildEditedPdf({ pdfBytes: src, objects, images: new Map(), pages: await pageGeometry(doc) });
    expect(warnings).toEqual([]);
    const out = await open(bytes);
    const items = await viewText(out, 1);
    for (const o of objects) {
      const it_ = items.find(t => t.str === o.text);
      expect(it_, o.text).toBeTruthy();
      expect(it_.size).toBeCloseTo(o.fontSize, 3);
      const lay = layoutText(o, fontMetrics('helvetica'));
      expect(it_.x).toBeCloseTo(o.x, 3);
      expect(it_.baseline).toBeCloseTo(o.y + lay.lines[0].baseline, 3);
    }
    // No filled rectangles were added: compare fill operations before/after.
    const countFills = async d => (await (await d.getPage(1)).getOperatorList()).fnArray.filter(f => f === pdfjs.OPS.fill || f === pdfjs.OPS.eoFill).length;
    expect(await countFills(out)).toBe(await countFills(doc));
  });

  it('draws a background only when explicitly requested', async () => {
    const src = bytesOf('single.pdf');
    const doc = await open(src);
    const countFills = async d => (await (await d.getPage(1)).getOperatorList()).fnArray.filter(f => f === pdfjs.OPS.fill).length;
    const { bytes } = await buildEditedPdf({ pdfBytes: src, objects: [text({ text: 'Highlighted', fontSize: 10, x: 300, y: 300, bg: '#ffff00' })], images: new Map(), pages: await pageGeometry(doc) });
    expect(await countFills(await open(bytes))).toBe(await countFills(doc) + 1);
  });

  it('places text correctly on landscape, rotated and cropped pages, and multi-line text', async () => {
    const src = bytesOf('multi.pdf');
    const doc = await open(src);
    const pages = await pageGeometry(doc);
    expect(pages.get(3).rotate).toBe(90);
    const objects = [1, 2, 3, 4].map(p => text({ page: p, text: `Marker ${p}\nSecond line ${p}`, fontSize: 11, x: 120, y: 150 }));
    const { bytes } = await buildEditedPdf({ pdfBytes: src, objects, images: new Map(), pages });
    const out = await open(bytes);
    for (const o of objects) {
      const items = await viewText(out, o.page);
      const lay = layoutText(o, fontMetrics('helvetica'));
      const a = items.find(t => t.str === `Marker ${o.page}`), b = items.find(t => t.str === `Second line ${o.page}`);
      expect(a.horizontal, `page ${o.page} upright`).toBe(true);
      expect(a.x).toBeCloseTo(120, 3);
      expect(a.baseline).toBeCloseTo(150 + lay.lines[0].baseline, 3);
      expect(b.baseline - a.baseline).toBeCloseTo(11 * 1.2, 3);
      expect(a.size).toBeCloseTo(11, 3);
    }
    expect(out.numPages).toBe(4);
  });

  it('keeps PNG transparency and the exact image rectangle, on every page orientation', async () => {
    const src = bytesOf('multi.pdf');
    const doc = await open(src);
    const images = new Map([['sig', { src: pngDataUrl(), width: 300, height: 100 }]]);
    const objects = [1, 2, 3, 4].map(p => ({ id: `i${p}`, type: 'image', page: p, imageId: 'sig', x: 200, y: 300, w: 150, h: 50 }));
    const { bytes } = await buildEditedPdf({ pdfBytes: src, objects, images, pages: await pageGeometry(doc) });
    const lib = await PDFDocument.load(bytes);
    const xobjects = lib.getPages()[0].node.Resources().lookup(PDFName.of('XObject'));
    const img = [...xobjects.asMap().values()].map(r => lib.context.lookup(r)).find(x => x.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
    expect(img.dict.get(PDFName.of('SMask'))).toBeTruthy(); // alpha channel preserved
    // The image's transform maps the unit square to the expected view rectangle.
    const out = await open(bytes);
    for (const o of objects) {
      const page = await out.getPage(o.page);
      const vp = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      let found = null;
      ops.fnArray.forEach((fn, i) => {
        if (fn === pdfjs.OPS.save) stack.push(ctm);
        if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
        if (fn === pdfjs.OPS.transform) ctm = pdfjs.Util.transform(ctm, ops.argsArray[i]);
        if (fn === pdfjs.OPS.paintImageXObject) found = ctm;
      });
      const m = pdfjs.Util.transform(vp.transform, found);
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => pdfjs.Util.applyTransform([u, v], m));
      const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
      expect(Math.min(...xs)).toBeCloseTo(200, 3);
      expect(Math.min(...ys)).toBeCloseTo(300, 3);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(150, 3);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(50, 3);
    }
  });

  it('removes the original text when printed text is replaced, and skips untouched replacements', async () => {
    const src = bytesOf('single.pdf');
    const doc = await open(src);
    const pages = await pageGeometry(doc);
    const line = (await viewText(doc, 1)).find(t => t.str === 'Jane Example');
    const source = { x: line.x, y: line.baseline - line.size, w: 62, h: line.size * 1.12, fontSize: line.size };
    const k = layoutText({ text: 'x', fontSize: 10, fontFamily: 'helvetica' }, fontMetrics('helvetica')).lines[0].baseline;
    const base = { id: 'r', type: 'replaceText', page: 1, fontFamily: 'helvetica', fontSize: 10, x: line.x, y: line.baseline - k, source, original: { text: 'Jane Example', x: line.x, y: line.baseline - k, fontSize: 10, fontFamily: 'helvetica' } };
    const untouched = { ...base, text: 'Jane Example' };
    expect(isUnchangedReplacement(untouched)).toBe(true);
    const same = await buildEditedPdf({ pdfBytes: src, objects: [untouched], images: new Map(), pages });
    expect((await viewText(await open(same.bytes), 1)).filter(t => t.str === 'Jane Example')).toHaveLength(1);

    const changed = await buildEditedPdf({ pdfBytes: src, objects: [{ ...base, text: 'Alex Sample' }], images: new Map(), pages });
    const after = await viewText(await open(changed.bytes), 1);
    expect(after.some(t => t.str.includes('Jane Example'))).toBe(false);
    const repl = after.find(t => t.str === 'Alex Sample');
    expect(repl.baseline).toBeCloseTo(line.baseline, 3);
    expect(repl.size).toBeCloseTo(10, 3);
    expect(after.some(t => t.str === 'Patient name:')).toBe(true); // neighbouring text untouched
  }, 30000);

  it('fills native form fields and reports unsupported characters instead of crashing', async () => {
    const src = bytesOf('single.pdf');
    const doc = await open(src);
    const { bytes, warnings } = await buildEditedPdf({
      pdfBytes: src, images: new Map(), pages: await pageGeometry(doc),
      objects: [text({ text: 'Łukasz → test', fontSize: 10, x: 300, y: 400 })],
      formEdits: new Map([['1:reference', 'REF-0001']]),
    });
    expect(warnings.join(' ')).toMatch(/simplified/);
    const lib = await PDFDocument.load(bytes);
    expect(lib.getForm().getTextField('reference').getText()).toBe('REF-0001');
    expect((await viewText(await open(bytes), 1)).some(t => t.str === 'Lukasz ? test')).toBe(true);
  });

  it('saves a "restrict editing" (owner-password) PDF instead of failing at the end', async () => {
    const src = bytesOf('restricted.pdf');
    await expect(PDFDocument.load(src)).rejects.toThrow(/encrypt/i); // what used to break saving
    const doc = await open(src);
    const { bytes, warnings } = await buildEditedPdf({ pdfBytes: src, objects: [text({ text: 'After restriction', fontSize: 10, x: 300, y: 100 })], images: new Map(), pages: await pageGeometry(doc) });
    expect(warnings.join(' ')).toMatch(/restrict editing/);
    expect((await viewText(await open(bytes), 1)).some(t => t.str === 'After restriction')).toBe(true);
  }, 30000);

  it('reports a clear error for PDFs that need a password to open', async () => {
    const mupdf = await import('mupdf');
    const locked = mupdf.Document.openDocument(bytesOf('single.pdf'), 'application/pdf').asPDF().saveToBuffer('encrypt=aes-256,owner-password=o,user-password=u').asUint8Array();
    await expect(removeRestrictions(new Uint8Array(locked))).rejects.toThrow(/needs a password to open/);
  }, 30000);

  it('does not rasterise: original text stays searchable', async () => {
    const src = bytesOf('single.pdf');
    const doc = await open(src);
    const { bytes } = await buildEditedPdf({ pdfBytes: src, objects: [text({ text: 'Added', fontSize: 10, x: 300, y: 100 })], images: new Map(), pages: await pageGeometry(doc) });
    const strs = (await viewText(await open(bytes), 1)).map(t => t.str);
    expect(strs).toEqual(expect.arrayContaining(['Radiology Request Form (TEST DOCUMENT)', 'Examination: MRI Knee', 'Added']));
  });
});
