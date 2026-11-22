import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createSyntheticVideo } from '../helpers/synthetic-video.mjs';
import { createHudVideo } from '../helpers/hud-video.mjs';
import path from 'node:path';

async function importFile(page, file, { playerName = '' } = {}) {
  await page.locator('#player-name').fill(playerName);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 120000 });
}

async function report(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(item => item.startsWith('sight-report-'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
}

test('full video import produces real local HUD kill/death candidates with review and persistence', async ({ page }) => {
  test.setTimeout(180000);
  const errors = []; const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  const file = await createHudVideo(page, path.resolve('artifacts/fixtures/hud-events-ocr.webm'), { duration: 8 });
  await importFile(page, file, { playerName: 'PlayerOne' });
  await expect(page.locator('.event-row').filter({ hasText: 'HUD 自动识别' }).first()).toBeVisible({ timeout: 150000 });
  const first = await report(page);
  expect(first.hud.status).toBe('complete');
  expect(first.hud.ocrRuns).toBeGreaterThan(0);
  expect(first.hud.scans).toBeGreaterThan(0);
  expect(first.hud.ocrRuns).toBeLessThan(first.processed);
  expect(first.hud.elapsedMs).toBeGreaterThan(0);
  const hudEvents = first.events.filter(event => event.source === 'hud-ocr');
  expect(hudEvents.length).toBeGreaterThanOrEqual(2);
  expect(hudEvents.some(event => event.context === 'kill')).toBe(true);
  expect(hudEvents.some(event => event.context === 'death')).toBe(true);
  expect(hudEvents.every(event => event.kind === 'observation' && event.reviewed === false && event.source === 'hud-ocr')).toBe(true);
  expect(first.hud.identity.name).toBe('PlayerOne');
  const recordingSnapshot = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    const item = (await storage.list()).find(entry => entry.id === id);
    return item ? { playerName: item.playerName, profile: item.profile } : null;
  }, first.id);
  expect(recordingSnapshot.playerName).toBe('PlayerOne');
  expect(recordingSnapshot.profile.dpi).toBe(800);
  expect(requests.some(url => url.includes('/assets/ocr/worker.min.js'))).toBe(true);
  expect(requests.some(url => /cdn\.jsdelivr|tessdata\.projectnaptha|unpkg\.com/i.test(url))).toBe(false);
  expect(requests.every(url => url.startsWith('http://127.0.0.1:4173/') || url.startsWith('blob:') || url.startsWith('data:'))).toBe(true);

  await page.locator('.event-row').filter({ hasText: 'HUD 自动识别' }).first().click();
  await expect(page.locator('.hud-evidence')).toContainText('HUD 识别依据');
  await expect(page.locator('.hud-evidence')).toContainText('PlayerOne');
  await expect(page.locator('#playback-rate')).toHaveValue('0.5');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/full-ui/dsh/16-hud-report-1440x900.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const selector of ['#replay', '#playback-rate', '#replay-seek', '#confirm-event', '#exclude-event']) {
    await expect(page.locator(selector)).toBeVisible();
    const box = await page.locator(selector).boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(720);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '确认 HUD 候选', exact: true }).click();
  await expect(page.getByTestId('quantified-count')).toContainText('0 / 20');
  await expect(page.getByRole('button', { name: '已确认 · 更新', exact: true })).toBeVisible();
  await page.locator('#exclude-event').click();
  await expect(page.locator('#exclude-event')).toHaveText('恢复此片段');

  await page.reload();
  await expect(page.getByRole('heading', { name: '继续上一局', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续复盘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
  // A current-name change is for new recordings only; it must not rewrite the old report.
  await page.getByRole('button', { name: '录制', exact: true }).click();
  await page.locator('#player-name').fill('ChangedCurrentName');
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await page.locator('.library-card').click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
  const persisted = await report(page);
  expect(persisted.hud.identity.name).toBe('PlayerOne');
  expect(persisted.profile.dpi).toBe(800);
  expect(persisted.events.some(event => event.source === 'hud-ocr')).toBe(true);
  expect(errors).toEqual([]);
});

test('HUD model failure keeps the recording and report usable', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/assets/ocr/worker.min.js', route => route.abort());
  await page.goto('/');
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/hud-model-failure.webm'));
  await importFile(page, file, { playerName: 'PlayerOne' });
  const saved = await report(page);
  expect(saved.hud.status).toBe('error');
  expect(await page.locator('.hud-setup')).toContainText('识别失败 · 可重试');
  await expect(page.locator('.hud-message')).toContainText('HUD 自动识别未完成');
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
});

test('HUD with no matching rows is a recoverable zero-candidate result', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/hud-zero.webm'));
  await importFile(page, file, { playerName: 'PlayerOne' });
  const saved = await report(page);
  expect(saved.hud.status).toBe('zero');
  expect(saved.hud.candidates).toBe(0);
  expect(saved.events.filter(event => event.source === 'hud-ocr')).toHaveLength(0);
  await expect(page.locator('.hud-setup')).toContainText('未识别到本人行');
  // Other trajectory candidates may still exist; HUD zero does not discard them.
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(1);
});

test('cancelling HUD scanning keeps the recording and leaves no partial report', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/assets/ocr/worker.min.js', async route => { await new Promise(resolve => setTimeout(resolve, 4000)); await route.continue(); });
  await page.goto('/');
  await page.locator('#player-name').fill('PlayerOne');
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/hud-cancel.webm'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '取消分析，保留录像', exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '取消分析，保留录像', exact: true }).click();
  await expect(page.getByRole('heading', { name: '对局记录', exact: true })).toBeVisible();
  await expect(page.locator('#notice')).toContainText('分析已取消');
  await expect(page.locator('.library-card')).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('sight-report-')))).toBe(false);
});

test('legacy report can be given an identity later without changing its profile or recording', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  const file = await createHudVideo(page, path.resolve('artifacts/fixtures/hud-legacy-rescan.webm'), { duration: 8 });
  await importFile(page, file, { playerName: '' });
  const before = await report(page);
  expect(before.hud.status).toBe('name-required');
  expect(before.profile.dpi).toBe(800);
  await page.evaluate(id => {
    const key = `sight-report-${id}`;
    const current = JSON.parse(localStorage.getItem(key));
    delete current.hud;
    localStorage.setItem(key, JSON.stringify(current));
  }, before.id);
  await page.reload();
  await expect(page.getByRole('heading', { name: '继续上一局', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续复盘', exact: true }).click();
  await expect(page.locator('.hud-setup')).toContainText('旧报告未包含 HUD 信息');
  await page.locator('#hud-player-name').fill('PlayerOne');
  await page.locator('#hud-rescan').click();
  await expect(page.locator('.hud-setup')).toContainText('个本人 HUD 候选', { timeout: 150000 });
  const after = await report(page);
  expect(after.profile.dpi).toBe(800);
  expect(after.profile.sensitivity).toBe(0.35);
  expect(after.hud.identity.name).toBe('PlayerOne');
  expect(after.hud.status).toBe('complete');
  expect(after.events.filter(event => event.source === 'hud-ocr').length).toBeGreaterThanOrEqual(2);
  const recording = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    return (await storage.list()).find(item => item.id === id);
  }, before.id);
  expect(recording.actualBytes).toBeGreaterThan(1000);
  expect(recording.playerName).toBe('');
});
