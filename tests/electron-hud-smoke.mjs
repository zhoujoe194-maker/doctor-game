// Independent source-desktop acceptance: real video and real offline OCR.
// No capture adapter, OCR stub, installer, or production debugging port.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHudVideo } from './helpers/hud-video.mjs';

const dataDir = await mkdtemp(path.join(tmpdir(), 'doctorgame-electron-hud-'));
const output = path.resolve('artifacts/electron/hud-source');
await mkdir(output, { recursive: true });
let desktop, page;
const errors = [], requests = [];
async function launch() {
  desktop = await electron.launch({ args: ['.', `--user-data-dir=${dataDir}`], timeout: 45000 });
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  const window = await desktop.browserWindow(page);
  await window.evaluate(w => w.setContentSize(1440, 900));
  const prefs = await window.evaluate(w => {
    const p = w.webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
  });
  assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  await expect(page.getByRole('heading', { name: /^(录制与复盘|继续上一局)$/ })).toBeVisible();
}
async function saved() {
  return page.evaluate(async () => {
    const item = (await window.doctorgame.list())[0];
    const raw = localStorage.getItem(`sight-report-${item.id}`);
    return { item, raw, report: JSON.parse(raw), profile: JSON.parse(localStorage.getItem('sight-profile')) };
  });
}
async function close() { if (desktop) { await desktop.close(); desktop = null; } }
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
try {
  await launch();
  const fixture = await createHudVideo(page, path.join(output, 'synthetic-hud.webm'));
  await page.locator('#player-name').fill('PlayerOne');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入录像', exact: true }).click();
  await (await chooser).setFiles(fixture);
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 180000 });
  const initial = await saved();
  assert.equal(initial.report.hud.status, 'complete');
  const events = initial.report.events.filter(event => event.source === 'hud-ocr');
  assert.ok(events.some(event => event.context === 'kill'));
  assert.ok(events.some(event => event.context === 'death'));
  assert.ok(events.every(event => event.kind === 'observation' && !event.reviewed));
  assert.equal(initial.item.playerName, 'PlayerOne');
  const deathIndex = initial.report.events.findIndex(event => event.context === 'death');
  await page.locator(`[data-event="${deathIndex}"]`).click();
  await expect.poll(() => page.locator('#replay').evaluate(v => v.currentTime)).toBeCloseTo(initial.report.events[deathIndex].start, 1);
  await page.locator('#playback-rate').selectOption('0.25');
  await page.locator('#replay').evaluate(async v => { await v.play(); v.pause(); });
  await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.25);
  await page.getByRole('button', { name: '确认事件', exact: true }).click();
  await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
  const otherIndex = initial.report.events.findIndex(event => event.context === 'kill');
  await page.locator(`[data-event="${otherIndex}"]`).click();
  await page.locator('#exclude-event').click();
  await page.screenshot({ path: path.join(output, 'report.png'), scale: 'css' });
  await page.locator('#hud-setup').evaluate(element => { element.open = true; });
  await page.locator('#hud-rescan').click();
  await expect(page.locator('.hud-setup')).toBeVisible({ timeout: 120000 });
  const rescanned = await saved();
  assert.equal(rescanned.report.events[deathIndex].reviewed, true);
  assert.equal(rescanned.report.events[otherIndex].included, false);
  assert.equal(new Set(rescanned.report.events.map(event => event.id)).size, rescanned.report.events.length);
  assert.equal(rescanned.report.hud.workerTerminated, true);
  const statuses = await page.evaluate(async () => Promise.all([
    'doctorgame-asset://wrong/worker.min.js',
    'doctorgame-asset://ocr/..%2f..%2findex.html'
  ].map(async url => (await fetch(url)).status)));
  assert.deepEqual(statuses, [403, 403]);
  await page.getByRole('button', { name: '录制', exact: true }).click();
  await page.locator('#player-name').fill('DifferentPlayer');
  await page.getByRole('button', { name: '档案', exact: true }).click();
  await page.locator('[name="dpi"]').fill('1600');
  await page.getByRole('button', { name: '保存并返回录制', exact: true }).click();
  const before = await saved();
  const recordingFile = path.join(dataDir, 'recordings', before.item.id + '.webm');
  const beforeHash = await digest(recordingFile);
  await close();
  await launch();
  const after = await saved();
  assert.equal(after.raw, before.raw);
  assert.equal(await digest(recordingFile), beforeHash);
  assert.equal(after.profile.dpi, 1600);
  assert.equal(after.report.profile.dpi, 800);
  assert.equal(after.report.hud.identity.name, 'PlayerOne');
  await page.getByRole('button', { name: '继续复盘', exact: true }).click();
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  await page.locator('#replay').evaluate(async v => { await v.play(); v.pause(); });
  assert.equal(await page.locator('#replay').evaluate(v => v.error), null);
  assert.ok(requests.some(url => url === 'doctorgame-asset://ocr/worker.min.js'));
  assert.deepEqual(requests.filter(url => /^https?:/i.test(url)), []);
  assert.deepEqual(errors, []);
  const result = { passed: true, platform: process.platform, userData: dataDir, sourceOnly: true,
    candidates: events.length, scans: initial.report.hud.scans, ocrElapsedMs: initial.report.hud.elapsedMs,
    fixtureSHA256: await digest(fixture), recordingSHA256: beforeHash,
    profileSnapshot: after.report.profile, identitySnapshot: after.report.hud.identity,
    externalRequests: [], note: 'Synthetic HUD engineering verification, not real gameplay accuracy or performance.' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await close(); }
