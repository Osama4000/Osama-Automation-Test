import { describe, it, expect } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, degrees } from 'pdf-lib';
import { viewportTransform, pageMapper, layoutText, parsePageRanges, resizeFromHandle, sanitizeForPdf, clampToPage, measureText } from '../../src/pdf/geometry.js';

describe('page coordinate mapping', () => {
  const boxes = [[0, 0, 595.28, 841.89], [0, 0, 841.89, 595.28], [50, 60, 645, 840]];
  for (const view of boxes) for (const rotation of [0, 90, 180, 270]) {
    it(`matches pdf.js viewport for view ${view.join(',')} rotate ${rotation}`, async () => {
      // Build a real page with this CropBox and /Rotate, and use pdf.js's own viewport.
      const doc = await PDFDocument.create();
      const page = doc.addPage([1000, 1000]);
      page.setCropBox(view[0], view[1], view[2] - view[0], view[3] - view[1]);
      page.setRotation(degrees(rotation));
      const loaded = await pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false }).promise;
      const vp = (await loaded.getPage(1)).getViewport({ scale: 1 });
      const mine = viewportTransform(view, rotation);
      mine.matrix.forEach((v, i) => expect(v).toBeCloseTo(vp.transform[i], 6));
      expect(mine.width).toBeCloseTo(vp.width, 6);
      const map = pageMapper(view, rotation);
      for (const [x, y] of [[0, 0], [100, 200], [mine.width, mine.height]]) {
        const [px, py] = vp.convertToPdfPoint(x, y);
        const p = map.toPdf(x, y);
        expect(p.x).toBeCloseTo(px, 6);
        expect(p.y).toBeCloseTo(py, 6);
      }
    });
  }
});

describe('text layout', () => {
  const base = { text: 'Hello', fontFamily: 'helvetica', fontSize: 12, lineHeight: 1.2 };
  it('keeps the requested point size regardless of anything else', () => {
    for (const size of [10, 12, 14]) expect(layoutText({ ...base, fontSize: size }).fontSize).toBe(size);
  });
  it('lays out multiple lines with consistent spacing', () => {
    const lay = layoutText({ ...base, text: 'one\ntwo\nthree' });
    expect(lay.lines).toHaveLength(3);
    expect(lay.lines[1].baseline - lay.lines[0].baseline).toBeCloseTo(14.4, 6);
    expect(lay.height).toBeCloseTo(3 * 14.4, 6);
  });
  it('measures with the same font metrics as the export', () => {
    expect(layoutText(base).contentWidth).toBeCloseTo(measureText('Hello', { family: 'helvetica', size: 12 }), 6);
  });
  it('shrinks only when fit-to-box is on, and then fits the box', () => {
    const long = { ...base, text: 'A rather long line of text', w: 60 };
    expect(layoutText(long).fontSize).toBe(12);
    const fit = layoutText({ ...long, fitToBox: true });
    expect(fit.fontSize).toBeLessThan(12);
    expect(fit.contentWidth).toBeLessThanOrEqual(59.0001);
  });
  it('aligns within the box', () => {
    const lay = layoutText({ ...base, align: 'right', fixedWidth: true, w: 200 });
    expect(lay.lines[0].dx + lay.lines[0].width).toBeCloseTo(199, 6);
    const c = layoutText({ ...base, align: 'center', fixedWidth: true, w: 200 });
    expect(c.lines[0].dx).toBeCloseTo((200 - c.lines[0].width) / 2, 6);
  });
  it('never clips: a fixed-width box grows to fit longer text', () => {
    const lay = layoutText({ ...base, text: 'x'.repeat(40), fixedWidth: true, w: 20 });
    expect(lay.width).toBeGreaterThan(lay.contentWidth);
  });
});

describe('helpers', () => {
  it('parses page ranges', () => {
    expect(parsePageRanges('1-3, 5', 6)).toEqual([1, 2, 3, 5]);
    expect(() => parsePageRanges('0', 6)).toThrow();
    expect(() => parsePageRanges('2-9', 6)).toThrow();
    expect(() => parsePageRanges('abc', 6)).toThrow();
  });
  it('keeps aspect ratio when resizing from any corner', () => {
    const orig = { x: 100, y: 100, w: 150, h: 50 };
    for (const h of ['se', 'nw', 'ne', 'sw']) {
      const r = resizeFromHandle(orig, h, { x: 400, y: 20 }, { aspect: 3 });
      expect(r.w / r.h).toBeCloseTo(3, 6);
    }
    const se = resizeFromHandle(orig, 'se', { x: 400, y: 200 }, { aspect: 3 });
    expect([se.x, se.y]).toEqual([100, 100]); // opposite corner stays put
    const nw = resizeFromHandle(orig, 'nw', { x: 50, y: 50 }, { aspect: 3 });
    expect(nw.x + nw.w).toBeCloseTo(250, 6);
    expect(nw.y + nw.h).toBeCloseTo(150, 6);
  });
  it('clamps objects onto the page', () => {
    expect(clampToPage({ x: -20, y: 900, w: 100, h: 40 }, 595, 842)).toEqual({ x: 0, y: 802 });
  });
  it('simplifies characters that standard PDF fonts cannot encode', () => {
    const r = sanitizeForPdf('Łukasz Zoë → ok');
    expect(r.text).toBe('Lukasz Zoë ? ok');
    expect(r.replaced).toEqual(['Ł', '→']);
  });
});
