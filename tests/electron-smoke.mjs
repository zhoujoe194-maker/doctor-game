import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createSyntheticVideo } from './helpers/synthetic-video.mjs';

const executablePath = process.env.DOCTORGAME_EXECUTABLE;
const dataDir = process.env.DOCTORGAME_TEST_USER_DATA || await mkdtemp(path.join(tmpdir(), 'doctorgame-electron-test-'));
const label = process.env.DOCTORGAME_TEST_LABEL || (executablePath ? 'packaged' : 'development');
const output = path.resolve('artifacts/electron', label);
const expectedPath = process.env.DOCTORGAME_EXPECTED_STATE || path.join(output, 'expected-state.json');
const reopenOnly = process.env.DOCTORGAME_TEST_REOPEN_ONLY === '1';
await mkdir(output, { recursive: true });
let desktop, page;
const errors = [];
const fileDigest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
async function launch() {
  const env = { ...process.env };
  if (process.platform === 'win32' && executablePath) {
    // Only the driver uses Node. The installed child receives no Node/pnpm paths.
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  }
  desktop = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    args: [...(executablePath ? [] : ['.']), `--user-data-dir=${dataDir}`],
    cwd: process.cwd(), env, timeout: 45000 });
  page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('heading', { name: '录制与复盘', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.doctorgame.platform), process.platform);
  const prefs = await desktop.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
  });
  assert.deepEqual(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  const runtime = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), versions: process.versions }));
  assert.equal(await realpath(runtime.userData), await realpath(dataDir));
  if (process.env.DOCTORGAME_EXPECTED_VERSION) assert.equal(runtime.version, process.env.DOCTORGAME_EXPECTED_VERSION);
  return runtime;
}
async function close() { if (desktop) { await desktop.close(); desktop = null; } }
async function savedState() {
  return page.evaluate(async () => {
    const recordings = await window.doctorgame.list();
    const item = recordings[0];
    return { id: item.id, item, profile: JSON.parse(localStorage.getItem('sight-profile')),
      report: JSON.parse(localStorage.getItem('sight-report-' + item.id)) };
  });
}
async function checkSaved(expected) {
  assert.deepEqual(await savedState(), expected.state);
  const recording = path.join(dataDir, 'recordings', expected.state.id + '.webm');
  assert.equal(await fileDigest(recording), expected.recordingSHA256);
  await page.getByRole('button', { name: '继续复盘', exact: true }).click();
  await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
  assert.ok((await page.locator('#replay').getAttribute('src')).startsWith('doctorgame-video://capture/'));
  await page.locator('[data-clip="1"]').focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.locator('#replay').evaluate(v => v.currentTime)).toBeCloseTo(expected.state.report.events[1].start, 1);
}
try {
  const runtime = await launch();
  if (reopenOnly) {
    await checkSaved(JSON.parse(await readFile(expectedPath, 'utf8')));
  } else {
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    const fixture = await createSyntheticVideo(page, path.join(output, '合成测试对局.webm'));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入录像', exact: true }).click();
    await (await chooser).setFiles(fixture);
    await expect(page.getByRole('heading', { name: '赛后复盘', exact: true })).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#replay')).toHaveJSProperty('videoWidth', 1280);
    const initial = await savedState();
    assert.ok(initial.report.events.length >= 2);
    assert.equal(initial.report.demo, false);
    assert.ok((await stat(path.join(dataDir, 'recordings', initial.id + '.webm'))).size > 10000);
    await page.locator('[data-event="1"]').click();
    await expect.poll(() => page.locator('#replay').evaluate(v => v.currentTime)).toBeCloseTo(initial.report.events[1].start, 1);
    await expect(page.locator('#replay')).toHaveJSProperty('seeking', false);
    await expect.poll(() => page.locator('#replay').evaluate(v => v.readyState)).toBeGreaterThanOrEqual(2);
    await page.locator('#playback-rate').selectOption('0.5');
    const position = await page.locator('#replay').evaluate(v => { window.testPlayer = v; return v.currentTime; });
    await page.locator('#review-context').selectOption('duel');
    await page.locator('#confirm-event').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-event')).toBeFocused();
    await expect(page.getByTestId('quantified-count')).toHaveText('1 / 20 起步样本');
    await expect(page.locator('#replay')).toHaveJSProperty('playbackRate', 0.5);
    await expect(page.locator('#replay')).toHaveJSProperty('currentTime', position);
    assert.equal(await page.evaluate(() => window.testPlayer === document.querySelector('#replay')), true);
    await page.getByRole('button', { name: '排除此片段' }).click();
    await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
    await page.getByRole('button', { name: '恢复此片段' }).click();
    await expect(page.getByTestId('quantified-count')).toHaveText('0 / 20 起步样本');
    await page.locator('#replay').evaluate(v => v.play());
    await expect.poll(() => page.locator('#replay').evaluate(v => v.currentTime)).toBeGreaterThan(position + 0.3);
    await page.locator('#replay').evaluate(v => v.pause());
    for (const [width, height] of [[1440, 900], [1280, 720], [760, 620]]) {
      await desktop.evaluate(({ BrowserWindow }, size) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (size[0] === 760) window.setSize(...size); // Actual minimum outer desktop window.
        else window.setContentSize(...size);
      }, [width, height]);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 760 && await page.locator('#clips-panel').evaluate(el => el.open)) await page.locator('#clips-panel > summary').click();
      if (width >= 1280) {
        await expect(page.locator('#confirm-event')).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#playback-rate')).toBeInViewport({ ratio: 1 });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, `report-${width}x${height}.png`), fullPage: true, scale: 'css' });
    }
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
    await page.getByRole('button', { name: '工作台', exact: true }).click();
    await expect(page.locator('#recent-preview')).toHaveJSProperty('videoWidth', 1280);
    await page.screenshot({ path: path.join(output, 'workspace-1440x900.png'), fullPage: true, scale: 'css' });
    await page.getByRole('button', { name: '编辑玩家档案' }).click();
    await page.locator('[name="dpi"]').fill('1600');
    await page.getByRole('button', { name: '保存玩家档案' }).click();
    await expect(page.locator('#profile-feedback')).toContainText('已保存');
    const state = await savedState();
    assert.equal(state.profile.dpi, 1600);
    assert.equal(state.report.profile.dpi, 800);
    assert.equal(state.item.profile.dpi, 800);
    const expected = { state, recordingSHA256: await fileDigest(path.join(dataDir, 'recordings', state.id + '.webm')) };
    await writeFile(expectedPath, JSON.stringify(expected, null, 2));
    await close();
    await launch();
    await checkSaved(expected);
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, mode: reopenOnly ? 'retained data after upgrade' : 'UI import / replay / review / restart',
    executable: executablePath || 'development Electron', userData: dataDir, runtime,
    externalNodeOnChildPath: process.platform === 'win32' && executablePath ? false : 'not tested',
    note: 'Synthetic video only; no Windows game capture, Vanguard or performance claim.' };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log('Desktop notice:', await page?.locator('#notice').textContent().catch(() => 'unavailable'));
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await close(); }
