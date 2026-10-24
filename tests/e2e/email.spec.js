// Quick Replies & Email Composer regression tests (fictional values only).
import { test, expect } from '@playwright/test';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
// The OS clipboard may normalise line endings (CRLF on Windows).
const clipboard = async page => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.locator('.appTab[data-app-tab="templates"]').click();
});

test('required replies exist and copy in one click', async ({ page }) => {
  await page.fill('#templateSearch', 'fortius');
  await expect(page.locator('.replyItem')).toHaveCount(1);
  await page.locator('.replyItem [data-copy-template]').click();
  expect(await clipboard(page)).toBe('It has been raised to Fortius and they will contact the patient as soon as possible.');
  await expect(page.locator('#toast')).toContainText('Copied');
  for (const name of ['Queen Square Escalation', 'Patient Contact and Booking', 'Clinic List Request']) {
    await page.fill('#templateSearch', name);
    await expect(page.locator('.replyItem b', { hasText: name }).first()).toBeVisible();
  }
  // Recently used is tracked.
  await page.fill('#templateSearch', '');
  await expect(page.locator('#recentReplies [data-recent]')).toContainText(['Fortius Escalation']);
});

test('fills {patient_name}, {date}, {time}, {scan_type} with live preview and copies the result', async ({ page }) => {
  await page.fill('#templateSearch', 'Appointment Confirmation');
  await page.locator('.replyItem').first().click();
  const detail = page.locator('#replyDetail');
  await expect(detail.locator('.warnNote')).toContainText('Still to fill in');
  await detail.locator('[data-var="patient_name"]').fill('John Smith');
  await detail.locator('[data-var="date"]').fill('2026-10-28');
  await detail.locator('[data-var="time"]').fill('10:30');
  await detail.locator('[data-scan="MRI"]').click();
  await expect(detail.locator('.previewBody')).toHaveText('Dear John Smith,\n\nYour MRI appointment has been confirmed for 28/10/2026 at 10:30.\n\nKind regards,\nRadiology Administration');
  await expect(detail.locator('.previewSubject')).toHaveText('MRI appointment confirmation - 28/10/2026');
  await expect(detail.locator('.warnNote')).toHaveCount(0);
  await detail.locator('#detailCopyAll').click();
  expect(await clipboard(page)).toBe('Subject: MRI appointment confirmation - 28/10/2026\n\nDear John Smith,\n\nYour MRI appointment has been confirmed for 28/10/2026 at 10:30.\n\nKind regards,\nRadiology Administration');
  // {Date} alias on the required Clinic List Request reply, with values shared across replies.
  await page.fill('#templateSearch', 'Clinic List Request');
  await page.locator('.replyItem').first().click();
  await expect(page.locator('#replyDetail .previewBody')).toHaveText('Find the clinic list for 28/10/2026');
  // Values are never written to storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain('John Smith');
});

test('missing values are flagged and need confirmation before copying', async ({ page }) => {
  await page.fill('#templateSearch', 'Referral Follow-up');
  await page.locator('.replyItem [data-copy-template]').first().click();
  await expect(page.locator('#toast')).toContainText('Fill in Patient name');
  await expect(page.locator('#replyDetail [data-var="patient_name"]')).toBeFocused();
  page.once('dialog', d => d.dismiss());
  await page.locator('#detailCopyBody').click();
  await expect(page.locator('#replyDetail mark.missing')).toHaveCount(2);
});

