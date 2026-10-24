// Browser interaction regression tests for the PDF editor (fictional documents only).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeFixtures } from '../fixtures/make-fixtures.js';

let dir;
test.beforeAll(async () => { dir = await makeFixtures(); });

const state = page => page.evaluate(() => {
  const S = window.__pdfEditor.state;
  return { scale: S.scale, pageNum: S.pageNum, selectedId: S.selectedId, history: S.history.length, objects: JSON.parse(JSON.stringify(S.objects)) };
});
const wrapScroll = page => page.$eval('#stageWrap', w => ({ top: w.scrollTop, left: w.scrollLeft }));

async function openPdf(page, name = 'single.pdf') {
  await page.goto('/');
  await page.evaluate(() => { sessionStorage.clear(); });
  await page.locator('.appTab[data-app-tab="pdf"]').click();
  await page.setInputFiles('#pdfInput', join(dir, name));
  await expect(page.locator('#workspace')).toBeVisible();
  await page.waitForFunction(() => document.querySelector('#pdfCanvas').width > 100 && !window.__pdfEditor.state.renderTask);
}
async function setZoom(page, value) {
  await page.selectOption('#zoomSelect', String(value));
  await page.waitForFunction(v => Math.abs(window.__pdfEditor.state.scale - v * 96 / 72) < 1e-6, value);
  await page.waitForFunction(() => !window.__pdfEditor.state.renderTask);
}
async function addSignature(page) {
  await page.setInputFiles('#imageInput', join(dir, 'signature.png'));
  await expect(page.locator('.obj.image')).toHaveCount(1);
  return page.locator('.obj.image');
}
const center = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('text sizes are real points at every zoom, with no background box', async ({ page }) => {
  await openPdf(page);
  await setZoom(page, 1);
  const sizes = [10, 12, 14];
  for (const [i, size] of sizes.entries()) {
    await page.click('[data-tool="text"]');
    const box = await page.locator('#stage').boundingBox();
    await page.mouse.click(box.x + 380, box.y + 200 + i * 60);
    await page.keyboard.type(`Sample ${size}pt`);
    await page.click(`#sizePresets [data-size="${size}"]`);
  }
  await page.keyboard.press('Escape');
  for (const z of [0.5, 1, 1.5, 2]) {
    await setZoom(page, z);
    const s = await state(page);
    const css = await page.$$eval('.obj.text textarea', els => els.map(e => parseFloat(getComputedStyle(e).fontSize)));
    expect(s.objects.map(o => o.fontSize)).toEqual(sizes);
    css.forEach((px, i) => expect(px).toBeCloseTo(sizes[i] * s.scale, 1));
  }
  // Unselected text has a fully transparent background and no border.
  await page.mouse.click(5, 300); // empty sidebar area: blur
  await page.locator('#stage').click({ position: { x: 20, y: 20 } });
  const styles = await page.$$eval('.obj.text', els => els.map(e => ({ bg: getComputedStyle(e).backgroundColor, taBg: getComputedStyle(e.querySelector('textarea')).backgroundColor, border: getComputedStyle(e.querySelector('textarea')).borderTopWidth, outline: getComputedStyle(e).outlineStyle })));
  for (const st of styles) {
    expect(st.bg).toBe('rgba(0, 0, 0, 0)');
    expect(st.taBg).toBe('rgba(0, 0, 0, 0)');
    expect(st.border).toBe('0px');
    expect(st.outline).toBe('none');
  }
});

for (const zoom of [0.5, 1, 1.5, 2]) {
  test(`signature drags 1:1 with the pointer at ${zoom * 100}% zoom`, async ({ page }) => {
    await openPdf(page);
    await setZoom(page, zoom);
    const sig = await addSignature(page);
    await sig.scrollIntoViewIfNeeded();
    const before = (await state(page)).objects[0];
    const b = await sig.boundingBox();
    const start = { x: b.x + b.width * 0.3, y: b.y + b.height * 0.6 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const offsets = [];
    for (const [dx, dy] of [[2, 1], [10, 6], [40, 25], [60, 40]]) {
      await page.mouse.move(start.x + dx, start.y + dy);
      const nb = await sig.boundingBox();
      offsets.push([start.x + dx - nb.x, start.y + dy - nb.y]);
    }
    await page.mouse.up();
    // No jump: once dragging starts the grab point stays under the cursor.
    for (const [ox, oy] of offsets.slice(1)) {
      expect(ox).toBeCloseTo(b.width * 0.3, 0);
      expect(oy).toBeCloseTo(b.height * 0.6, 0);
    }
    const after = (await state(page)).objects[0];
    expect(after.x - before.x).toBeCloseTo(60 / ((zoom * 96) / 72), 2);
    expect(after.y - before.y).toBeCloseTo(40 / ((zoom * 96) / 72), 2);
    expect(after.w).toBeCloseTo(before.w, 6); // dragging never resizes
    expect(after.h).toBeCloseTo(before.h, 6);
  });
}

test('mouse-wheel scrolling while holding a signature keeps it under the cursor', async ({ page }) => {
  await openPdf(page);
  await setZoom(page, 2);
  const sig = await addSignature(page);
  await sig.scrollIntoViewIfNeeded();
  const b = await sig.boundingBox();
  const grab = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const s0 = await state(page), scroll0 = await wrapScroll(page);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 5, grab.y + 5);
  await page.mouse.wheel(0, 240);
  await page.waitForFunction(t => document.querySelector('#stageWrap').scrollTop !== t, scroll0.top);
  const scroll1 = await wrapScroll(page);
  const nb = await sig.boundingBox();
  // Still attached to the cursor on screen…
  expect(center(nb).x).toBeCloseTo(grab.x + 5, 0);
  expect(center(nb).y).toBeCloseTo(grab.y + 5, 0);
  // …and moved down the page by exactly the scrolled distance.
  const s1 = await state(page);
  expect(s1.objects[0].y - s0.objects[0].y).toBeCloseTo((scroll1.top - scroll0.top + 5) / s0.scale, 1);
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.classList.contains('dragging'))).toBe(false);
  expect(s1.objects[0].w).toBeCloseTo(s0.objects[0].w, 6);
});

