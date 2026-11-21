// Independent player-task audit. Synthetic capture adapter is explicit; never a hardware claim.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd(), label = process.env.AUDIT_LABEL || 'before';
const out = path.join(root, 'artifacts/player-experience', label);
const fixture = path.join(root, 'artifacts/player-experience/合成测试对局.webm');
const data = await mkdtemp(path.join(tmpdir(), 'doctorgame-flow-'));
await mkdir(out, { recursive: true });
let app, page, window;
const results = { label, userData: data, capture: 'canvas adapter; real Electron IPC/disk/MediaRecorder', checks: [] };
async function launch() {
  app = await electron.launch({ args: [root, '--user-data-dir=' + data] });
  page = await app.firstWindow(); window = await app.browserWindow(page);
  await page.getByRole('heading', { name: '录制与复盘', exact: true }).waitFor();
  await window.evaluate(w => w.setContentSize(1440, 900));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);
}
async function home() { await page.getByRole('button', { name: '工作台', exact: true }).click(); }
async function shot(name) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(out, name + '.png'), scale: 'css' }); }
async function importFixture() {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(fixture);
}
async function report() { await page.getByRole('heading', { name: '赛后复盘', exact: true }).waitFor({ timeout: 60000 }); }
async function selectSynthetic() {
  await page.getByRole('button', { name: '开始录制', exact: true }).click();
  await page.locator('[data-source]').filter({ hasText: 'FPS 合成测试场景' }).click();
}
try {
  await launch(); await shot('first-use');
  results.firstText = await page.locator('main').innerText();
  await page.getByRole('button', { name: '编辑玩家档案' }).click();
  await page.locator('[name="dpi"]').fill('800');
  await page.getByRole('button', { name: '保存玩家档案', exact: true }).click();
  results.profileAfterSave = await page.locator('main').innerText();
  await home(); await importFixture(); await report();
  const item = (await page.evaluate(() => window.doctorgame.list()))[0];
  const firstReport = await page.evaluate(id => JSON.parse(localStorage.getItem('sight-report-' + id)), item.id);
  assert.ok(firstReport.events.length >= 2);
  await page.locator('[data-event="1"]').click();
  await expect.poll(() => page.locator('#replay').evaluate(v => v.currentTime)).toBeCloseTo(firstReport.events[1].start, 1);
  await page.locator('#playback-rate').selectOption('0.5');
  await page.locator('#review-context').selectOption('duel');
  await page.locator('#confirm-event').click();
  await expect(page.getByTestId('quantified-count')).toHaveText('1 / 20 起步样本');
  await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.5);
  await page.locator('[data-event="0"]').click(); await page.locator('#exclude-event').click();
  results.reportText = await page.locator('main').innerText(); await shot('report');
  const stored = await page.evaluate(id => localStorage.getItem('sight-report-' + id), item.id);
  const digest = createHash('sha256').update(await readFile(path.join(data, 'recordings', item.id + '.webm'))).digest('hex');
  await home(); await expect(page.locator('#recent-preview')).toHaveJSProperty('videoWidth', 1280); await shot('returning');
  await window.evaluate(w => w.setContentSize(1280, 720)); await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1280);
  results.continueBounds = await page.getByRole('button', { name: '继续复盘', exact: true }).boundingBox(); await shot('returning-1280');
  await window.evaluate(w => w.setContentSize(1440, 900));
  await page.getByRole('button', { name: '编辑玩家档案' }).click(); await page.locator('[name="dpi"]').fill('1600');
  await page.getByRole('button', { name: '保存玩家档案', exact: true }).click();
  await app.close(); await launch(); await page.getByRole('button', { name: '继续复盘', exact: true }).click(); await report();
  assert.equal(await page.evaluate(id => localStorage.getItem('sight-report-' + id), item.id), stored);
  assert.equal(createHash('sha256').update(await readFile(path.join(data, 'recordings', item.id + '.webm'))).digest('hex'), digest);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sight-profile')).dpi), 1600);
  await expect(page.locator('.page-heading')).toContainText('800 DPI');
  results.checks.push('import/seek/0.5x/confirm/exclude/restart/recording bytes/old 800 DPI vs current 1600');
  await home(); await page.getByRole('button', { name: '编辑玩家档案' }).click(); await page.locator('[name="dpi"]').fill('800');
  await page.getByRole('button', { name: '保存玩家档案', exact: true }).click(); await home();
  // Only this isolated test process substitutes source enumeration and getDisplayMedia.
  await app.evaluate(({ desktopCapturer, nativeImage }) => {
    desktopCapturer.getSources = async () => [{ id: 'window:synthetic:0', name: 'FPS 合成测试场景', thumbnail: nativeImage.createEmpty() }];
  });
  await page.getByRole('button', { name: '开始录制', exact: true }).click(); await page.locator('[data-source]').waitFor(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeFocused();
  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('audit denial', 'NotAllowedError'); }; });
  await selectSynthetic(); await expect(page.locator('#notice')).toContainText('权限');
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeEnabled();
  results.denied = await page.locator('#notice').innerText();
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const x = c.getContext('2d');
      const draw = () => { x.fillStyle = '#353d45'; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#ffffff'; x.font = '24px sans-serif'; x.fillText('doctorgame · 合成采集测试（非真实游戏）', 32, 48); x.fillRect(636, 356, 8, 8); };
      draw(); const timer = setInterval(draw, 50), stream = c.captureStream(20);
      stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer)); return stream;
    };
  });
  await selectSynthetic(); await page.locator('#stop-recording').waitFor();
  await expect(page.locator('#live-preview')).toHaveJSProperty('videoWidth', 1280); await shot('recording');
  await window.evaluate(w => w.minimize()); await expect.poll(() => window.evaluate(w => w.isMinimized())).toBe(true);
  await window.evaluate(w => { w.restore(); w.show(); });
  await page.getByRole('button', { name: '玩家档案', exact: true }).click(); await expect(page.locator('#stop-banner')).toBeVisible();
  await window.evaluate(w => w.close()); await expect.poll(() => window.evaluate(w => w.isVisible())).toBe(false);
  await window.evaluate(w => w.show());
  await expect.poll(async () => { const r = (await page.evaluate(() => window.doctorgame.list()))[0]; return (await readFile(path.join(data, 'recordings', r.id + '.webm'))).length; }, { timeout: 10000 }).toBeGreaterThan(0);
  await page.locator('#stop-banner').click(); await report();
  results.zeroText = await page.locator('main').innerText(); await shot('zero-candidates');
  const zero = await page.evaluate(async () => { const r = (await window.doctorgame.list())[0]; return JSON.parse(localStorage.getItem('sight-report-' + r.id)); });
  assert.equal(zero.events.length, 0);
  results.checks.push('chooser cancel focus/denial retry via explicit adapter/record/minimize/hide/show/stop/save/analyze/zero candidates');
  await home(); await importFixture(); await page.locator('#cancel-analysis').waitFor(); await page.locator('#cancel-analysis').click();
  await page.getByRole('heading', { name: '对局记录', exact: true }).waitFor(); await expect(page.locator('#notice')).toContainText('录像仍保留');
  await page.locator('[data-recording]').first().click(); await report(); results.checks.push('analysis cancel retained/retry completes');
  results.passed = true;
} finally {
  await writeFile(path.join(out, 'audit.json'), JSON.stringify(results, null, 2));
  await app?.close();
}
console.log(JSON.stringify({ passed: results.passed, checks: results.checks, userData: data }, null, 2));
