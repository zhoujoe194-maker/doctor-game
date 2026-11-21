const { app, BrowserWindow, desktopCapturer, ipcMain, session, protocol, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('node:fs/promises');
const { createReadStream, existsSync } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Stable across installer upgrades. Package name and storage identifiers stay unchanged.
if (process.platform === 'win32') app.setAppUserModelId('io.github.zhoujoe194maker.doctorgame');

// Reuse an earlier prototype's data without moving or deleting recordings.
// Explicit user-data directories (including isolated tests) always take priority.
if (!app.commandLine.hasSwitch('user-data-dir') && !existsSync(path.join(app.getPath('userData'), 'recordings'))) {
  for (const legacyName of ['Sight', 'sight-sensitivity-lab']) {
    const legacyPath = path.join(app.getPath('appData'), legacyName);
    if (existsSync(path.join(legacyPath, 'recordings'))) { app.setPath('userData', legacyPath); break; }
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'doctorgame-video', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
let win, tray, recordingDir, selectedSource, busy = false, quitting = false;
const active = new Map();
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validId = id => { if (!idPattern.test(id)) throw new Error('Invalid recording ID'); return id; };
const recordingPath = id => path.join(recordingDir, `${validId(id)}.webm`);
const indexPath = id => path.join(recordingDir, `${validId(id)}.json`);
const trusted = event => { if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted request'); };
function handle(name, callback) { ipcMain.handle(name, (event, ...args) => { trusted(event); return callback(...args); }); }
function showWindow() { win.show(); win.focus(); }
function updateTray() {
  tray.setToolTip(busy ? 'doctorgame · 正在记录或分析' : 'doctorgame · 灵敏度实验室');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 doctorgame', click: showWindow },
    { label: '结束记录并分析', enabled: active.size > 0, click: () => { showWindow(); win.webContents.send('capture:stop'); } },
    { type: 'separator' },
    { label: busy ? '正在工作，请先结束记录或分析' : '退出 doctorgame', enabled: !busy, click: () => { quitting = true; app.quit(); } }
  ]));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => win && showWindow());
  app.whenReady().then(async () => {
    recordingDir = path.join(app.getPath('userData'), 'recordings');
    await fs.mkdir(recordingDir, { recursive: true });
    protocol.handle('doctorgame-video', async request => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'capture') return new Response(null, { status: 403 });
        const file = recordingPath(url.pathname.slice(1));
        const { size } = await fs.stat(file);
        const metadata = JSON.parse(await fs.readFile(indexPath(url.pathname.slice(1)), 'utf8'));
        const contentType = metadata.mimeType?.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
        const range = request.headers.get('range');
        if (!range) return new Response(Readable.toWeb(createReadStream(file)), { headers: { 'Content-Type': contentType, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' } });
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
        const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(createReadStream(file, { start, end })), {
          status: 206,
          headers: { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1), 'Access-Control-Allow-Origin': '*' }
        });
      } catch { return new Response(null, { status: 404 }); }
    });
    win = new BrowserWindow({
      width: 1440, height: 960, minWidth: 760, minHeight: 620, backgroundColor: '#f5f6f2', title: 'doctorgame · 灵敏度实验室',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === win.webContents && permission === 'display-capture'));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      const id = selectedSource;
      selectedSource = undefined;
      if (request.frame !== win.webContents.mainFrame || !id) { callback({}); return; }
      try {
        const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 } });
        const source = sources.find(s => s.id === id);
        callback(source ? { video: source } : {});
      } catch { callback({}); }
    });
    handle('capture:sources', async () => (await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 } }))
      .filter(s => !s.name.includes('doctorgame'))
      .map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() })));
    handle('capture:select', id => { if (typeof id !== 'string' || id.length > 200) throw new Error('Invalid source'); selectedSource = id; });
    handle('recording:begin', async metadata => {
      if (active.size) throw new Error('已有录制进行中');
      const id = randomUUID();
      await fs.writeFile(recordingPath(id), new Uint8Array(), { flag: 'wx' });
      const data = { ...metadata, id, createdAt: new Date().toISOString(), status: 'recording', bytes: 0 };
      await fs.writeFile(indexPath(id), JSON.stringify(data));
      active.set(id, data); busy = true; updateTray(); return id;
    });
    handle('recording:append', async (id, bytes) => {
      const item = active.get(validId(id));
      if (!item || !(bytes instanceof ArrayBuffer) || bytes.byteLength > 32 * 1024 * 1024) throw new Error('Invalid recording chunk');
      if (item.bytes + bytes.byteLength > 2 * 1024 ** 3) throw new Error('单次录像已达到 2 GB，请结束后重新开始');
      await fs.appendFile(recordingPath(id), Buffer.from(bytes)); item.bytes += bytes.byteLength;
    });
    handle('recording:finish', async (id, metadata) => {
      const item = active.get(validId(id));
      if (!item) throw new Error('Recording not active');
      // An empty or interrupted capture stays on disk for transparency, but it is
      // never advertised as a ready recording.
      const data = { ...item, ...metadata, id, bytes: item.bytes, status: metadata?.incomplete ? 'incomplete' : 'ready' };
      await fs.writeFile(indexPath(id), JSON.stringify(data)); active.delete(id); updateTray(); return data;
    });
    handle('recording:list', async () => {
      const files = (await fs.readdir(recordingDir)).filter(n => /^[0-9a-f-]+\.json$/.test(n));
      const items = await Promise.all(files.map(n => fs.readFile(path.join(recordingDir, n), 'utf8').then(JSON.parse).catch(() => null)));
      return items.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    handle('recording:folder', () => shell.openPath(recordingDir));
    handle('app:busy', state => { busy = Boolean(state); updateTray(); });
    const pixels = Buffer.alloc(22 * 22 * 4);
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
      const distance = Math.hypot(x - 10.5, y - 10.5);
      if ((distance > 6 && distance < 8) || ((x === 10 || x === 11 || y === 10 || y === 11) && distance > 4)) pixels.set([80, 122, 101, 255], (y * 22 + x) * 4);
    }
    const trayImage = nativeImage.createFromBitmap(pixels, { width: 22, height: 22 });
    if (process.platform === 'darwin') trayImage.setTemplateImage(true);
    tray = new Tray(trayImage);
    tray.on('click', showWindow); updateTray();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'doctorgame', submenu: [{ role: 'about' }, { type: 'separator' }, { label: '退出', click: () => { if (!busy) { quitting = true; app.quit(); } else showWindow(); } }] }, { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] }, { label: '视图', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' }] }]));
    win.on('close', e => { if (busy && !quitting) { e.preventDefault(); win.hide(); } });
    app.on('before-quit', e => { if (busy && !quitting) { e.preventDefault(); showWindow(); } });
    await win.loadFile(path.join(__dirname, '..', 'index.html'));
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