test('scrolling with a selected (not held) signature does not move it', async ({ page }) => {
  await openPdf(page);
  await setZoom(page, 2);
  const sig = await addSignature(page);
  await sig.click();
  const s0 = (await state(page)).objects[0];
  const b = await sig.boundingBox();
  await page.mouse.move(b.x + 5, b.y + 5);
  await page.mouse.wheel(0, 300);
  await page.mouse.wheel(0, -150);
  await page.waitForTimeout(150);
  const s1 = (await state(page)).objects[0];
  expect(s1).toEqual(s0);
});

test('releasing outside the editor ends the drag cleanly; Escape cancels a drag', async ({ page }) => {
  await openPdf(page);
  await setZoom(page, 1);
  const sig = await addSignature(page);
  const b = await sig.boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 30);
  await page.mouse.move(5, 5); // over the header, outside the page
  await page.mouse.up();
  expect(await page.evaluate(() => document.body.classList.contains('dragging'))).toBe(false);
  const s1 = (await state(page)).objects[0];
  expect(s1.x).toBeGreaterThanOrEqual(0);
  expect(s1.y).toBeGreaterThanOrEqual(0);
  await page.mouse.move(b.x + 200, b.y + 200);
  await page.waitForTimeout(50);
  expect((await state(page)).objects[0]).toEqual(s1); // no stuck drag

  const nb = await sig.boundingBox();
  await page.mouse.move(nb.x + 10, nb.y + 10);
  await page.mouse.down();
  await page.mouse.move(nb.x + 120, nb.y + 90);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await state(page)).objects[0]).toEqual(s1);
});

test('corner resize keeps proportions; arrows nudge; undo/redo; page switching', async ({ page }) => {
  await openPdf(page, 'multi.pdf');
  await setZoom(page, 1);
  const sig = await addSignature(page);
  const s0 = (await state(page)).objects[0];
  await sig.click();
  const h = page.locator('.obj.image .handle[data-h="se"]');
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + 6, hb.y + 6);
  await page.mouse.down();
  await page.mouse.move(hb.x + 66, hb.y + 10, { steps: 4 });
  await page.mouse.up();
  const s1 = (await state(page)).objects[0];
  expect(s1.w).toBeGreaterThan(s0.w);
  expect(s1.w / s1.h).toBeCloseTo(s0.w / s0.h, 4);
  expect([s1.x, s1.y]).toEqual([s0.x, s0.y]);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const s2 = (await state(page)).objects[0];
  expect(s2.x).toBeCloseTo(s1.x + 1, 6);
  expect(s2.y).toBeCloseTo(s1.y + 10, 6);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await state(page)).objects[0].x).toBeCloseTo(s1.x, 6);
  await page.keyboard.press('Control+y');
  expect((await state(page)).objects[0].x).toBeCloseTo(s2.x, 6);

  await page.click('#next');
  await page.waitForFunction(() => window.__pdfEditor.state.pageNum === 2);
  await expect(page.locator('.obj')).toHaveCount(0);
  await page.click('#prev');
  await page.waitForFunction(() => window.__pdfEditor.state.pageNum === 1);
  await expect(page.locator('.obj.image')).toHaveCount(1);
  expect((await state(page)).objects[0]).toEqual((await state(page)).objects[0]);
  expect((await state(page)).objects[0].x).toBeCloseTo(s2.x, 6);

  // Duplicate, copy to pages, delete.
  await page.locator('.obj.image').click();
  await page.click('#duplicate');
  expect((await state(page)).objects).toHaveLength(2);
  page.once('dialog', d => d.accept('2-3'));
  await page.click('#applyPages');
  await page.waitForFunction(() => window.__pdfEditor.state.objects.length === 4);
  await page.keyboard.press('Delete');
  expect((await state(page)).objects).toHaveLength(3);
});

