// Smoke tests for the workspace modules carried over from earlier versions.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
});

test('tasks, queue follow-up, handover, links, notes, search and backup', async ({ page }) => {
  await page.locator('.appTab[data-app-tab="tasks"]').click();
  await page.click('#addTask');
  await page.fill('#taskTitle', 'Check outstanding referrals');
  await page.click('#saveTask');
  await page.locator('[data-task-done]').click();
  await expect(page.locator('#taskProgress')).toContainText('1 / 1 completed today');

  await page.locator('.appTab[data-app-tab="queue"]').click();
  await page.click('#addCase');
  await page.fill('#caseTitle', 'REF-TEST-01 CT booking');
  await page.selectOption('#casePriority', 'Urgent');
  await page.click('#saveCase');
  await page.locator('[data-case-follow]').click();
  await page.fill('#followInput', '2020-01-01T09:00');
  await page.click('#followSave');
  await expect(page.locator('#queueStats')).toContainText('1 open • 1 due/overdue • 1 urgent');

  await page.locator('.appTab[data-app-tab="handover"]').click();
  await expect(page.locator('#handoverText')).toHaveValue(/REF-TEST-01 CT booking/);

  await page.locator('.appTab[data-app-tab="links"]').click();
  await page.click('#addLink');
  await page.fill('#linkName', 'Intranet');
  await page.fill('#linkUrl', 'javascript:alert(1)');
  await page.click('#saveLink');
  await expect(page.locator('#toast')).toContainText('valid http/https');
  await page.fill('#linkUrl', 'https://example.org/');
  await page.click('#saveLink');
  await expect(page.locator('.linkCard a')).toHaveAttribute('href', 'https://example.org/');

  await page.locator('.appTab[data-app-tab="notes"]').click();
  await page.fill('#quickNotes', 'Shift note (non-patient)');
  await expect(page.locator('#notesStatus')).toHaveText('Saved locally');

  // Escape closes modals.
  await page.locator('.appTab[data-app-tab="tasks"]').click();
  await page.click('#addTask');
  await page.keyboard.press('Escape');
  await expect(page.locator('#taskModal')).toBeHidden();

  await page.fill('#globalSearch', 'queen square');
  await page.locator('[data-search-go="templates"]').first().click();
  await expect(page.locator('#replyDetail h2')).toHaveText('Queen Square Escalation');

  await page.locator('.appTab[data-app-tab="home"]').click();
  page.once('dialog', d => d.dismiss()); // export without signatures
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportBackup')]);
  const data = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(Object.keys(data.storage)).toEqual(expect.arrayContaining(['osama-automation-tasks-v1', 'osama-automation-queue-v1', 'osama-automation-links-v1', 'osama-automation-notes-v1']));
  expect(data.signatures).toBeUndefined();
});

test('PDF keyboard shortcuts do not leak into other tabs', async ({ page }) => {
  await page.locator('.appTab[data-app-tab="notes"]').click();
  await page.fill('#quickNotes', 'abc');
  await page.keyboard.press('Control+z'); // native undo inside the textarea must still work
  await expect(page.locator('#quickNotes')).not.toHaveValue('abc');
});
