// Production build smoke test, served with the same security headers as Vercel (vercel.json).
// Fails if the Content-Security-Policy blocks anything the app needs (pdf.js worker, fonts,
// MuPDF WebAssembly, images, downloads).
import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { makeFixtures } from '../fixtures/make-fixtures.js';

test('production build works under the security headers', async ({ page }) => {
  const dir = await makeFixtures();
  const violations = [];
  page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => console.error(`Refused to load: CSP ${e.violatedDirective} ${e.blockedURI}`)); });
  page.on('dialog', d => d.accept());

  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toContain("connect-src 'self'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
  await page.locator('.appTab[data-app-tab="pdf"]').click();
  await page.setInputFiles('#pdfInput', join(dir, 'single.pdf'));
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('.textHit').first()).toBeAttached();
  // Replace printed text (forces MuPDF WASM to load on save) and add a signature.
  await page.locator('.textHit[title="Replace: Jane Example"]').click();
  await page.keyboard.type('Alex Sample');
  await page.keyboard.press('Escape');
  await page.setInputFiles('#imageInput', join(dir, 'signature.png'));
  await expect(page.locator('.obj.image')).toHaveCount(1);
  await page.click('#save');
  await page.check('#pdfReviewed');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('#confirmPdfSave')]);
  expect(download.suggestedFilename()).toBe('single_edited.pdf');
  // Email tools.
  await page.locator('.appTab[data-app-tab="templates"]').click();
  await expect(page.locator('.replyItem').first()).toBeVisible();
  expect(violations).toEqual([]);
});
