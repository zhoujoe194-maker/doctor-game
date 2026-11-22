import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createSyntheticVideo } from '../helpers/synthetic-video.mjs';
import path from 'node:path';

test('import, clip seek, review without losing playback, timeline and saved history', async ({ page }) => {
  await page.goto('/');
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/synthetic-duels.webm'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 45000 });
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  const report = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith('sight-report-')))));
  expect(report.events.length).toBeGreaterThanOrEqual(2);
  await page.locator('[data-event="1"]').click();
  await expect.poll(() => page.locator('#replay').evaluate(video => video.currentTime)).toBeCloseTo(report.events[1].start, 1);
  await page.locator('#playback-rate').selectOption('0.5');
  await page.locator('#replay-seek').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#replay')).toHaveJSProperty('seeking', false);
  const position = await page.locator('#replay').evaluate(video => { window.testVideoIdentity = video; return video.currentTime; });
  await page.locator('#review-context').selectOption('duel');
  await page.getByRole('button', { name: '确认有效', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#confirm-event')).toBeFocused();
  expect(await page.evaluate(() => window.testVideoIdentity === document.querySelector('#replay'))).toBe(true);
  await expect(page.locator('#replay')).toHaveJSProperty('currentTime', position);
  await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.5);
  await expect(page.getByTestId('quantified-count')).toHaveText('1 / 20 起步样本');
  await page.getByRole('button', { name: '排除此片段' }).click();
  await expect(page.locator('#exclude-event')).toBeFocused();
  await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
  await page.getByRole('button', { name: '恢复此片段' }).click();
  await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
  await page.locator('#event-filter').focus();
  await page.locator('#event-filter').selectOption('pending');
  await expect(page.locator('#event-filter')).toBeFocused();
  await expect(page.locator('#replay')).toHaveJSProperty('currentTime', position);
  await page.locator('[data-clip="0"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#replay').evaluate(video => video.currentTime)).toBeCloseTo(report.events[0].start, 1);
  await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.5);
  await page.getByRole('button', { name: '回放前后过程' }).click();
  await expect.poll(() => page.locator('#replay').evaluate(video => video.currentTime)).toBeGreaterThan(0.1);
  await page.locator('#replay').evaluate(video => video.pause());
  await page.locator('#event-filter').selectOption('all');
  for (const [width, height] of [[1440, 900], [1280, 720], [760, 620]]) {
    await page.setViewportSize({ width, height });
    if (width === 760) await page.locator('#clips-panel > summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#confirm-event')).toBeVisible();
    await page.screenshot({ path: `artifacts/beta/report-${width}x${height}.png`, fullPage: true });
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '录制', exact: true }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole('button', { name: '继续复盘' })).toBeVisible();
  await expect(page.locator('#recent-preview')).toHaveJSProperty('videoWidth', 1280);
  await page.screenshot({ path: 'artifacts/beta/workspace-with-session.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: '继续复盘' }).click();
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  await expect(page.getByText('保持当前值 0.35', { exact: true })).toBeVisible();
});

test('keyboard reaches recording, modal cancellation returns focus, small windows fit', async ({ page }) => {
  await page.addInitScript(() => {
    window.doctorgame = { platform: 'test', list: async () => [], setBusy: async () => {}, onStop() {}, sources: async () => [] };
  });
  await page.goto('/');
  for (const [width, height] of [[1440, 900], [1280, 720], [760, 620]]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/beta/workspace-${width}x${height}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '录制', exact: true }).click();
  for (let i = 0; i < 15 && !await page.locator('#start-recording').evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
  await expect(page.locator('#start-recording')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#start-recording')).toBeFocused();
  await page.keyboard.press('Tab');
  const importButton = page.getByRole('button', { name: '导入录像', exact: true });
  await expect(importButton).toBeFocused();
  // Simulate the Windows CI race: the native close has already restored focus and
  // the player has moved to Import; a late close event must not steal it back.
  await page.evaluate(() => document.querySelector('#source-dialog').dispatchEvent(new Event('close')));
  await expect(importButton).toBeFocused();
});

test('source dialog returns focus to its actual launcher and ignores a late close', async ({ page }) => {
  await page.addInitScript(() => {
    window.doctorgame = { platform: 'test', list: async () => [], setBusy: async () => {}, onStop() {}, sources: async () => [] };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  const historyStart = page.locator('#start-recording');
  await historyStart.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('dialog') !== null)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(historyStart).toBeFocused();
  await page.keyboard.press('Tab');
  const importButton = page.getByRole('button', { name: '导入录像', exact: true });
  await expect(importButton).toBeFocused();
  await page.evaluate(() => document.querySelector('#source-dialog').dispatchEvent(new Event('close')));
  await expect(importButton).toBeFocused();
  await historyStart.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#close-source').click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(historyStart).toBeFocused();
});
