import { test, expect } from '@playwright/test';
import { createSyntheticVideo } from '../helpers/synthetic-video.mjs';
import path from 'node:path';

test('compact top navigation and first-use task replace the permanent sidebar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.locator('.topnav')).toBeVisible();
  await expect(page.locator('.nav-link')).toHaveText(['录制', '对局记录', '档案', '帮助']);
  await expect(page.locator('h1')).toHaveText('录制与复盘');
  await expect(page.locator('#start-recording')).toBeVisible();
  await expect(page.locator('#import-video')).toBeVisible();
  await expect(page.locator('.settings-card')).toContainText('默认值 · 待核对');
  await expect(page.locator('.capture-surface video')).toHaveCount(0);
  const start = await page.locator('#start-recording').boundingBox();
  expect(start.y).toBeLessThan(420);
  for (const width of [760, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.topnav')).toBeVisible();
  }
  // 200% browser zoom roughly halves the CSS viewport; this is a layout check only.
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('report keeps playback and review controls in the first viewport at 1440x900 and 1280x720', async ({ page }) => {
  await page.goto('/');
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/full-ui-report.webm'));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  for (const [width, height] of [[1440, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const selector of ['#replay', '#playback-rate', '#replay-seek', '#confirm-event', '#exclude-event']) {
      await expect(page.locator(selector)).toBeVisible();
      const box = await page.locator(selector).boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    const stage = await page.locator('.evidence-stage').boundingBox();
    expect(stage.height).toBeGreaterThanOrEqual(220);
    await page.locator('#playback-rate').selectOption('0.5');
    await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.5);
    await expect(page.locator('.advice-details')).not.toHaveAttribute('open', '');
  }
});

test('library groups recordings and loads real video thumbnails lazily', async ({ page }) => {
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/full-ui-library.webm'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.library-day h2')).toContainText('今天');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await expect(page.locator('.library-thumb img')).toBeVisible({ timeout: 15000 });
  expect(await page.locator('.library-thumb img').getAttribute('src')).toMatch(/^data:image\/jpeg/);
  expect(await page.locator('.library-thumb video').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('profile is a compact settings panel and help answers actual questions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '档案', exact: true }).click();
  await expect(page.getByRole('heading', { name: '玩家档案', exact: true })).toBeVisible();
  await expect(page.locator('.settings-group')).toHaveCount(4);
  await expect(page.locator('.form-aside')).toHaveCount(0);
  await expect(page.locator('.save-bar')).toBeVisible();
  await page.getByRole('button', { name: '帮助', exact: true }).click();
  await expect(page.getByRole('heading', { name: '使用帮助', exact: true })).toBeVisible();
  await expect(page.locator('.help-block')).toHaveCount(6);
  await expect(page.locator('.method-number')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('a broken thumbnail keeps the recording entry recoverable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { storage } = await import('/src/storage.js');
    const profile = { dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' };
    const id = await storage.begin({ profile, title: '坏预览录像.webm', mimeType: 'video/webm' });
    await storage.append(id, new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/webm' }));
    await storage.finish(id, { duration: 1, bytes: 5 });
  });
  await page.reload();
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  const card = page.locator('.library-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.thumb-fallback')).toContainText('无法预览', { timeout: 15000 });
  await card.click();
  await expect(page.getByRole('heading', { name: '对局记录', exact: true })).toBeVisible();
  await expect(page.locator('#notice')).toContainText('录像已保留');
  await expect(page.locator('.library-card')).toHaveCount(1);
});


test('invalid stored reports degrade home and history without overwriting the report', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/full-ui-invalid-report.webm'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 60000 });
  const key = await page.evaluate(() => Object.keys(localStorage).find(item => item.startsWith('sight-report-')));
  const itemId = key.replace('sight-report-', '');
  const recordingBefore = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    const item = (await storage.list()).find(entry => entry.id === id);
    return item ? { actualBytes: item.actualBytes, bytes: item.bytes, status: item.status } : null;
  }, itemId);

  // An out-of-range old profile must not crash the home shell or be shown as 0/20.
  await page.evaluate(k => { const report = JSON.parse(localStorage.getItem(k)); report.profile.dpi = 0; localStorage.setItem(k, JSON.stringify(report)); }, key);
  const invalidProfile = await page.evaluate(k => localStorage.getItem(k), key);
  await page.reload();
  await expect(page.getByRole('heading', { name: '继续上一局', exact: true })).toBeVisible();
  await expect(page.locator('.session-problem')).toContainText('报告无法读取');
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入录像', exact: true })).toBeVisible();
  await expect(page.getByTestId('quantified-count')).toHaveCount(0);
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(invalidProfile);

  // A null events array is the same report-read boundary.
  const invalidEvents = await page.evaluate(k => { const report = JSON.parse(localStorage.getItem(k)); report.events = null; localStorage.setItem(k, JSON.stringify(report)); return localStorage.getItem(k); }, key);
  await page.reload();
  await expect(page.getByRole('heading', { name: '继续上一局', exact: true })).toBeVisible();
  await expect(page.locator('.session-problem')).toBeVisible();
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.library-card')).toContainText('报告无法读取');
  await page.locator('.library-card').click();
  await expect(page.locator('#notice')).toContainText('报告的存档数据不完整');
  await expect(page.getByRole('heading', { name: '对局记录', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toHaveCount(0);
  // Navigation and other valid reports still work.
  await page.locator('#load-demo').click();
  await expect(page.getByRole('heading', { name: '复盘示例', exact: true })).toBeVisible();
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe(invalidEvents);
  const recordingAfter = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    const item = (await storage.list()).find(entry => entry.id === id);
    return item ? { actualBytes: item.actualBytes, bytes: item.bytes, status: item.status } : null;
  }, itemId);
  expect(recordingAfter).toEqual(recordingBefore);
  expect(errors).toEqual([]);
});