test('create, edit, search, copy, duplicate and delete a custom reply; reset built-ins', async ({ page }) => {
  await page.click('#addTemplate');
  await page.fill('#tplName', 'Prep reminder');
  await page.fill('#tplCategory', 'Appointments');
  await page.fill('#tplBody', 'Please arrive 15 minutes before your {scan_type} scan on {Date}. {unknown_thing}');
  await expect(page.locator('#tplVarReport')).toContainText('Unknown');
  await page.click('#saveTemplate');
  await expect(page.locator('#replyDetail h2')).toHaveText('Prep reminder');

  await page.click('#detailEdit');
  await page.fill('#tplBody', 'Please arrive 20 minutes before your {scan_type} scan.');
  await page.click('#saveTemplate');
  await page.fill('#templateSearch', 'arrive 20');
  await expect(page.locator('.replyItem')).toHaveCount(1);
  await page.locator('#replyDetail [data-var="scan_type"]').fill('CT');
  await page.click('#detailCopyBody');
  expect(await clipboard(page)).toBe('Please arrive 20 minutes before your CT scan.');

  await page.click('#detailDup');
  await page.fill('#templateSearch', 'Prep reminder');
  await expect(page.locator('.replyItem')).toHaveCount(2);
  page.once('dialog', d => d.accept());
  await page.click('#detailDelete');
  await expect(page.locator('.replyItem')).toHaveCount(1);

  // Edit a built-in, then restore it.
  await page.fill('#templateSearch', 'Report Available');
  await page.locator('.replyItem', { has: page.locator('b', { hasText: /^Report Available$/ }) }).click();
  await page.click('#detailEdit');
  await page.fill('#tplBody', 'Changed wording');
  await page.click('#saveTemplate');
  await expect(page.locator('#replyDetail .previewBody')).toHaveText('Changed wording');
  page.once('dialog', d => d.accept());
  await page.click('#resetBuiltins');
  await expect(page.locator('#replyDetail .previewBody')).toHaveText('The report is now available. Please refer to the appropriate reporting system for further details.');
  // Custom reply survives the reset; favourites work.
  await page.fill('#templateSearch', 'Prep reminder');
  await expect(page.locator('.replyItem')).toHaveCount(1);
  await page.locator('.replyItem [data-fav-template]').click();
  await page.fill('#templateSearch', '');
  await page.check('#favoritesOnly');
  await expect(page.locator('.replyItem')).toHaveCount(1);
});

test('composer: template, variables, utilities, clinic list assistant', async ({ page }) => {
  await page.locator('.appTab[data-app-tab="composer"]').click();
  await page.selectOption('#composerTemplate', 'builtin:appointment-rescheduling');
  await page.locator('#composerFields [data-var="patient_name"]').fill('Jane Example');
  await page.locator('#composerFields [data-var="scan_type"]').fill('Ultrasound');
  await expect(page.locator('#composerPreview .previewBody')).toContainText('Dear Jane Example,');
  await expect(page.locator('#composerPreview .previewBody')).toContainText('rearrange your Ultrasound appointment');
  await page.click('#copySubject');
  expect(await clipboard(page)).toBe('Your Ultrasound appointment');

  // Text utilities.
  await page.fill('#composerBody', '  Hello   there  \n\n\n\nSeen on 2026-10-28  ');
  await page.click('[data-util="trim"]');
  await expect(page.locator('#composerBody')).toHaveValue('Hello there\n\nSeen on 2026-10-28');
  await page.click('[data-util="dates"]');
  await expect(page.locator('#composerBody')).toHaveValue('Hello there\n\nSeen on 28/10/2026');

  // Clinic list assistant: attachment wording only when ticked.
  page.on('dialog', d => d.accept());
  await page.fill('#clinicDate', '2026-11-02');
  await page.fill('#clinicName', 'Example Clinic');
  await page.click('#clinicGenerate');
  await expect(page.locator('#composerPreview .previewBody')).toContainText('Please see the clinic list for 02/11/2026 (Example Clinic) below.');
  await page.check('#clinicAttach');
  await page.click('#clinicGenerate');
  await expect(page.locator('#composerPreview .previewBody')).toContainText('Please find attached the clinic list for 02/11/2026 (Example Clinic).');
  await expect(page.locator('#composerWarnings')).toContainText('remember to attach');
  await page.click('#copyBody');
  expect(await clipboard(page)).toContain('Please find attached the clinic list for 02/11/2026 (Example Clinic).');
  // The clinic email uses the chosen date format at the time it is generated.
  await expect(page.locator('#composerPreview .previewSubject')).toHaveText('Clinic list - Example Clinic - 02/11/2026');
  await page.locator('details', { hasText: 'Date & time format' }).locator('summary').click();
  await page.selectOption('#dateFormat', 'd mmmm yyyy');
  await page.click('#clinicGenerate');
  await expect(page.locator('#composerPreview .previewSubject')).toHaveText('Clinic list - Example Clinic - 2 November 2026');
});

test('preview never interprets template text as HTML', async ({ page }) => {
  await page.click('#addTemplate');
  await page.fill('#tplName', 'XSS check');
  await page.fill('#tplBody', '<img src=x onerror="window.__xss=1"> {patient_name}');
  await page.click('#saveTemplate');
  await page.locator('#replyDetail [data-var="patient_name"]').fill('<b>bold</b>');
  await expect(page.locator('#replyDetail .previewBody')).toHaveText('<img src=x onerror="window.__xss=1"> <b>bold</b>');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#replyDetail .previewBody img')).toHaveCount(0);
});
