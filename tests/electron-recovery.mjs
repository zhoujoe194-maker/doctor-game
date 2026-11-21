// Desktop crash-recovery regression. A recording JSON can say status:"recording",
// bytes:0 while the WebM on disk is complete (append() only updates memory). The
// app must use the real file size, allow replay/analysis, and leave the original
// file and metadata untouched. This test only writes inside an isolated user-data
// directory and a synthetic fixture; it is not a Windows/game-capture claim.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSyntheticVideo } from './helpers/synthetic-video.mjs';

const root = process.cwd();
const executablePath = process.env.DOCTORGAME_EXECUTABLE;
const label = process.env.DOCTORGAME_RECOVERY_LABEL || (executablePath ? 'wrapped' : 'development');
const userData = process.env.DOCTORGAME_TEST_USER_DATA || await mkdtemp(path.join(tmpdir(), 'doctorgame-recovery-'));
const output = path.resolve('artifacts/electron-recovery', label);
await mkdir(output, { recursive: true });
const profile = { dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' };
const id = randomUUID();
const recordings = path.join(userData, 'recordings');
let desktop, page;
const filePath = path.join(recordings, id + '.webm');
const indexPath = path.join(recordings, id + '.json');
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');

async function launch() {
  desktop = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), '--user-data-dir=' + userData],
    cwd: root, timeout: 45000
  });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '录制与复盘', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function close() { if (desktop) { await desktop.close(); desktop = null; } }

try {
  await mkdir(recordings, { recursive: true });
  // 1. A real encoded WebM is created first; the app is then closed before the
  // metadata/index is written, emulating an interrupted capture whose JSON was
  // never updated by recording:finish.
  await launch();
  await expect(page.getByRole('button', { name: '开始录制', exact: true })).toBeVisible();
  const fixture = await createSyntheticVideo(page, path.join(output, '合成恢复测试.webm'));
  await close();
  await copyFile(fixture, filePath);
  const metadata = { profile, title: '恢复测试.webm', mimeType: 'video/webm', id, createdAt: new Date().toISOString(), status: 'recording', bytes: 0 };
  const metadataText = JSON.stringify(metadata);
  await writeFile(indexPath, metadataText);
  const originalSHA = await digest(filePath);

  // 2. Relaunch with the stale metadata: the real file size must win and the home
  // screen must offer recovery rather than claiming there is no picture.
  await launch();
  await expect(page.locator('.recent-session.no-footage')).toHaveCount(0);
  await expect(page.locator('.recent-session')).toContainText('恢复测试.webm');
  await expect(page.locator('.recent-session')).toContainText('可尝试恢复分析');
  const listed = await page.evaluate(() => window.doctorgame.list());
  assert.equal(listed.length, 1);
  assert.equal(listed[0].actualBytes, (await stat(filePath)).size);
  assert.equal(listed[0].bytes, 0);
  assert.equal(listed[0].status, 'recording');
  await page.locator('.recent-session').getByRole('button', { name: '打开并分析' }).click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  await page.locator('#replay-context').click();
  await expect.poll(() => page.locator('#replay').evaluate(video => video.currentTime), { timeout: 20000 }).toBeGreaterThan(0.1);
  await page.locator('#replay').evaluate(video => video.pause());
  assert.equal(await page.evaluate(id => Boolean(localStorage.getItem('sight-report-' + id)), id), true);
  // Original bytes and metadata are preserved exactly.
  assert.equal(await digest(filePath), originalSHA);
  assert.equal(await readFile(indexPath, 'utf8'), metadataText);
  assert.deepEqual(JSON.parse(await readFile(indexPath, 'utf8')), metadata);
  await page.screenshot({ path: path.join(output, 'recovered-report.png'), fullPage: true, scale: 'css' });

  // 3. Restart keeps the saved report/progress and allows replay again.
  await close();
  await launch();
  const continueButton = page.locator('.recent-session').getByRole('button', { name: '继续复盘', exact: true });
  await expect(continueButton).toBeVisible();
  await expect(page.locator('#recent-preview')).toHaveJSProperty('videoWidth', 1280);
  await continueButton.click();
  await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible();
  assert.equal(await digest(filePath), originalSHA);
  assert.equal(await readFile(indexPath, 'utf8'), metadataText);
  await page.screenshot({ path: path.join(output, 'recovered-after-restart.png'), fullPage: true, scale: 'css' });

  const result = {
    passed: true,
    userData,
    recordingId: id,
    fileBytes: (await stat(filePath)).size,
    metadataStatus: metadata.status,
    metadataBytes: metadata.bytes,
    reportSaved: true,
    originalFileAndMetadataPreserved: true,
    executable: executablePath || 'development Electron',
    note: 'Synthetic WebM only; emulates interrupted capture metadata. No Windows/game-capture claim.'
  };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  console.log('Desktop notice:', await page?.locator('#notice').textContent().catch(() => 'unavailable'));
  throw error;
} finally { await close(); }
