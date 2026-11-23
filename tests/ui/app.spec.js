import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';

test('workspace, profile, review, recovery and responsive accessibility', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '录制与复盘' })).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workspace-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '档案', exact: true }).click();
  await page.getByLabel('手腕为主').check();
  await page.getByLabel('抓握', { exact: false }).check();
  await page.getByRole('spinbutton', { name: '鼠标左右可移动的总宽度' }).fill('22');
  await page.getByLabel('经常拉到边缘').check();
  await page.getByRole('button', { name: '保存玩家档案' }).click();
  await expect(page.getByText('已保存。下一次观察将使用这份档案。')).toBeVisible();
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'artifacts/profile-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await page.getByRole('button', { name: '档案', exact: true }).click();
  await expect(page.getByLabel('手腕为主')).toBeChecked();
  await expect(page.getByLabel('抓握', { exact: false })).toBeChecked();
  await page.getByRole('button', { name: '录制', exact: true }).click();
  await page.locator('#load-demo').click();
  await expect(page.getByRole('heading', { name: '复盘示例' })).toBeVisible();
  await page.getByText('建议依据与下一次复测', { exact: true }).click();
  await expect(page.getByText('这是合成轨迹，用于体验回放和报告，不是你的实战数据。')).toBeVisible();
  await page.getByRole('button', { name: '确认有效' }).click();
  await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
  await expect(page.getByRole('button', { name: '已确认 · 更新' })).toBeVisible();
  await page.getByRole('button', { name: '排除此片段' }).click();
  await expect(page.getByRole('button', { name: '恢复此片段' })).toBeVisible();
  await page.getByRole('button', { name: '恢复此片段' }).click();
  await page.locator('#event-filter').selectOption('death');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.locator('#event-filter').selectOption('preaim');
  await expect(page.locator('.event-row')).toHaveCount(1);
  await page.locator('.event-row').click();
  await page.getByText('轨迹与判断依据', { exact: true }).click();
  await expect(page.getByText('背景位移估计 · 水平方向')).toBeVisible();
  await expect(page.locator('#review-kind')).toBeDisabled();
  await page.locator('#event-filter').selectOption('all');
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: 'artifacts/report-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '录制', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
    if (width === 390) await page.screenshot({ path: 'artifacts/workspace-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '档案', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(errors).toEqual([]);
});

test('real media encoding, chunk storage, post-recording decoding and no false recommendation', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d'); let frame = 0;
      const timer = setInterval(() => {
        ctx.fillStyle = '#202d26'; ctx.fillRect(0, 0, 640, 360);
        ctx.strokeStyle = '#ffed20'; ctx.lineWidth = 4;
        ctx.strokeRect(430 - Math.min(frame, 30) * 3, 150, 25, 70); frame++;
      }, 50);
      const stream = canvas.captureStream(20); stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    }});
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始录制' }).click();
  await expect(page.locator('#notice')).toHaveText('已开始录制。打完后点击“结束并分析”。');
  await expect(page.locator('#elapsed')).toHaveText('00:02', { timeout: 8000 });
  await page.getByRole('button', { name: '结束并分析' }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘' })).toBeVisible({ timeout: 45000 });
  await expect(page.getByText('保持当前值 0.35', { exact: true })).toBeVisible();
  const report = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('sight-report-'));
    return JSON.parse(localStorage.getItem(key));
  });
  expect(report.processed).toBeGreaterThan(20); expect(report.demo).toBe(false);
  await page.getByText('补充漏掉的关键事件', { exact: true }).click();
  await page.getByRole('combobox', { name: '手动标记的事件类型' }).selectOption('death');
  await page.getByRole('button', { name: '标记当前播放位置' }).click();
  await page.getByText('轨迹与判断依据', { exact: true }).click();
  await expect(page.getByText('该片段尚无量化轨迹')).toBeVisible();
  await page.locator('#playback-rate').selectOption('0.5');
  expect(await page.locator('#replay').evaluate(v => v.playbackRate)).toBe(0.5);
  await expect(page.getByText('保持当前值 0.35', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续复盘' }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('screen capture denial has a recovery path', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }));
  await page.goto('/'); await page.getByRole('button', { name: '开始录制' }).click();
  await expect(page.locator('#notice')).toHaveText('未获得录屏权限。可以重新选择窗口，或在系统设置中允许录屏。');
  await expect(page.getByRole('button', { name: '开始录制' })).toBeEnabled();
});
