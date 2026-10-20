import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { historyFingerprint } from '../src/history.js';
const headers = ['Timestamp', 'What is your full name?', 'Have you attended a Book Buzz meeting or event this semester?', 'Rank [Book A]', 'Rank [Book B]', 'Rank [Book C]'];
const csv = rows => Papa.unparse([headers, ...rows.map(row => ['2026/09/19 11:14:44 AM AST', ...row])]);
async function upload(page, kind, text, extra = false) {
  const zip = new JSZip().file('responses.csv', text);
  if (extra) zip.file('another.csv', text);
  await page.locator(`#${kind}-file`).setInputFiles({ name: 'votes.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
}
const current = csv([['Alice', 'Yes :)', '1', '2', '3'], ['Bob', 'No :(', '1', '', '3'], ['Carol', "I'm a brand new member!!", '2', '1', '3']]);
const testHistory = { semester: 'Fall 2026', months: [
  { id: '2026-09', label: 'September 2026', voters: [await historyFingerprint('Alice', '2026-09')] },
  { id: '2026-10', label: 'October 2026', voters: [await historyFingerprint('Bob', '2026-10')] },
] };
test.beforeEach(async ({ page }) => {
  await page.route('**/semester-history.js*', route => route.fulfill({ contentType: 'text/javascript', body: `export default ${JSON.stringify(testHistory)};` }));
});
test('automatic semester history, new-member validation, filters, and overrides', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/book-club-vote-analyzer/');
  await expect(page.locator('#past-file')).toHaveCount(0);
  await expect(page.locator('#history-status')).toContainText('September 2026 + October 2026');
  await upload(page, 'current', csv([['Alice', "I'm a brand new member!!", '1', '2', '3'], ['Bob', 'No', '1', '2', '3'], ['Carol', "I'm a brand new member!!", '2', '1', '3']]));
  await expect(page.locator('#ballots tbody tr')).toHaveCount(3);
  const alice = page.locator('#ballots tbody tr').filter({ hasText: 'Alice' });
  await expect(alice).toContainText('Returning member — attendance unconfirmed');
  await expect(alice).toContainText('Claims new member');
  await alice.getByText('View choices', { exact: true }).click();
  await expect(alice).toContainText('Previously voted: September 2026');
  await page.getByRole('checkbox', { name: 'Have not attended + Previously voted this semester', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Count ballot: Bob (row 3)', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Count ballot: Carol (row 4)', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Returning member — attendance unconfirmed', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Count ballot: Alice (row 2)', exact: true })).not.toBeChecked();
  await expect(page.locator('.metric-strip')).toContainText('1ballots counted');
  await alice.getByText('View choices', { exact: true }).click();
  await page.getByLabel('History match: row 2', { exact: true }).selectOption('noMatch');
  await expect(alice).not.toContainText('Claims new member');
  await expect(page.getByRole('checkbox', { name: 'Count ballot: Alice (row 2)', exact: true })).toBeChecked();
  expect(errors).toEqual([]);
});
test('all stored history is automatic and current import resets ballot visibility', async ({ page }) => {
  await page.goto('/book-club-vote-analyzer/');
  await upload(page, 'current', current);
  await page.locator('#issues-only').check();
  await expect(page.locator('#ballots tbody tr')).toHaveCount(1);
  await upload(page, 'current', 'Name,Rank [Old A],Rank [Old B]\nAlice,1,2\nBob,2,1');
  await expect(page.locator('#current-status')).toContainText('2 responses');
  await expect(page.locator('#issues-only')).not.toBeChecked();
  await expect(page.locator('#ballots tbody tr')).toHaveCount(2);
  await expect(page.locator('#election-month')).toHaveCount(0);
  await expect(page.locator('#history-status')).toContainText('September 2026 + October 2026');
  await expect(page.locator('#ballots tbody tr').filter({ hasText: 'Bob' })).toContainText('Previously voted: October 2026');
});

test('ZIP to results, override, filtering, correction, comparison and reset', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/book-club-vote-analyzer/');
  await upload(page, 'current', current);
  await expect(page.locator('#current-status')).toContainText('3 responses');
  await expect(page.locator('.metric-strip')).toContainText('2ballots counted');
  await expect(page.locator('#results')).toContainText('Provisional');
  await page.getByRole('button', { name: 'Include as entered' }).click();
  await expect(page.locator('.metric-strip')).toContainText('3ballots counted');
  await expect(page.locator('#results')).not.toContainText('Provisional');
  await page.getByRole('button', { name: 'Follow filters — clear manual selections' }).click();
  await page.getByRole('checkbox', { name: 'Have not attended', exact: true }).uncheck();
  await expect(page.locator('.metric-strip')).toContainText('2ballots counted');
  await page.getByRole('checkbox', { name: 'Have not attended', exact: true }).check();
  await page.locator('#ballots tr').filter({ hasText: 'Bob' }).getByRole('button', { name: 'Correct', exact: true }).click();
  await page.locator('#rank-2').fill('2');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.locator('#ballots')).toContainText('Corrected in this session');
  await page.locator('#returning-only').check();
  await expect(page.locator('.metric-strip')).toContainText('2ballots counted');
  await page.getByText('How was this result calculated?').click();
  await expect(page.locator('#method')).toContainText('Head-to-head preferences');
  await page.getByRole('button', { name: 'Start a new month' }).click();
  await page.getByRole('button', { name: 'Reset everything' }).click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#ballots')).toHaveText('');
  await expect(page.locator('#edit-name')).toHaveValue('');
  expect(errors).toEqual([]);
});
test('multi-CSV picker, malformed archive, missing headers and injection safety', async ({ page }) => {
  await page.goto('/book-club-vote-analyzer/');
  await upload(page, 'current', current, true);
  await expect(page.locator('#current-status')).toContainText('2 CSVs');
  await page.getByRole('button', { name: 'Use this CSV' }).click();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('#current-file').setInputFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await expect(page.locator('#current-status')).toHaveClass(/error-text/);
  await expect(page.locator('#workspace')).toBeHidden();
  await upload(page, 'current', 'Name,Other\nAlice,1');
  await expect(page.locator('#current-status')).toContainText('book columns');
  await upload(page, 'current', csv([['<img src=x onerror=alert(1)>', 'Yes', '1', '3', '']]));
  await expect(page.locator('#ballots')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#ballots img')).toHaveCount(0);
});
test('duplicates and responsive layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/book-club-vote-analyzer/');
  await upload(page, 'current', csv([['Alice', 'Yes', '1', '2', '3'], [' ALICE ', 'No', '3', '2', '1']]));
  await expect(page.locator('#results')).toContainText('No eligible ballots');
  await page.getByLabel('current duplicate: Alice').selectOption('2');
  await expect(page.locator('.metric-strip')).toContainText('1ballots counted');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('empty desktop screenshot and local-only networking', async ({ page }) => {
  const outgoing = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173')) outgoing.push(request.url()); });
  await page.goto('/book-club-vote-analyzer/');
  await page.screenshot({ path: 'test-results/desktop-empty.png', fullPage: true });
  await upload(page, 'current', current);
  await expect(page.locator('#results')).toContainText('Provisional');
  await page.screenshot({ path: 'test-results/desktop-results.png', fullPage: true });
  expect(outgoing).toEqual([]);
});
