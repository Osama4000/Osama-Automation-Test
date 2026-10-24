// Regression tests for the issues found in the post-development review (fictional data only).
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { makeFixtures } from '../fixtures/make-fixtures.js';

let dir;
test.beforeAll(async () => { dir = await makeFixtures(); });
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
const clipboard = async page => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
const S = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__pdfEditor.state.objects)));

async function fresh(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
}
async function openPdf(page, file) {
  await page.locator('.appTab[data-app-tab="pdf"]').click();
  await page.setInputFiles('#pdfInput', file);
  await page.waitForFunction(() => window.__pdfEditor.state.pdf && !document.querySelector('#workspace').hidden && !window.__pdfEditor.state.renderTask);
  await page.waitForTimeout(150);
}
async function saveAndDownload(page) {
  const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.click('#save');
    if (await page.locator('#pdfCheckModal').isVisible()) { await page.check('#pdfReviewed'); await page.click('#confirmPdfSave'); }
  })()]);
  return download;
}

test.describe('PDF editor', () => {
  test.beforeEach(async ({ page }) => fresh(page));

  test('IMP-04: a pre-filled form field is drawn once, not twice', async ({ page }) => {
    await openPdf(page, join(dir, 'single.pdf'));
    // Dark pixels on the canvas inside the field box (field at x 50, y 540-560 in PDF space).
    const darkInField = () => page.evaluate(() => {
      const c = document.querySelector('#pdfCanvas'), info = window.__pdfEditor.state.pages.get(1), k = c.width / info.width;
      const d = c.getContext('2d').getImageData(55 * k, (info.height - 557) * k, 190 * k, 14 * k).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n++; return n;
    });
    await expect(page.locator('.nativeField')).toHaveValue('PREFILLED-001');
    expect(await darkInField()).toBe(0); // only our editable input shows the value
    await page.uncheck('#nativeFields');
    await page.waitForFunction(() => !window.__pdfEditor.state.renderTask);
    await page.waitForTimeout(200);
    expect(await darkInField()).toBeGreaterThan(50); // PDF's own appearance when the overlay is off
  });

  test('IMP-06: resizing the window while typing keeps focus and text', async ({ page }) => {
    await openPdf(page, join(dir, 'single.pdf'));
    await page.click('[data-tool="text"]');
    const b = await page.locator('#stage').boundingBox();
    await page.mouse.click(b.x + 400, b.y + 300);
    await page.keyboard.type('Hello');
    await page.setViewportSize({ width: 1150, height: 860 });
    await page.waitForFunction(() => !window.__pdfEditor.state.renderTask);
    await page.waitForTimeout(300);
    await page.keyboard.type(' world');
    expect((await S(page))[0].text).toBe('Hello world');
    await expect(page.locator('.obj.text textarea')).toBeFocused();
  });

  test('IMP-07: large photos are scaled down on insert', async ({ page }) => {
    await openPdf(page, join(dir, 'single.pdf'));
    const jpg = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; c.getContext('2d').fillRect(100, 100, 3800, 50); return c.toDataURL('image/jpeg', 0.9); });
    mkdirSync(join(dir, 'tmp'), { recursive: true });
    const file = join(dir, 'tmp', 'photo.jpg');
    (await import('node:fs')).writeFileSync(file, Buffer.from(jpg.split(',')[1], 'base64'));
    await page.setInputFiles('#imageInput', file);
    await expect(page.locator('.obj.image')).toHaveCount(1);
    const img = await page.evaluate(() => { const v = [...window.__pdfEditor.state.images.values()][0]; return [v.width, v.height]; });
    expect(img).toEqual([1600, 1200]);
  });

  test('IMP-11: replacing bold printed text keeps it bold', async ({ page }) => {
    await openPdf(page, join(dir, 'single.pdf'));
    await page.locator('.textHit[title="Replace: Bold label"]').click();
    const o = (await S(page))[0];
    expect(o.bold).toBe(true);
    await expect(page.locator('#boldBtn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('IMP-03 + IMP-10: a "restrict editing" PDF saves; one-tick review; review can be switched off', async ({ page }) => {
    await openPdf(page, join(dir, 'restricted.pdf'));
    await page.click('[data-tool="text"]');
    const b = await page.locator('#stage').boundingBox();
    await page.mouse.click(b.x + 400, b.y + 300);
    await page.keyboard.type('Saved from restricted');
    await page.keyboard.press('Escape');
    let note = '';
    page.once('dialog', d => { note = d.message(); d.accept(); });
    await page.click('#save');
    await expect(page.locator('.pdfReview')).toHaveCount(1);
    await page.click('#confirmPdfSave'); // not ticked yet
    await expect(page.locator('#toast')).toContainText('Tick the review box');
    await page.check('#pdfReviewed');
    await page.check('#skipReview');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#confirmPdfSave')]);
    await expect.poll(() => note).toContain('restrict editing');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(await download.path())), isEvalSupported: false }).promise;
    const strs = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str);
    expect(strs).toContain('Saved from restricted');
    // Review switched off: the next save goes straight to download.
    await expect(page.locator('#askReview')).not.toBeChecked();
    const [again] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
    expect(again.suggestedFilename()).toBe('restricted_edited.pdf');
  });

  test('IMP-17: empty text box removed on page switch; thumbnail marker; no "_edited_edited"', async ({ page }) => {
    mkdirSync(join(dir, 'tmp'), { recursive: true });
    const renamed = join(dir, 'tmp', 'multi_edited.pdf');
    copyFileSync(join(dir, 'multi.pdf'), renamed);
    await openPdf(page, renamed);
    await page.click('[data-tool="text"]');
    const b = await page.locator('#stage').boundingBox();
    await page.mouse.click(b.x + 300, b.y + 300);
    await page.click('#next');
    await page.waitForFunction(() => window.__pdfEditor.state.pageNum === 2);
    expect(await S(page)).toEqual([]);
    await page.setInputFiles('#imageInput', join(dir, 'signature.png'));
    await expect(page.locator('.thumb[data-page="2"] span')).toHaveText('2 •');
    await page.keyboard.press('Control+z');
    await expect(page.locator('.thumb[data-page="2"] span')).toHaveText('2');
    await page.keyboard.press('Control+y');
    const download = await saveAndDownload(page);
    expect(download.suggestedFilename()).toBe('multi_edited.pdf');
  });

  test('IMP-05: a crafted signature-library entry cannot run script', async ({ page }) => {
    await page.evaluate(() => new Promise(res => {
      const r = indexedDB.open('pdf-editor-signatures-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('signatures', { keyPath: 'id' });
      r.onsuccess = () => { const tx = r.result.transaction('signatures', 'readwrite'); tx.objectStore('signatures').put({ id: 'x', name: 'evil', src: 'data:image/png;base64,AA" onerror="window.__xss=1', createdAt: 1 }); tx.oncomplete = res; };
    }));
    await page.reload();
    await page.locator('.appTab[data-app-tab="pdf"]').click();
    await page.locator('#savedSigsBox summary').click();
    await expect(page.locator('#presets .sigPick')).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('Email tools', () => {
  test.beforeEach(async ({ page }) => { await fresh(page); await page.locator('.appTab[data-app-tab="templates"]').click(); });

  test('IMP-02: details typed for one reply are flagged, not silently copied, in another', async ({ page }) => {
    await page.fill('#templateSearch', 'Appointment Confirmation');
    await page.locator('.replyItem').first().click();
    await page.locator('#replyDetail [data-var="patient_name"]').fill('John Smith');
    await expect(page.locator('#templatesPanel .patientBar')).toContainText('John Smith');

    await page.fill('#templateSearch', 'Referral Follow-up');
    // One-click copy refuses to reuse another message's patient details.
    await page.evaluate(() => navigator.clipboard.writeText('unchanged'));
    await page.locator('.replyItem [data-copy-template]').first().click();
    expect(await clipboard(page)).toBe('unchanged');
    await expect(page.locator('#replyDetail .carryNote')).toBeVisible();
    // Confirming it's the same patient removes the warning and allows copying.
    await page.click('[data-same-patient]');
    await expect(page.locator('#replyDetail .carryNote')).toHaveCount(0);
    await page.keyboard.press('Control+Enter');
    expect(await clipboard(page)).toBe('Could you please provide an update regarding the referral for John Smith?\n\nMany thanks.');

    // Clear after copying.
    await page.locator('#templatesPanel .clearAfterCopy').check();
    await page.click('#detailCopyBody');
    await expect(page.locator('#templatesPanel .patientBar')).toBeHidden();
    await expect(page.locator('#replyDetail [data-var="patient_name"]')).toHaveValue('');
  });

  test('B6: the clinic list assistant no longer changes the patient date', async ({ page }) => {
    await page.fill('#templateSearch', 'Appointment Confirmation');
    await page.locator('.replyItem').first().click();
    await page.locator('#replyDetail [data-var="date"]').fill('2026-10-28');
    await page.locator('.appTab[data-app-tab="composer"]').click();
    page.on('dialog', d => d.accept());
    await page.fill('#clinicDate', '2026-12-01');
    await page.click('#clinicGenerate');
    await expect(page.locator('#composerSubject')).toHaveValue('Clinic list - 01/12/2026');
    await page.locator('.appTab[data-app-tab="templates"]').click();
    await expect(page.locator('#replyDetail [data-var="date"]')).toHaveValue('2026-10-28');
  });

  test('IMP-08: an accidental backdrop click or Escape does not discard a draft', async ({ page }) => {
    await page.click('#addTemplate');
    await page.fill('#tplName', 'Draft reply');
    page.once('dialog', d => d.dismiss());
    await page.mouse.click(10, 880);
    await expect(page.locator('#templateModal')).toBeVisible();
    page.once('dialog', d => d.dismiss());
    await page.keyboard.press('Escape');
    await expect(page.locator('#templateModal')).toBeVisible();
    await expect(page.locator('#tplName')).toHaveValue('Draft reply');
    page.once('dialog', d => d.accept());
    await page.keyboard.press('Escape');
    await expect(page.locator('#templateModal')).toBeHidden();
    // An untouched dialog closes without asking.
    await page.click('#addTemplate');
    await page.keyboard.press('Escape');
    await expect(page.locator('#templateModal')).toBeHidden();
  });

  test('IMP-12: keyboard flow and Ctrl+K quick find', async ({ page }) => {
    await page.fill('#templateSearch', 'queen square');
    await page.keyboard.press('Enter');
    await expect(page.locator('#detailCopyBody')).toBeFocused(); // no fields -> straight to Copy
    await page.keyboard.press('Control+Enter');
    expect(await clipboard(page)).toBe('It has been raised to Queen Square and they will contact the patient as soon as possible.');

    // Enter on a reply with fields focuses the first empty field; Enter moves on.
    await page.fill('#templateSearch', 'Appointment Confirmation');
    await page.keyboard.press('Enter');
    await expect(page.locator('#replyDetail [data-var="patient_name"]')).toBeFocused();
    await page.keyboard.type('Jane Example');
    await page.keyboard.press('Enter');
    await expect(page.locator('#replyDetail [data-var="date"]')).toBeFocused();

    // Ctrl+K from another tab copies a field-free reply directly.
    await page.locator('.appTab[data-app-tab="tasks"]').click();
    await page.keyboard.press('Control+k');
    await page.keyboard.type('fortius');
    await page.keyboard.press('Enter');
    await expect(page.locator('#paletteModal')).toBeHidden();
    expect(await clipboard(page)).toBe('It has been raised to Fortius and they will contact the patient as soon as possible.');
    // …and opens a reply that needs fields instead of copying it.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('report follow');
    await page.keyboard.press('Enter');
    await expect(page.locator('#templatesPanel')).toBeVisible();
    await expect(page.locator('#replyDetail h2')).toHaveText('Report Follow-up');
    await expect(page.locator('#replyDetail [data-var="scan_type"]')).toBeFocused();
  });

  test('IMP-17: the "action" reminder can be hidden', async ({ page }) => {
    await page.fill('#templateSearch', 'Fortius');
    await page.locator('.replyItem').first().click();
    await page.click('[data-hide-action-notice]');
    await expect(page.locator('[data-hide-action-notice]')).toHaveCount(0);
    await page.reload();
    await page.locator('.appTab[data-app-tab="templates"]').click();
    await page.fill('#templateSearch', 'Fortius');
    await page.locator('.replyItem').first().click();
    await expect(page.locator('#replyDetail .infoNote')).toHaveCount(0);
  });
});