test('saved PDF matches the editor: sizes, positions, transparency, no outlines', async ({ page }) => {
  await openPdf(page, 'multi.pdf');
  await setZoom(page, 1.5);
  // Text on page 1 at 12 pt.
  await page.click('[data-tool="text"]');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + 300, box.y + 260);
  await page.keyboard.type('Checked by test');
  await page.click('#sizePresets [data-size="12"]');
  await addSignature(page);
  // Page 3 is rotated 90°: place a signature there too.
  await page.fill('#pageInput', '3');
  await page.press('#pageInput', 'Enter');
  await page.waitForFunction(() => window.__pdfEditor.state.pageNum === 3 && !window.__pdfEditor.state.renderTask);
  await addSignature(page);
  const s = await state(page);

  await page.click('#save');
  for (const c of await page.locator('.pdfReview').all()) await c.check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#confirmPdfSave')]);
  expect(download.suggestedFilename()).toBe('multi_edited.pdf');
  const bytes = new Uint8Array(readFileSync(await download.path()));
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  expect(doc.numPages).toBe(4);

  const p1 = await doc.getPage(1), vp1 = p1.getViewport({ scale: 1 });
  const items = (await p1.getTextContent()).items.filter(i => i.str === 'Checked by test');
  expect(items).toHaveLength(1);
  const t = pdfjs.Util.transform(vp1.transform, items[0].transform);
  const textObj = s.objects.find(o => o.type === 'text');
  const lay = await page.evaluate(o => window.__pdfEditor.layoutText(o), textObj);
  expect(Math.hypot(t[2], t[3])).toBeCloseTo(12, 3);
  expect(t[4]).toBeCloseTo(textObj.x, 2);
  expect(t[5]).toBeCloseTo(textObj.y + lay.lines[0].baseline, 2);

  // The on-screen baseline (browser layout) matches the exported baseline within half a point.
  await page.fill('#pageInput', '1');
  await page.press('#pageInput', 'Enter');
  await page.waitForFunction(() => window.__pdfEditor.state.pageNum === 1 && !window.__pdfEditor.state.renderTask);
  const screenBaseline = await page.evaluate(() => {
    const ta = document.querySelector('.obj.text textarea');
    const span = document.createElement('span');
    span.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline';
    const probe = document.createElement('div');
    const cs = getComputedStyle(ta);
    probe.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;padding:0;margin:0';
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'transform']) probe.style[k] = cs[k];
    probe.append('Checked', span);
    ta.parentElement.appendChild(probe);
    // Where the glyph baseline is drawn, relative to the object's top edge (= o.y), in points.
    const y = (span.getBoundingClientRect().top - ta.parentElement.getBoundingClientRect().top) / window.__pdfEditor.state.scale;
    probe.remove();
    return y;
  });
  expect(Math.abs(screenBaseline - lay.lines[0].baseline)).toBeLessThan(0.25); // points

  // Images: one per page used, drawn as image XObjects; no outline strokes added.
  for (const n of [1, 3]) {
    const ops = await (await doc.getPage(n)).getOperatorList();
    expect(ops.fnArray.filter(f => f === pdfjs.OPS.paintImageXObject)).toHaveLength(1);
    expect(ops.fnArray.filter(f => f === pdfjs.OPS.stroke)).toHaveLength(0);
  }
});

test('invalid and damaged files fail gracefully', async ({ page }) => {
  await page.goto('/');
  await page.locator('.appTab[data-app-tab="pdf"]').click();
  await page.setInputFiles('#pdfInput', join(dir, 'not-a-pdf.pdf'));
  await expect(page.locator('#toast')).toContainText('could not be read as a PDF');
  await expect(page.locator('#empty')).toBeVisible();
  await page.setInputFiles('#pdfInput', join(dir, 'broken.pdf'));
  await expect(page.locator('#toast.error')).toBeVisible();
  await expect(page.locator('#pdfBusy')).toBeHidden();
  // A valid PDF still opens afterwards.
  await page.setInputFiles('#pdfInput', join(dir, 'single.pdf'));
  await expect(page.locator('#workspace')).toBeVisible();
});

test('replacing printed text masks the original in the editor', async ({ page }) => {
  await openPdf(page);
  await setZoom(page, 1.5);
  await page.locator('.textHit[title="Replace: Jane Example"]').click();
  await page.keyboard.type('Alex Sample');
  await page.keyboard.press('Escape');
  await expect(page.locator('.previewMask')).toHaveCount(1);
  const o = (await state(page)).objects[0];
  expect(o.type).toBe('replaceText');
  expect(o.fontSize).toBeCloseTo(10, 1); // the original line's size, not an inflated one
});
