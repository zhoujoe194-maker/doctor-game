import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSyntheticVideo } from '../helpers/synthetic-video.mjs';

// These tests use an explicit canvas capture adapter standing in for a real game
// window. They prove UI state and recovery rules, not native capture or Windows
// game performance.
async function installCanvasCapture(page, { paint = true, target = false } = {}) {
  await page.evaluate(options => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d'); let frame = 0, timer;
      const draw = () => {
        ctx.fillStyle = '#353d45'; ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#ffffff'; ctx.font = '24px sans-serif';
        ctx.fillText('doctorgame · 合成采集测试（非真实游戏）', 32, 48);
        if (options.target) {
          ctx.strokeStyle = '#ffee30'; ctx.lineWidth = 6;
          ctx.strokeRect(900 - Math.min(frame, 26) * 12, 330, 50, 150);
        }
        frame++;
      };
      if (options.paint) { draw(); timer = setInterval(draw, 50); }
      const stream = canvas.captureStream(20);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
      return stream;
    };
  }, { paint, target });
}

async function recordUntilReport(page) {
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await expect(page.getByRole('heading', { name: /正在录制/ })).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '结束并分析', exact: true }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 45000 });
}

test('first visit marks defaults for review and saving returns to the recording task', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '录制与复盘', exact: true })).toBeVisible();
  await expect(page.locator('.profile-verify')).toContainText('默认值');
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeVisible();
  const startBox = await page.getByRole('button', { name: '开始录制', exact: true }).boundingBox();
  expect(startBox.y).toBeLessThan(420);
  await expect(page.getByRole('button', { name: '导入录像', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '编辑玩家档案' }).click();
  await expect(page.locator('.profile-verify-page')).toContainText('默认值 800 / 0.35');
  await page.locator('[name="dpi"]').fill('1000');
  await page.locator('[name="sensitivity"]').fill('0.4');
  await page.getByRole('button', { name: '保存并返回工作台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '录制与复盘', exact: true })).toBeVisible();
  await expect(page.locator('#notice')).toContainText('玩家档案已保存');
  await expect(page.locator('.profile-verify')).toHaveCount(0);
  await expect(page.locator('.profile-strip')).toContainText('1000');
  await expect(page.locator('.profile-strip')).toContainText('档案已保存');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sight-profile')).dpi)).toBe(1000);
});

test('recommendation reason is visible next to the suggested value', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '查看合成示例' }).click();
  await expect(page.getByRole('heading', { name: '复盘示例' })).toBeVisible();
  const reason = page.getByTestId('recommend-reason');
  await expect(reason).toBeVisible();
  await expect(reason).toContainText('这是合成轨迹，用于体验回放和报告，不是你的实战数据。');
  await expect(page.getByRole('button', { name: '查看依据与复测' })).toBeVisible();
  await page.getByRole('button', { name: '查看依据与复测' }).click();
  await expect(page.locator('#advice-details')).toHaveAttribute('open', '');
  await expect(page.locator('#recommendation-detail')).toContainText('结合本局档案');
});

test('zero-candidate report opens direct manual recovery and returning home keeps continue in view', async ({ page }) => {
  await page.goto('/');
  await installCanvasCapture(page, { paint: true, target: false });
  await recordUntilReport(page);
  await expect(page.locator('#notice')).toContainText('没有找到候选片段');
  await expect(page.getByTestId('recommend-reason')).toContainText('需要至少 20 个确认有效的片段');
  await expect(page.locator('.zero-recovery')).toBeVisible();
  await expect(page.locator('.manual-marker.is-open')).toBeVisible();
  await expect(page.locator('#marker-form')).toBeVisible();
  await expect(page.getByRole('button', { name: '标记关键事件' })).toBeVisible();
  await expect(page.locator('#replay-context')).toHaveText('播放完整录像');
  await page.getByRole('button', { name: '标记当前播放位置' }).click();
  await expect(page.locator('#notice')).toContainText('关键事件已标记');
  await expect(page.locator('.event-row')).toHaveCount(1);

  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await expect(page.locator('.recent-session')).toBeVisible();
  await expect(page.locator('.recent-session')).toContainText('已确认且可量化');
  await expect(page.locator('.recents-rail')).toBeVisible();
  await expect(page.locator('#rail-preview')).toHaveJSProperty('videoWidth', 1280);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => scrollTo(0, 0));
  const recent = page.locator('.recent-session');
  const compact = page.locator('.capture-compact');
  expect((await recent.boundingBox()).y).toBeLessThan((await compact.boundingBox()).y);
  const continueButton = recent.getByRole('button', { name: '继续复盘', exact: true });
  const box = await continueButton.boundingBox();
  expect(box.y).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(720);
  await expect(continueButton).toBeInViewport({ ratio: 1 });
  await continueButton.click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
});

