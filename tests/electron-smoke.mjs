import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dataDir = await mkdtemp(path.join(tmpdir(), 'doctorgame-electron-test-'));
const desktop = await electron.launch({ args: ['.', `--user-data-dir=${dataDir}`], cwd: process.cwd(), timeout: 30000 });
let testPage;
try {
  const page = await desktop.firstWindow();
  testPage = page;
  page.on('pageerror', error => console.log('Renderer error:', error.message));
  page.on('console', message => { if (message.type() === 'error') console.log('Renderer console:', message.text()); });
  await page.getByRole('heading', { name: '你的瞄准工作台.' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.doctorgame.platform), process.platform);
  const id = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'), stream = canvas.captureStream(20), chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = event => chunks.push(event.data);
    const done = new Promise(resolve => recorder.onstop = resolve);
    recorder.start();
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = '#202d26'; ctx.fillRect(0, 0, 640, 360);
      ctx.strokeStyle = '#ffee30'; ctx.lineWidth = 4; ctx.strokeRect(430 - i * 4, 150, 25, 70);
      await new Promise(r => setTimeout(r, 50));
    }
    recorder.stop(); await done; stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    const id = await window.doctorgame.begin({ title: '桌面测试 · 合成录像', mimeType: 'video/webm', profile: { dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'claw', mouseSpace: 30, comfort: 'comfortable' } });
    await window.doctorgame.append(id, await blob.arrayBuffer());
    await window.doctorgame.finish(id, { duration: 1, bytes: blob.size });
    await window.doctorgame.setBusy(false);
    return id;
  });
  await page.reload();
  await page.getByRole('button', { name: /桌面测试 · 合成录像/ }).click();
  await page.getByRole('heading', { name: '看清这一次瞄准.' }).waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem(`sight-report-${id}`)).demo, id), false);
  assert.ok(await page.locator('#replay').evaluate(v => v.videoWidth > 0));
  await page.getByRole('button', { name: '玩家档案', exact: true }).click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/electron-profile.png', fullPage: true });
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('Electron smoke passed: native IPC, disk recording, media range decoding, report, sandbox, 200% zoom.');
  console.log(`Isolated synthetic test data: ${dataDir}`);
} catch (error) {
  console.log('Desktop notice:', await testPage?.locator('#notice').textContent().catch(() => 'unavailable'));
  throw error;
} finally { await desktop.evaluate(({ app }) => app.exit(0)).catch(() => {}); await desktop.close(); }