test('no-frame capture waits, can be cancelled, times out without saving, then recovers', async ({ page }) => {
  await page.goto('/');
  await installCanvasCapture(page, { paint: false });
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await expect(page.getByRole('heading', { name: '正在等待窗口画面…' })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('heading', { name: /正在录制/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '结束并分析', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '取消等待', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('已取消等待画面');
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeEnabled();

  await installCanvasCapture(page, { paint: false });
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('没有收到窗口画面', { timeout: 15000 });
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.recording-row')).toHaveCount(0);
  await expect(page.locator('.large-empty')).toBeVisible();

  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await installCanvasCapture(page, { paint: true, target: true });
  await recordUntilReport(page);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
});

test('a 0-byte recording stays visible but cannot enter analysis', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { storage } = await import('/src/storage.js');
    const profile = { dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' };
    const id = await storage.begin({ profile, title: '空采集.webm', mimeType: 'video/webm' });
    await storage.finish(id, { duration: 2, bytes: 0, empty: true, incomplete: true });
  });
  await page.reload();
  await expect(page.locator('.recent-session.no-footage')).toBeVisible();
  await expect(page.locator('.recent-session.no-footage')).toContainText('磁盘上的录像文件为空（0 字节）');
  await page.getByRole('button', { name: '对局记录', exact: true }).click();
  await expect(page.locator('.recording-row')).toContainText('无画面');
  await page.locator('.recording-row').click();
  await expect(page.locator('#notice')).toContainText('实际文件为空（0 字节）');
  await expect(page.getByRole('heading', { name: '对局记录', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toHaveCount(0);
});

test('unfinished browser chunks recover after reload without rewriting metadata', async ({ page }) => {
  const file = await createSyntheticVideo(page, path.resolve('artifacts/fixtures/recovery-unfinished.webm'));
  const base64 = (await readFile(file)).toString('base64');
  await page.goto('/');
  const profile = { dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' };
  const id = await page.evaluate(async ({ encoded, profile }) => {
    const { storage } = await import('/src/storage.js');
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const id = await storage.begin({ profile, title: '未完成录像.webm', mimeType: 'video/webm' });
    for (let position = 0; position < bytes.length; position += 8 * 1024 ** 2) {
      await storage.append(id, new Blob([bytes.slice(position, position + 8 * 1024 ** 2)], { type: 'video/webm' }));
    }
    return id;
  }, { encoded: base64, profile });
  await page.reload();
  await expect(page.locator('.recent-session')).toContainText('未完成录像.webm');
  await expect(page.locator('.recent-session')).toContainText('可尝试恢复分析');
  const before = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    return (await storage.list()).find(item => item.id === id);
  }, id);
  expect(before.status).toBe('recording');
  expect(before.bytes).toBeUndefined();
  expect(before.actualBytes).toBeGreaterThan(1000);
  await page.locator('.recent-session').getByRole('button', { name: '打开并分析' }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 60000 });
  const after = await page.evaluate(async id => {
    const { storage } = await import('/src/storage.js');
    return (await storage.list()).find(item => item.id === id);
  }, id);
  expect(after.status).toBe('recording');
  expect(after.bytes).toBeUndefined();
  expect(await page.evaluate(id => Boolean(localStorage.getItem('sight-report-' + id)), id)).toBe(true);
});

test('corrupt or invalid saved profiles fall back to defaults and stay unconfirmed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('sight-profile', '{broken json'));
  await page.reload();
  await expect(page.locator('.profile-verify')).toContainText('默认值');
  expect(await page.evaluate(() => localStorage.getItem('sight-profile'))).toBe('{broken json');
  await page.evaluate(() => localStorage.setItem('sight-profile', JSON.stringify({ dpi: 0, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' })));
  await page.reload();
  await expect(page.locator('.profile-verify')).toContainText('默认值');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sight-profile')).dpi)).toBe(0);
  await page.evaluate(() => localStorage.setItem('sight-profile', JSON.stringify({ dpi: 1600, sensitivity: 0.4, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' })));
  await page.reload();
  await expect(page.locator('.profile-verify')).toHaveCount(0);
  await expect(page.locator('.profile-strip')).toContainText('1600');
});
