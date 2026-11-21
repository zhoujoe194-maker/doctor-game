import { DEFAULT_PROFILE, HABIT_LABELS, SCENE_LABELS, validateProfile, recommend, MIN_REVIEWED } from './analysis.js';
import { storage, saveProfile, loadReport, saveReport } from './storage.js';
import { beginCapture, analyzeVideo, inspectVideo, makeDemo } from './media.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
const time = seconds => `${String(Math.floor((seconds || 0) / 60)).padStart(2, '0')}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
const clipTime = seconds => `${time(seconds)}.${String(Math.floor((seconds % 1) * 100)).padStart(2, '0')}`;
const kindLabel = { overshoot: '越过目标', undershoot: '移动不足', settled: '接近目标', preaim: '视角运动观察', observation: '手动标记 · 待量化' };
const sceneGuidance = {
  unknown: '先回看接敌的完整过程，再确认片段属于哪一种场景。',
  kill: '重点看击杀前的首次落点和后续修正。击杀成功本身不说明灵敏度合适。',
  death: '先检查是否有机会瞄准，再观察到位速度与修正。背身、被闪和多人夹击不宜归因于灵敏度。',
  duel: '重点看持续对枪时是否反复越过目标、需要补拉。注意区分压枪、敌人移动和主动撤退。',
  preaim: '重点看搜点过程的方向、减速和衔接。主动换点产生的停顿与转向不应直接判成不平滑。'
};
const outlineLabel = { yellow: '黄色', purple: '紫色', red: '红色' };
function loadInitialProfile() {
  try {
    const raw = localStorage.getItem('sight-profile');
    if (!raw) return { profile: { ...DEFAULT_PROFILE }, confirmed: false };
    // Only a successfully validated stored profile counts as confirmed. A corrupt
    // or out-of-range value falls back to defaults without rewriting the originals.
    return { profile: validateProfile(JSON.parse(raw)), confirmed: true };
  } catch { return { profile: { ...DEFAULT_PROFILE }, confirmed: false }; }
}
// A recording is only usable when its actual bytes are known to be non-zero.
// `actualBytes` comes from the disk file (desktop) or IndexedDB chunks (browser);
// missing/unknown metadata must not be mistaken for a real empty recording.
const activeRecording = item => Boolean(item) && (item.active === true || (state.capture && item.id === state.capture.id));
const usableRecording = item => Boolean(item) && !activeRecording(item) && item.actualBytes !== 0;
// Reading an old report is a boundary operation: a malformed profile or events
// array must degrade the entry, never crash the shell or be rewritten/recomputed.
function inspectReportObject(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.events)) return null;
  try { return { report, result: recommend(report.events, report.profile, { demo: Boolean(report.demo) }) }; }
  catch { return null; }
}
function readReportState(id) {
  const report = loadReport(id);
  if (!report) return { status: 'missing', report: null };
  const inspected = inspectReportObject(report);
  return inspected ? { status: 'valid', ...inspected } : { status: 'invalid', report };
}
const recordingLabel = item => {
  if (activeRecording(item)) return '正在录制';
  if (item.actualBytes === 0) return '无画面';
  const state = readReportState(item.id);
  if (state.status === 'valid') return '查看报告';
  if (state.status === 'invalid') return '报告无法读取';
  return item.status === 'ready' ? '待分析' : '录制中断 · 可恢复';
};
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  play: '<path d="m9 5 11 7-11 7Z"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  chart: '<path d="M4 4v16h16M8 14l4-5 4 2 4-7"/>',
  sliders: '<path d="M4 7h5m4 0h7M4 17h9m4 0h3"/><circle cx="11" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7m-6 1h12"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.target}</svg>`;
const initialProfile = loadInitialProfile();
let profile = initialProfile.profile;
const state = { page: 'workspace', profile, profileConfirmed: initialProfile.confirmed, recordings: [], capture: null, capturePhase: null, captureAbort: null, reselectCapture: false, busy: false, report: null, item: null, mediaUrl: null, eventIndex: 0, filter: 'all', progress: null, abort: null, notice: null, playbackRate: 1, clipEnd: null, homePreviewUrl: null, thumbnailObserver: null, thumbnailQueue: [], thumbnailActive: 0, thumbnailGeneration: 0 };
let elapsedTimer;

function notify(message, error = false) {
  state.notice = { message, error };
  const region = $('#notice');
  if (region) { region.hidden = false; region.className = `notice ${error ? 'error' : ''}`; region.textContent = message; }
  $('#announcement').textContent = message;
}
function releaseMedia() { if (state.mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(state.mediaUrl); state.mediaUrl = null; }
async function setBusy(value) { state.busy = value; await window.doctorgame?.setBusy(value); }
async function refreshRecordings() { state.recordings = await storage.list(); }
function navigate(page) { state.page = page; state.notice = null; render(); $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); }
const navItems = [['workspace', '录制'], ['history', '对局记录'], ['profile', '档案'], ['method', '帮助']];
const primaryNav = navItems.slice(0, 2), utilityNav = navItems.slice(2);

function navButton([page, label], activePage) {
  const active = activePage === page;
  return '<button class="nav-link' + (active ? ' is-active' : '') + '" data-nav="' + page + '"' + (active ? ' aria-current="page"' : '') + '>' + label + '</button>';
}
function topNavigation(activePage) {
  return '<header class="topnav"><a class="brand" href="#workspace" data-nav="workspace" aria-label="doctorgame 首页"><img src="./assets/mark.svg" alt="" width="28" height="28"><span>doctorgame</span></a>' +
    '<nav class="mainnav" aria-label="主导航">' + primaryNav.map(item => navButton(item, activePage)).join('') + '</nav>' +
    '<div class="nav-tools"><span class="local-chip">' + icon('shield') + '本地 · 无音频</span>' + utilityNav.map(item => navButton(item, activePage)).join('') + '</div></header>';
}
function globalRecordStrip() {
  if (state.page === 'workspace') return '';
  if (state.capturePhase === 'requesting' || state.capturePhase === 'waiting') {
    return '<div class="record-strip waiting" role="status"><span class="wait-dot"></span><strong>' + (state.capturePhase === 'requesting' ? '正在打开窗口选择…' : '正在等待窗口画面') + '</strong><span class="record-strip-note">收到画面后才开始录制</span><div class="record-strip-actions">' +
      (state.capturePhase === 'waiting' ? '<button class="button small secondary" id="cancel-capture-banner">取消等待</button><button class="button small secondary" id="reselect-capture-banner">重新选择窗口</button>' : '') + '</div></div>';
  }
  if (state.capture) {
    return '<div class="record-strip" role="status"><span class="record-dot"></span><strong>正在录制</strong><span id="elapsed-global" class="record-strip-time">00:00</span><span class="record-strip-note">关闭窗口后在托盘继续</span><div class="record-strip-actions"><button class="button small danger" id="stop-banner">结束并分析</button></div></div>';
  }
  return '';
}
function noticeMarkup() {
  return '<div id="notice" class="notice ' + (state.notice?.error ? 'error' : '') + '" ' + (state.notice ? '' : 'hidden') + '>' + esc(state.notice?.message) + '</div>';
}
function pageBody() {
  if (state.busy && !state.capture && !state.capturePhase) return progressView();
  if (state.page === 'workspace') return workspaceView();
  if (state.page === 'history') return historyView();
  if (state.page === 'profile') return profileView();
  if (state.page === 'method') return helpView();
  return reportView();
}
function render() {
  $('#replay')?.pause();
  resetThumbnailLoader();
  if (state.homePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.homePreviewUrl);
  state.homePreviewUrl = null;
  const activePage = state.page === 'report' ? 'history' : state.page;
  $('#app').innerHTML = '<div class="app-shell">' + topNavigation(activePage) + globalRecordStrip() +
    '<main id="main" tabindex="-1">' + noticeMarkup() + pageBody() + '</main>' +
    '<footer class="app-footer"><span>doctorgame · 本地优先</span><span>录像与报告仅保存在本机 · ' + (window.doctorgame ? '桌面版' : '浏览器预览') + '</span></footer></div>' +
    '<input id="video-file" type="file" hidden accept="video/mp4,video/webm,video/x-matroska,.webm,.mp4,.mkv" aria-label="导入游戏录像">' +
    '<dialog id="source-dialog" aria-labelledby="source-title"><div class="dialog-head"><div><h2 id="source-title">选择游戏窗口</h2><p class="muted">选择完整的游戏窗口，准星应位于画面中央。</p></div><button id="close-source" class="icon-button" aria-label="关闭窗口选择">×</button></div><div id="source-list"></div></dialog>';
  bind();
  if (state.page === 'report' && state.report && !state.busy) refreshReport({ seek: true });
  if (state.capture && state.page === 'workspace') {
    const preview = $('#live-preview');
    if (preview) { preview.srcObject = state.capture.stream; preview.play().catch(() => {}); tick(); }
  } else if (state.page === 'workspace' && !state.busy) loadRecentPreview();
  if (state.page === 'history' && !state.busy) observeLibraryThumbnails();
}

function workspaceView() {
  const recording = Boolean(state.capture), waiting = state.capturePhase === 'waiting' || state.capturePhase === 'requesting';
  if (waiting) return waitingView();
  if (recording) return captureView();
  const latest = state.recordings.find(usableRecording) || state.recordings[0];
  const returning = Boolean(state.recordings.length);
  return returning ? returningHomeView(latest) : firstUseView();
}

function profileSummaryCard() {
  const p = state.profile;
  const stateClass = state.profileConfirmed ? 'confirmed' : 'unconfirmed';
  const stateText = state.profileConfirmed ? '档案已保存' : '默认值 · 待核对';
  return '<aside class="settings-card" aria-label="当前玩家档案"><div class="card-head"><h2>当前设置</h2><button class="text-button" data-nav="profile">编辑档案</button></div>' +
    '<dl class="setting-list"><div><dt>鼠标 DPI</dt><dd>' + p.dpi + '</dd></div><div><dt>游戏内灵敏度</dt><dd>' + p.sensitivity.toFixed(3) + '</dd></div><div><dt>瞄准习惯</dt><dd>' + HABIT_LABELS.aimStyle[p.aimStyle] + ' / ' + HABIT_LABELS.grip[p.grip] + '</dd></div></dl>' +
    '<span class="profile-state ' + stateClass + '">' + stateText + '</span>' +
    (state.profileConfirmed ? '' : '<p class="profile-verify" role="note">' + icon('info') + '开始录制前请核对 DPI 和游戏内灵敏度；当前显示的是默认值。</p>') +
    '<p class="card-note">旧报告仍显示录制当时的档案。</p></aside>';
}

function firstUseView() {
  return '<section class="page-head first-head"><div><h1>录制与复盘</h1><p>选择一段对局，回看你的瞄准过程。</p></div></section>' +
    '<div class="home-grid home-first"><section class="capture-surface" aria-label="开始录制"><div class="capture-copy"><h2>录制一局</h2><p>选择一个完整的游戏窗口。结束后分析候选片段；画面和报告只保存在本机。</p></div>' +
    '<div class="primary-actions"><button class="button primary large" id="start-recording">' + icon('record') + '开始录制</button><button class="button secondary large" id="import-video">' + icon('upload') + '导入录像</button></div>' +
    '<div class="surface-foot"><button class="text-button" id="load-demo">没有录像？先看合成示例 ' + icon('arrow') + '</button><span>不录制音频 · 支持 MP4 / WebM · 单文件最多 2 GB</span></div></section>' +
    profileSummaryCard() + '</div>';
}

function nextSessionCard() {
  return '<section class="next-session" aria-label="录制新对局"><div><h2>录下一局</h2><p>手动选择窗口，结束后分析。录像和档案只保存在本机。</p></div>' +
    '<div class="next-actions"><button class="button secondary" id="start-recording">' + icon('record') + '开始录制</button><button class="button secondary" id="import-video">' + icon('upload') + '导入录像</button></div></section>';
}

function returningHomeView(item) {
  const usable = usableRecording(item);
  if (!usable) {
    return '<section class="home-grid home-first"><section class="recent-session no-footage session-surface" aria-label="最近一局"><div class="no-footage-panel"><span class="no-footage-label">上一段录像</span><h1>没有收到可回放画面</h1><p>磁盘上的录像文件为空（0 字节）。原文件与元数据仍保留在本机，可以重新选择窗口或导入另一段录像。</p><div class="recent-actions"><button class="button primary" id="retry-capture">' + icon('record') + '重新选择窗口</button><button class="button secondary" data-import-video>' + icon('upload') + '导入录像</button></div></div></section>' + profileSummaryCard() + '</section>';
  }
  const reportState = readReportState(item.id);
  const report = reportState.status === 'valid' ? reportState.report : null;
  const result = reportState.status === 'valid' ? reportState.result : null;
  const pending = report ? report.events.filter(e => e.included && !e.reviewed).length : 0;
  const progress = report
    ? '<p class="session-progress">已确认且可量化 <strong>' + result.reviewed + '</strong> / ' + MIN_REVIEWED + ' 起步样本 · 待确认 <strong>' + pending + '</strong> 个片段</p>'
    : reportState.status === 'invalid'
      ? '<p class="session-progress session-problem" role="note">这份报告无法读取：存档数据不完整。录像仍保留；可以继续录制、导入，或从对局记录打开其他报告。</p>'
      : '<p class="session-progress">' + (item.status === 'ready' ? '录像已保存，尚未分析。' : '录制中断，已写入的画面仍保留，可尝试恢复分析。') + '</p>';
  return '<div class="home-grid home-return"><section class="recent-session session-surface" aria-label="最近一局"><div class="session-media"><video id="recent-preview" muted playsinline preload="metadata" aria-label="上一局画面预览"></video><span class="media-time">' + time(item.duration) + '</span></div>' +
    '<div class="session-info"><div class="session-meta"><span>上次录制</span><time>' + new Date(item.createdAt).toLocaleString('zh-CN') + '</time></div><h1>继续上一局</h1><h2 class="session-title">' + esc(item.title || '游戏录像') + '</h2>' +
    progress +
    '<div class="session-actions"><button class="button ' + (reportState.status === 'invalid' ? 'secondary' : 'primary') + '" data-recording="' + esc(item.id) + '">' + icon('play') + (report ? '继续复盘' : reportState.status === 'invalid' ? '打开记录' : '打开并分析') + '</button><button class="text-button" data-nav="history">全部记录 ' + icon('arrow') + '</button></div></div></section>' +
    '<aside class="home-side">' + profileSummaryCard() + nextSessionCard() + '</aside></div>';
}

function waitingView() {
  const requesting = state.capturePhase === 'requesting';
  return '<section class="studio is-waiting" aria-label="等待窗口画面"><div class="waiting-panel"><span class="wait-dot"></span><h1>' + (requesting ? '正在打开窗口选择…' : '正在等待窗口画面…') + '</h1><p>' + (requesting ? '在系统窗口列表中选一个正在显示游戏画面的窗口。' : '已选择窗口。收到第一帧画面后才开始录制；没有画面不会保存空录像。') + '</p>' +
    (requesting ? '' : '<div class="waiting-actions"><button class="button secondary" id="cancel-capture">取消等待</button><button class="button secondary" id="reselect-capture">重新选择窗口</button></div>') + '</div></section>';
}

function captureView() {
  return '<section class="studio" aria-label="录制状态"><div class="studio-head"><div><h1><span class="record-dot"></span>正在录制 <span id="elapsed">00:00</span></h1><p>已收到窗口画面。可以返回游戏；关闭窗口后仍在托盘录制。</p></div><button class="button danger" id="stop-recording">' + icon('stop') + '结束并分析</button></div><div class="capture-stage"><video id="live-preview" autoplay muted playsinline aria-label="正在录制的画面预览"></video></div><div class="studio-foot"><span>不录制音频</span><span>录像保存在本机</span></div></section>';
}

async function loadRecentPreview() {
  const video = $('#recent-preview'), item = state.recordings.find(usableRecording);
  if (!video || !item) return;
  try {
    const url = await storage.url(item);
    if (!video.isConnected) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    state.homePreviewUrl = url; video.src = url;
    video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(1, item.duration / 2 || 0); }, { once: true });
  } catch { /* The recording entry remains available even if its preview cannot load. */ }
}

function dayKey(date) {
  const d = new Date(date); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayLabel(date) {
  const d = new Date(date), now = new Date(), today = dayKey(now), yesterday = new Date(now.getTime() - 86400000);
  if (dayKey(d) === today) return '今天';
  if (dayKey(d) === dayKey(yesterday)) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}
function groupRecordings(items) {
  const groups = new Map();
  for (const item of items) {
    const key = dayKey(item.createdAt);
    if (!groups.has(key)) groups.set(key, { label: dayLabel(item.createdAt), items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
function libraryCard(item) {
  const usable = usableRecording(item);
  const reportState = usable ? readReportState(item.id) : { status: 'missing' };
  const stateClass = !usable ? 'is-muted' : reportState.status === 'invalid' ? 'is-warn' : reportState.status === 'valid' ? '' : item.status === 'ready' ? 'is-pending' : 'is-warn';
  return '<button class="library-card" data-recording="' + esc(item.id) + '" data-thumb-card="' + esc(item.id) + '">' +
    '<span class="library-thumb"><span class="thumb-fallback">' + icon('play') + '<span>' + (usable ? '加载预览…' : '无画面') + '</span></span><img alt="" hidden><span class="library-duration">' + time(item.duration) + '</span></span>' +
    '<span class="library-copy"><strong>' + esc(item.title || '游戏录像') + '</strong><span class="library-meta">' + (item.profile?.dpi ?? '—') + ' DPI · ' + (item.profile?.sensitivity ?? '—') + ' 灵敏度</span><span class="library-state ' + stateClass + '">' + recordingLabel(item) + '</span></span></button>';
}
function historyView() {
  const locked = state.capture || state.capturePhase;
  const groups = groupRecordings(state.recordings);
  return '<section class="library-page"><header class="page-head"><div><h1>对局记录</h1><p>' + (state.recordings.length ? state.recordings.length + ' 段录像 · 按日期浏览，仅保存在本机' : '已保存的录像与复盘进度，仅保存在本机') + '</p></div><div class="page-actions"><button class="button primary" id="start-recording" ' + (locked ? 'disabled' : '') + '>' + icon('record') + '开始录制</button><button class="button secondary" id="import-video" ' + (locked ? 'disabled' : '') + '>' + icon('upload') + '导入录像</button>' + (window.doctorgame ? '<button class="text-button" id="open-folder">打开录像文件夹</button>' : '') + '</div></header>' +
    (state.recordings.length ? '<div class="library-groups">' + groups.map(group => '<section class="library-day" aria-label="' + group.label + '"><h2>' + group.label + '<span>' + group.items.length + ' 段</span></h2><div class="library-grid">' + group.items.map(libraryCard).join('') + '</div></section>').join('') + '</div>' :
      '<div class="library-empty"><div class="empty-copy"><h2>还没有对局记录</h2><p>使用上方的「开始录制」或「导入录像」添加第一局。录像和报告只保存在本机。</p></div></div>') +
    '<div class="library-foot"><button class="text-button" id="load-demo" ' + (locked ? 'disabled' : '') + '>体验合成示例 ' + icon('arrow') + '</button>' + (window.doctorgame ? '' : '<span class="muted">浏览器版录像随网站数据清理而消失。</span>') + '</div></section>';
}

function resetThumbnailLoader() {
  state.thumbnailGeneration++;
  if (state.thumbnailObserver) { state.thumbnailObserver.disconnect(); state.thumbnailObserver = null; }
  state.thumbnailQueue = []; state.thumbnailActive = 0;
}
function observeLibraryThumbnails() {
  const cards = [...document.querySelectorAll('[data-thumb-card]')];
  if (!cards.length) return;
  if (!('IntersectionObserver' in window)) { cards.slice(0, 6).forEach(enqueueLibraryThumbnail); return; }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { observer.unobserve(entry.target); enqueueLibraryThumbnail(entry.target); }
  }, { rootMargin: '220px 0px' });
  state.thumbnailObserver = observer;
  cards.forEach(card => observer.observe(card));
}
function enqueueLibraryThumbnail(card) {
  if (!card?.isConnected) return;
  state.thumbnailQueue.push(card); processThumbnailQueue();
}
function processThumbnailQueue() {
  const generation = state.thumbnailGeneration;
  while (state.thumbnailActive < 2 && state.thumbnailQueue.length) {
    const card = state.thumbnailQueue.shift(); state.thumbnailActive++;
    loadLibraryThumbnail(card).finally(() => {
      if (generation !== state.thumbnailGeneration) return;
      state.thumbnailActive--; processThumbnailQueue();
    });
  }
}
function waitForMediaEvent(media, event, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('thumbnail timeout')); }, timeout);
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('thumbnail failed')); };
    const cleanup = () => { clearTimeout(timer); media.removeEventListener(event, done); media.removeEventListener('error', failed); };
    media.addEventListener(event, done, { once: true }); media.addEventListener('error', failed, { once: true });
  });
}
async function loadLibraryThumbnail(card) {
  if (!card?.isConnected) return;
  const item = state.recordings.find(recording => recording.id === card.dataset.thumbCard);
  const image = card.querySelector('img'), fallback = card.querySelector('.thumb-fallback');
  if (!item || !usableRecording(item) || !image) { if (fallback) fallback.lastElementChild.textContent = '无画面'; return; }
  let video, url;
  try {
    url = await storage.url(item);
    video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.src = url;
    await waitForMediaEvent(video, 'loadedmetadata');
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : item.duration || 0;
    video.currentTime = Math.min(1, duration / 2 || 1);
    await waitForMediaEvent(video, 'seeked');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    canvas.getContext('2d').drawImage(video, 0, 0, 320, 180);
    image.src = canvas.toDataURL('image/jpeg', 0.72); image.hidden = false;
    if (fallback) fallback.hidden = true;
  } catch {
    if (fallback) fallback.lastElementChild.textContent = '无法预览';
  } finally {
    if (video) { video.removeAttribute('src'); video.load(); }
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

function choiceGroup(name, legend, options, hint) {
  return `<fieldset class="choice-group"><legend>${legend}</legend><div class="choices">${options.map(([value, label, detail]) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${state.profile[name] === value ? 'checked' : ''}><span><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ''}</span></label>`).join('')}</div>${hint ? `<p class="field-hint">${hint}</p>` : ''}</fieldset>`;
}
function profileView() {
  const p = state.profile, locked = state.capture || state.capturePhase;
  return '<section class="settings-page"><header class="page-head"><div><h1>玩家档案</h1><p>当前设置只影响之后的新录像；旧报告保留录制当时的档案。</p></div><span class="profile-state ' + (state.profileConfirmed ? 'confirmed' : 'unconfirmed') + '">' + (state.profileConfirmed ? '档案已保存' : '默认值 · 待核对') + '</span></header>' +
    (state.profileConfirmed ? '' : '<p class="profile-verify profile-verify-page" role="note">' + icon('info') + '当前显示的是默认值 800 / 0.35。请按游戏内实际设置核对后保存；保存后可直接返回录制。</p>') +
    '<form id="profile-form" class="profile-form"><div class="settings-grid">' +
    '<section class="settings-group"><div class="group-head"><h2>游戏与鼠标</h2><p>按游戏内实际使用的数值填写。</p></div><div class="fields"><label>鼠标 DPI<input name="dpi" type="number" min="100" max="64000" step="1" value="' + p.dpi + '" required><small>在鼠标驱动中查看</small></label><label>游戏内灵敏度<input name="sensitivity" type="number" min="0.001" max="10" step="any" value="' + p.sensitivity + '" required><small>基础灵敏度，暂不包含开镜倍率</small></label><label>敌人高亮颜色<select name="outline">' + Object.entries(outlineLabel).map(([key, label]) => '<option value="' + key + '" ' + (p.outline === key ? 'selected' : '') + '>' + label + '</option>').join('') + '</select><small>与游戏内设置保持一致</small></label></div></section>' +
    '<section class="settings-group"><div class="group-head"><h2>瞄准方式</h2><p>按大多数时候的动作选择。</p></div>' + choiceGroup('aimStyle', '主要通过哪里移动鼠标？', [['arm', '手臂为主', '前臂带动大部分移动'], ['wrist', '手腕为主', '手腕转动完成大部分移动'], ['mixed', '混合使用', '手臂转向，手腕或手指微调'], ['unknown', '暂不确定', '可以之后再补充']]) + '</section>' +
    '<section class="settings-group"><div class="group-head"><h2>握姿</h2><p>用于保持复测时的比较条件。</p></div>' + choiceGroup('grip', '平时怎样握住鼠标？', [['palm', '趴握', '手掌大面积贴住鼠背'], ['claw', '抓握', '掌根接触，手指拱起'], ['fingertip', '指握', '主要由指尖接触鼠标'], ['unknown', '暂不确定', '也可能介于两种握法之间']], '这些信息由你填写；游戏画面无法直接判断握姿。') + '</section>' +
    '<section class="settings-group"><div class="group-head"><h2>空间与控制感</h2><p>记录实际可用的空间，比鼠标垫标称尺寸更有用。</p></div><label class="space-field">鼠标左右可移动的总宽度 <span class="muted">（选填，cm）</span><input name="mouseSpace" type="number" min="5" max="150" step="any" placeholder="例如 35" value="' + (p.mouseSpace ?? '') + '"></label>' + choiceGroup('comfort', '目前哪种描述最接近你的体验？', [['comfortable', '移动舒适', '大幅转向也有余量'], ['limited', '经常拉到边缘', '转身时需要抬鼠重置'], ['tense', '容易用力过紧', '微调时控制感不稳定'], ['unknown', '暂不确定', '先记录，再观察']]) + '</section>' +
    '</div><div class="save-bar"><span id="profile-feedback" role="status">保存后用于下一次观察；旧报告保留当时的档案。</span><div class="form-save-actions"><button class="button secondary" type="submit" ' + (locked ? 'disabled' : '') + '>' + icon('check') + '保存玩家档案</button><button class="button primary" type="submit" id="save-profile-return" ' + (locked ? 'disabled' : '') + '>保存并返回录制</button></div></div></form></section>';
}

function progressView() {
  const p = state.progress;
  return '<section class="progress-page"><span class="progress-symbol">' + icon('target') + '</span><h1>' + (p?.label || '正在整理瞄准片段') + '</h1><p>全程在本机处理。完整对局可能需要较长时间。</p><progress max="1" value="' + (p?.fraction || 0) + '" aria-label="分析进度"></progress><div class="progress-meta"><span>' + Math.round((p?.fraction || 0) * 100) + '%</span><span>' + (p?.processed ? '已检查 ' + p.processed.toLocaleString() + ' 帧 · ' + (p.candidates || 0) + ' 个候选片段' : '正在准备录像…') + '</span></div>' + (state.abort ? '<button class="button secondary" id="cancel-analysis">取消分析，保留录像</button>' : '<span class="muted">正在保存，请稍候。</span>') + '<p class="progress-note">' + icon('shield') + '分析结果只在赛后展示；录像不会上传。</p></section>';
}

function reportView() {
  const r = state.report;
  if (!r) return '<div class="large-empty">请先从对局记录中打开一份报告。</div>';
  if (!inspectReportObject(r)) return '<div class="large-empty">这份报告的数据不完整，无法显示。录像仍保留；可以继续录制、导入，或从对局记录打开其他报告。<div class="empty-actions"><button class="button secondary" data-nav="history">返回对局记录</button></div></div>';
  return '<section class="report-page"><header class="page-head report-head"><div><h1>' + (r.demo ? '复盘示例' : '赛后复盘') + '</h1><p class="report-meta">' + (r.demo ? '<span class="demo-pill">合成示例 · 非真实对局</span> 程序生成的轨迹，只用于体验回放。' : esc(state.item?.title || '游戏录像') + ' · ' + time(r.duration) + ' · ' + r.profile.dpi + ' DPI · ' + r.profile.sensitivity + ' 灵敏度') + '</p></div><button class="button secondary" id="export-report">' + icon('download') + '导出报告</button></header>' +
    '<div class="report-layout"><section class="video-workspace" aria-label="录像与片段操作"><div id="evidence-stage" class="evidence-stage"></div><div class="timeline-panel"><div id="clip-timeline"></div><div class="seek-row"><label class="sr-only" for="replay-seek">录像播放位置</label><input id="replay-seek" type="range" min="0" max="' + r.duration + '" step="0.05" value="0" ' + (r.demo ? 'disabled' : '') + '><output id="replay-time">00:00 / ' + time(r.duration) + '</output></div></div><div id="playback-controls" class="playback-controls"></div></section>' +
    '<aside class="review-panel" aria-label="片段选择与确认"><div id="review-summary" class="review-summary" aria-label="复盘概览"></div><details id="clips-panel" class="clips-panel" ' + (innerWidth >= 1100 ? 'open' : '') + '><summary>片段 <span id="clip-total" class="count-badge">' + r.events.length + '</span><span class="collapse-hint">展开 / 收起</span></summary><label class="filter-label" for="event-filter">筛选<select id="event-filter"><option value="all">全部片段</option><option value="pending">待确认</option><option value="reviewed">已确认</option><option value="excluded">已排除</option>' + Object.entries(SCENE_LABELS).filter(([key]) => key !== 'unknown').map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('') + '</select></label><div id="events-list" class="events-list"></div></details><div id="evidence-controls" class="evidence-controls"></div></aside></div>' +
    '<div class="report-details"><details class="analysis-details"><summary>轨迹与判断依据</summary><div class="error-chart"><div><strong id="chart-title">目标相对准星的位置</strong><span id="chart-unit">沿初始瞄准方向 · 屏幕宽度 %</span></div><svg id="error-plot" viewBox="0 0 640 130" role="img" aria-label="当前片段的位置曲线"></svg><p id="chart-description"></p></div></details><details class="advice-details" id="advice-details"><summary>建议依据与下一次复测</summary><div id="recommendation-detail"></div></details></div></section>';
}

function reportSummary() {
  const r = state.report, result = recommend(r.events, r.profile, { demo: r.demo });
  const adviceOpen = Boolean($('#advice-details')?.open);
  const pending = r.events.filter(e => e.included && !e.reviewed).length;
  return '<div class="metric-row"><div class="metric"><span>已确认且可量化</span><strong data-testid="quantified-count">' + (r.demo ? 0 : result.reviewed) + '<small> / ' + MIN_REVIEWED + ' 起步样本</small></strong></div><div class="metric"><span>待确认</span><strong>' + pending + '</strong></div></div>' +
    '<div class="recommendation"><div class="recommend-top"><span>本次建议</span><strong>' + (result.status === 'experiment' ? '试用 ' : '保持当前值 ') + result.candidate + (result.change ? '<small>' + (result.change > 0 ? '+3%' : '−3%') + '</small>' : '') + '</strong></div><p class="recommend-reason" data-testid="recommend-reason">' + esc(result.reason) + '</p><button class="text-button advice-toggle" id="advice-toggle" type="button" aria-expanded="' + adviceOpen + '" aria-controls="advice-details">查看依据与复测 ' + icon('arrow') + '</button></div>';
}

function filteredEvents() {
  return state.report.events.map((e, index) => ({ ...e, index })).filter(e => state.filter === 'all' || (state.filter === 'pending' && !e.reviewed && e.included) || (state.filter === 'reviewed' && e.reviewed && e.included) || (state.filter === 'excluded' && !e.included) || e.context === state.filter);
}

function eventRows() {
  const events = filteredEvents();
  return events.length ? events.map(e => '<button class="event-row ' + (state.eventIndex === e.index ? 'selected' : '') + '" data-event="' + e.index + '" aria-pressed="' + (state.eventIndex === e.index) + '">' +
    '<span class="event-main"><strong>' + clipTime(e.start) + '</strong><span class="review-state">' + (!e.included ? '已排除' : e.reviewed ? '已确认' : '待确认') + '</span></span>' +
    '<span class="scene-label">' + SCENE_LABELS[e.context || 'unknown'] + '</span><span class="kind-label ' + e.kind + '">' + kindLabel[e.kind] + '</span></button>').join('') :
    '<div class="list-empty">' + (state.report.events.length ? '没有符合筛选条件的片段。' : '没有找到清晰的候选片段。播放完整录像，确认后可手动标记；录像已保留。') + '</div>';
}

function renderTimeline() {
  const r = state.report, duration = Math.max(r.duration, 0.01);
  $('#clip-timeline').innerHTML = '<svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-label="片段在整局录像中的位置" role="group"><path d="M0 16H1000" class="timeline-track"/>' +
    r.events.map((e, index) => {
      const x = Math.max(0, Math.min(984, e.start / duration * 1000)), width = Math.max(16, Math.min(1000 - x, (e.end - e.start) / duration * 1000));
      return '<g tabindex="0" role="button" class="timeline-marker ' + (index === state.eventIndex ? 'selected ' : '') + (!e.included ? 'excluded' : e.reviewed ? 'confirmed' : '') + '" data-clip="' + index + '" aria-label="跳到 ' + clipTime(e.start) + '，' + SCENE_LABELS[e.context || 'unknown'] + '" aria-pressed="' + (index === state.eventIndex) + '"><rect x="' + x + '" y="5" width="' + width + '" height="22" rx="3"/></g>';
    }).join('') + '<line id="timeline-playhead" x1="0" x2="0" y1="0" y2="32"/></svg>';
}

function refreshReport({ seek = false, focus = null } = {}) {
  if (seek) state.clipEnd = null;
  const r = state.report, result = recommend(r.events, r.profile, { demo: r.demo });
  $('#review-summary').innerHTML = reportSummary();
  $('#advice-toggle')?.addEventListener('click', () => {
    const details = $('#advice-details'); if (!details) return;
    details.open = !details.open;
    $('#advice-toggle').setAttribute('aria-expanded', String(details.open));
    if (details.open) details.scrollIntoView({ block: 'nearest' });
  });
  const adviceDetails = $('#advice-details');
  if (adviceDetails) adviceDetails.ontoggle = () => $('#advice-toggle')?.setAttribute('aria-expanded', String(adviceDetails.open));
  $('#clip-total').textContent = r.events.length;
  $('#events-list').innerHTML = eventRows();
  $('#event-filter').value = state.filter;
  $('#recommendation-detail').innerHTML = '<h2>结合本局档案</h2><ul>' + result.habits.notes.map(n => '<li>' + n + '</li>').join('') +
    '</ul><h2>下一次怎样验证</h2><p>保持 DPI、握姿和设备不变。' + (result.change ? '将 ' + result.current + ' 与 ' + result.candidate + ' 交替复测，先留出适应时间。' : '先确认更多可比较的片段，再决定是否试用。') + '</p><ul>' + result.habits.tasks.map(t => '<li>' + t + '</li>').join('') +
    '</ul><p>目前是实验建议，不是已验证的最佳灵敏度。</p>';
  renderTimeline();
  renderEvidence({ seek });
  document.querySelectorAll('[data-event], [data-clip]').forEach(button => {
    const select = () => {
      state.eventIndex = Number(button.dataset.event ?? button.dataset.clip);
      state.clipEnd = null;
      refreshReport({ seek: true, focus: button.hasAttribute('data-event') ? '[data-event="' + state.eventIndex + '"]' : '[data-clip="' + state.eventIndex + '"]' });
    };
    button.onclick = select;
    if (button.hasAttribute('data-clip')) button.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(); } };
  });
  $('#replay-seek').oninput = event => { const player = $('#replay'); if (player) { state.clipEnd = null; player.currentTime = Number(event.target.value); syncPlayback(); } };
  if (focus) $(focus)?.focus({ preventScroll: true });
}

function syncPlayback() {
  const current = $('#replay')?.currentTime || 0, duration = state.report?.duration || 1;
  const seek = $('#replay-seek');
  if (seek) { seek.value = current; seek.setAttribute('aria-valuetext', time(current) + '，总时长 ' + time(duration)); }
  if ($('#replay-time')) $('#replay-time').textContent = time(current) + ' / ' + time(duration);
  const line = $('#timeline-playhead'), x = Math.min(1000, current / duration * 1000);
  if (line) { line.setAttribute('x1', x); line.setAttribute('x2', x); }
}

function helpView() {
  return '<section class="help-page"><header class="page-head"><div><h1>使用帮助</h1><p>录制、复盘、本地存储和当前版本的实际限制。</p></div></header><div class="help-grid">' +
    '<section class="help-block"><h2>录像在哪里，怎样停止？</h2><p>桌面版录像和报告只保存在本机用户数据目录；关闭窗口后仍可从托盘结束录制。浏览器预览版保存在当前浏览器，清理网站数据会移除。</p><p>开始录制需要手动选择一个正在显示游戏画面的完整窗口，必须在游戏结束后点击“结束并分析”。</p></section>' +
    '<section class="help-block"><h2>没有收到窗口画面怎么办？</h2><p>等待阶段可以取消或重新选择窗口；8 秒没有收到可解码画面就不会开始录制，也不会保存空录像。请确认窗口正在显示动态画面，并检查系统录屏权限。</p><p>如果录像实际为空，记录页会显示“无画面”并拒绝分析；原文件和元数据仍保留在本机。</p></section>' +
    '<section class="help-block"><h2>为什么片段还要手动确认？</h2><p>颜色轮廓和背景位移只是候选线索，不是训练好的敌人识别。技能特效、后坐力、观战、敌人移动和错误轮廓都可能误检，所以需要回放确认场景与意图。</p><p>合成示例、手动标记、预瞄、未知场景和已排除片段都不会成为量化样本。</p></section>' +
    '<section class="help-block"><h2>建议值怎么来的？</h2><p>至少 ' + MIN_REVIEWED + ' 个已确认且未排除的击杀/被击杀/对枪片段，并且同一调整方向占比达到 65%、Wilson 下界大于 50%，才提出 ±3% 的试验值；否则保持当前值。</p><p>这些阈值是原型的工程规则，不是已验证的最佳灵敏度或成功概率。片段之间也不一定相互独立。</p></section>' +
    '<section class="help-block"><h2>没有候选片段怎么办？</h2><p>可以播放完整录像，在想到的位置手动标记击杀、被击杀、对枪或预瞄事件。手动标记只用于复盘，不进入灵敏度建议的有效样本；也可以导入另一段录像。</p><p>取消分析不会删除录像，可在对局记录中重新打开。</p></section>' +
    '<section class="help-block"><h2>当前版本的限制</h2><p>尚未验证 Windows 游戏窗口/全屏捕获、Vanguard、长时间录制和游戏帧率影响，也未获得 Riot 审核。自动击杀/死亡识别尚未实现，灵敏度建议仍需玩家用实际复测确认。</p></section>' +
    '</div></section>';
}

function renderEvidence({ seek = false } = {}) {
  const r = state.report, e = r.events[state.eventIndex], stage = $('#evidence-stage'), controls = $('#evidence-controls');
  if (r.demo) {
    stage.innerHTML = '<div class="demo-label">合成示例 · 非游戏画面</div><svg viewBox="0 0 640 360" aria-label="合成的目标轨迹示意图" role="img"><path class="demo-crosshair" d="M305 180h30M320 165v30" stroke-width="2"/>' +
      (e ? '<polyline class="demo-trace" points="' + e.points.map(p => p.x * 640 + ',' + p.y * 360).join(' ') + '" stroke-width="2"/>' + e.points.map((p, i) => '<circle class="demo-point" cx="' + p.x * 640 + '" cy="' + p.y * 360 + '" r="' + (i ? 3 : 6) + '"/>').join('') : '') + '</svg>';
  } else if (state.mediaUrl) {
    if (!$('#replay')) {
      stage.innerHTML = '<video id="replay" controls muted playsinline preload="auto" aria-label="游戏录像回放"></video>';
      const player = $('#replay'); player.src = state.mediaUrl;
      player.onerror = () => notify('录像无法播放，请从对局记录重试，或导入 MP4（H.264）/ WebM。', true);
    }
    const player = $('#replay');
    player.playbackRate = state.playbackRate;
    const position = () => { if (seek && e) { player.pause(); player.currentTime = Math.min(r.duration, Math.max(0, e.start)); } syncPlayback(); };
    if (player.readyState >= 1) position(); else player.onloadedmetadata = position;
  } else stage.innerHTML = '<p>录像未加载。请从对局记录重新打开。</p>';

  controls.innerHTML = e ? '<div class="evidence-caption"><strong>' + clipTime(e.start) + ' — ' + clipTime(e.end) + '</strong><span class="kind-label ' + e.kind + '">' + kindLabel[e.kind] + '</span></div><div class="review-controls"><label>场景<select id="review-context">' +
    Object.entries(SCENE_LABELS).map(([value, label]) => '<option value="' + value + '" ' + (value === (e.context || 'unknown') ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
    '<label>瞄准分类<select id="review-kind" ' + (e.motion || e.kind === 'observation' ? 'disabled' : '') + '>' + Object.entries(kindLabel).map(([value, label]) => '<option value="' + value + '" ' + (e.kind === value ? 'selected' : '') + '>' + label + '</option>').join('') + '</select></label>' +
    '<button class="button secondary" id="exclude-event">' + (e.included ? '排除此片段' : '恢复此片段') + '</button><button class="button primary" id="confirm-event" ' + (!e.included ? 'disabled' : '') + '>' + icon('check') + (e.reviewed ? '已确认 · 更新' : '确认有效') + '</button></div><p class="review-hint" id="scene-guidance-text">' + sceneGuidance[e.context || 'unknown'] + '</p>' :
    '<div class="zero-recovery"><p><strong>没有候选片段。</strong>录像已保留。播放完整录像，确认位置后手动标记关键事件，或导入另一段录像。</p><div class="zero-actions"><button class="button primary" id="zero-mark">' + icon('target') + '标记关键事件</button><button class="button secondary" data-import-video>' + icon('upload') + '导入另一段录像</button><button class="text-button" data-nav="history">返回对局记录 ' + icon('arrow') + '</button></div></div>';
  attachReplayTools(e);
  $('#zero-mark')?.addEventListener('click', () => {
    const form = $('#marker-form');
    form?.scrollIntoView({ block: 'center' });
    form?.querySelector('select')?.focus({ preventScroll: true });
  });
  const plot = $('#error-plot');
  $('#chart-title').textContent = e?.motion ? '背景位移估计 · 水平方向' : e?.kind === 'observation' ? '该片段尚无量化轨迹' : '目标相对准星的位置';
  $('#chart-unit').textContent = e?.motion ? '屏幕宽度 % · 视角运动的近似' : e?.kind === 'observation' ? '玩家手动标记' : '沿初始瞄准方向 · 屏幕宽度 %';
  $('#chart-description').textContent = e?.motion ? '观察到 ' + e.motion.reversals + ' 次方向反转。角色移动与后坐力也会影响画面；这不是手部平滑度，也不直接用于调整灵敏度。' :
    e?.kind === 'observation' ? '没有可靠的轨迹测量，手动片段不计入灵敏度建议的有效样本。' : '越过零线只是候选线索。确认时请排除压枪、观战、切换目标、明显敌人移动与错误轮廓。';
  const errors = e?.error || [], max = Math.max(5, ...errors.map(Math.abs));
  plot.innerHTML = errors.length ? '<line class="plot-axis" x1="34" y1="66" x2="625" y2="66" stroke-dasharray="3 5"/><text class="plot-label" x="4" y="70">0</text><polyline class="plot-trace" points="' + errors.map((v, i) => (34 + i / Math.max(1, errors.length - 1) * 590) + ',' + (66 - v / max * 49)).join(' ') + '"/>' : '';
  if (!e) return;
  $('#review-context').onchange = event => { $('#scene-guidance-text').textContent = sceneGuidance[event.target.value]; };
  $('#confirm-event').onclick = () => {
    const context = $('#review-context').value;
    if (context === 'unknown') { notify('请先确认这是击杀、被击杀、对枪未击杀还是预瞄场景。', true); $('#review-context').focus(); return; }
    e.kind = e.kind === 'observation' ? 'observation' : e.motion ? 'preaim' : $('#review-kind').value; e.context = context; e.reviewed = true;
    const saved = persistReport(); refreshReport({ focus: '#confirm-event' });
    if (saved) notify(r.demo ? '示例片段已确认，不计入真实量化样本。' : '片段已确认，报告已保存。');
  };
  $('#exclude-event').onclick = () => {
    e.included = !e.included; e.reviewed = false;
    const saved = persistReport(); refreshReport({ focus: '#exclude-event' });
    if (saved) notify(e.included ? '片段已恢复，请重新确认。' : '已排除此片段，可随时恢复。');
  };
}

function attachReplayTools(event) {
  const player = $('#replay'), controls = $('#playback-controls');
  controls.innerHTML = '';
  if (!player) return;
  controls.insertAdjacentHTML('afterbegin', '<div class="playback-tools"><button class="button small secondary" id="replay-context">' + icon('play') + (event ? '回放前后过程' : '播放完整录像') + '</button><label>速度<select id="playback-rate">' +
    [[1, '1× 正常'], [0.5, '0.5× 慢放'], [0.25, '0.25× 慢放']].map(([value, label]) => '<option value="' + value + '" ' + (state.playbackRate === value ? 'selected' : '') + '>' + label + '</option>').join('') +
    '</select></label><button class="text-button" id="next-clip" ' + (!event || state.eventIndex === state.report.events.length - 1 ? 'disabled' : '') + '>下一片段 ' + icon('arrow') + '</button></div>');
  $('#replay-context').onclick = async () => {
    player.currentTime = event ? Math.max(0, event.start - (event.source === 'manual' ? 0 : 2.5)) : 0;
    state.clipEnd = event ? Math.min(state.report.duration, event.end + (event.source === 'manual' ? 0 : 1)) : null;
    try { await player.play(); } catch (error) { notify('播放失败：' + error.message, true); }
  };
  player.ontimeupdate = () => { if (state.clipEnd !== null && player.currentTime >= state.clipEnd) { player.pause(); state.clipEnd = null; } syncPlayback(); };
  player.onseeked = syncPlayback;
  $('#playback-rate').onchange = event => { state.playbackRate = Number(event.target.value); player.playbackRate = state.playbackRate; };
  $('#next-clip').onclick = () => { state.eventIndex++; state.clipEnd = null; refreshReport({ seek: true, focus: '#replay-context' }); };
  // With zero candidates the manual marker is the recovery path, so it is shown
  // open instead of hiding behind a disclosure the player must find first.
  const markerOpen = state.report.events.length === 0;
  const markerBody = '<h2 class="manual-marker-title">补充漏掉的关键事件</h2><p>播放到事件发生处后标记，保留前 3 秒和后 1 秒。' + (markerOpen ? '没有候选时也可直接标记。' : '') + '</p><form id="marker-form"><label>事件类型<select name="context" aria-label="手动标记的事件类型">' +
    Object.entries(SCENE_LABELS).filter(([key]) => key !== 'unknown').map(([key, label]) => '<option value="' + key + '">' + label + '</option>').join('') +
    '</select></label><button class="button small secondary" type="submit">标记当前播放位置</button></form>';
  controls.insertAdjacentHTML('beforeend', markerOpen ? '<section class="manual-marker is-open" aria-label="补充漏掉的关键事件">' + markerBody + '</section>' : '<details class="manual-marker"><summary>补充漏掉的关键事件</summary>' + markerBody + '</details>');
  $('#marker-form').onsubmit = submit => {
    submit.preventDefault();
    const at = player.currentTime, context = new FormData(submit.currentTarget).get('context');
    if (!Number.isFinite(at) || at < 0 || at > state.report.duration) { notify('请先播放到要标记的位置。', true); return; }
    const duplicate = state.report.events.findIndex(e => e.source === 'manual' && e.context === context && Math.abs(e.at - at) < 0.5);
    if (duplicate >= 0) { state.eventIndex = duplicate; refreshReport({ focus: '#confirm-event' }); notify('这个位置已有相同事件，已为你打开。'); return; }
    const mark = { id: crypto.randomUUID(), at, start: Math.max(0, at - 3), end: Math.min(state.report.duration, at + 1), context, kind: 'observation', source: 'manual', reviewed: true, included: true, points: [], error: [], corrections: null, acquisitionMs: null };
    state.report.events.push(mark); state.report.events.sort((a, b) => a.start - b.start);
    state.eventIndex = state.report.events.findIndex(e => e.id === mark.id); state.filter = 'all';
    const saved = persistReport(); refreshReport({ focus: '#confirm-event' });
    if (saved) notify('关键事件已标记。手动标记只用于复盘，不计入量化建议样本。');
  };
  syncPlayback();
}

function persistReport() { if (!state.report.demo) { try { saveReport(state.report); } catch { notify('报告暂时无法保存：本地存储空间可能不足，请先导出。', true); return false; } } return true; }
function bind() {
  $('.brand').setAttribute('aria-label', 'doctorgame 首页');
  $('#video-file').hidden = true;
  $('#notice').removeAttribute('role');
  $('#start-recording')?.addEventListener('click', startRecording);
  $('#retry-capture')?.addEventListener('click', startRecording);
  $('#stop-recording')?.addEventListener('click', () => state.capture?.stop());
  $('#stop-banner')?.addEventListener('click', () => state.capture?.stop());
  $('#cancel-capture')?.addEventListener('click', cancelCapture);
  $('#cancel-capture-banner')?.addEventListener('click', cancelCapture);
  $('#reselect-capture')?.addEventListener('click', reselectCapture);
  $('#reselect-capture-banner')?.addEventListener('click', reselectCapture);
  $('#import-video')?.addEventListener('click', () => $('#video-file').click());
  $('#video-file')?.addEventListener('change', importVideo);
  $('#load-demo')?.addEventListener('click', () => { if (state.capture || state.capturePhase) return; releaseMedia(); state.report = makeDemo(state.profile); state.eventIndex = 0; state.filter = 'all'; navigate('report'); });
  $('#profile-form')?.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const updated = validateProfile(data);
      saveProfile(updated); state.profile = updated; state.profileConfirmed = true;
      $('#profile-feedback').textContent = '已保存。下一次观察将使用这份档案。';
      notify('玩家档案已保存。');
      // Keep the existing save-and-stay button for current flows; the primary
      // action now returns to the task the player came from.
      if (event.submitter?.id === 'save-profile-return') { navigate('workspace'); notify('玩家档案已保存，可以开始录制了。'); }
    } catch (error) { notify(error.message, true); }
  });
  $('#cancel-analysis')?.addEventListener('click', () => state.abort?.abort());
  $('#export-report')?.addEventListener('click', exportReport);
  $('#event-filter')?.addEventListener('change', event => { state.filter = event.target.value; refreshReport(); });
  document.querySelectorAll('[data-recording]').forEach(button => button.onclick = () => openRecording(button.dataset.recording));

  $('#open-folder')?.addEventListener('click', async () => { const error = await window.doctorgame.openFolder(); if (error) notify(error, true); });
}

function cancelCapture() { state.captureAbort?.abort(); }
function reselectCapture() { state.reselectCapture = true; state.captureAbort?.abort(); }

async function startRecording() {
  if (state.capture || state.capturePhase || state.busy) return;
  if (!navigator.mediaDevices?.getDisplayMedia) { notify('请在桌面版或支持屏幕录制的 Chrome / Edge 中打开。', true); return; }
  if (window.doctorgame) {
    const dialog = $('#source-dialog'); dialog.showModal(); $('#source-list').textContent = '正在查找窗口…';
    dialog.onclose = () => $('#start-recording')?.focus({ preventScroll: true });
    dialog.onkeydown = event => {
      if (event.key !== 'Tab') return;
      const targets = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href]')].filter(el => el.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    $('#close-source').onclick = () => dialog.close();
    try {
      const sources = await window.doctorgame.sources();
      sources.sort((a, b) => Number(/valorant|无畏契约/i.test(b.name)) - Number(/valorant|无畏契约/i.test(a.name)));
      $('#source-list').innerHTML = sources.length ? sources.map(s => `<button class="source-option" data-source="${esc(s.id)}"><img src="${esc(s.thumbnail)}" alt=""><span>${esc(s.name)}</span></button>`).join('') : '<p>没有可录制的窗口。请打开游戏，并检查系统录屏权限。</p>';
      document.querySelectorAll('[data-source]').forEach(button => button.onclick = async () => { await window.doctorgame.selectSource(button.dataset.source); dialog.close(); await captureSelected(); });
    } catch (error) { $('#source-list').textContent = `无法列出窗口：${error.message}`; }
  } else await captureSelected();
}

async function captureSelected() {
  state.reselectCapture = false;
  state.capturePhase = 'requesting'; state.captureAbort = new AbortController(); render();
  try {
    state.capture = await beginCapture({ ...state.profile }, async item => {
      clearInterval(elapsedTimer); state.capture = null; state.capturePhase = null; await refreshRecordings(); releaseMedia();
      // The list now carries the actual disk/IndexedDB size; use it instead of the
      // just-finished metadata when deciding whether a capture really is empty.
      const finished = state.recordings.find(recording => recording.id === item.id) || item;
      if (!usableRecording(finished)) {
        state.item = finished; state.mediaUrl = null; state.report = null; await setBusy(false);
        state.notice = { message: '没有收到任何画面，录制没有生成可分析录像；空文件与元数据仍保留在本机。可以重新选择窗口或导入录像。', error: true };
        render(); return;
      }
      state.mediaUrl = await storage.url(finished); state.item = finished; await runAnalysis(finished);
    }, async (error, terminal) => {
      if (terminal) { clearInterval(elapsedTimer); state.capture = null; state.capturePhase = null; await setBusy(false); render(); }
      notify(error.message, true);
    }, { signal: state.captureAbort.signal, onWaiting: () => { state.capturePhase = 'waiting'; render(); } });
    state.capturePhase = null; state.captureAbort = null;
    await window.doctorgame?.setBusy(true); state.page = 'workspace'; state.notice = null; render(); elapsedTimer = setInterval(tick, 1000);
    notify('已开始录制。打完后点击“结束并分析”。');
  } catch (error) {
    const canceled = error.name === 'AbortError' || error.code === 'CAPTURE_CANCELED';
    const reselect = state.reselectCapture; state.reselectCapture = false;
    state.capturePhase = null; state.captureAbort = null; state.capture = null;
    if (canceled) notify('已取消等待画面，没有开始录制。可以重新选择窗口。');
    else if (error.code === 'NO_FRAMES') notify('没有收到窗口画面，录制没有开始，也没有保存空录像。请确认选中的窗口正在显示动态画面，或重新选择窗口后重试。', true);
    else notify(error.name === 'NotAllowedError' ? '未获得录屏权限。可以重新选择窗口，或在系统设置中允许录屏。' : `无法开始记录：${error.message}`, true);
    render();
    if (reselect) startRecording();
  }
}
function tick() { if (!state.capture) return; const value = time((performance.now() - state.capture.startedAt) / 1000); for (const selector of ['#elapsed', '#elapsed-global']) { const target = $(selector); if (target) target.textContent = value; } }

async function importVideo(event) {
  const file = event.target.files?.[0]; if (!file || state.capture || state.capturePhase || state.busy) return;
  if (file.size > 2 * 1024 ** 3) { notify('单个视频最多 2 GB，请先裁剪或压缩。', true); return; }
  await setBusy(true); state.progress = { label: '正在保存录像', fraction: 0 }; render();
  let url = URL.createObjectURL(file), id;
  try {
    const { video, duration } = await inspectVideo(url); video.removeAttribute('src'); video.load();
    id = await storage.begin({ profile: { ...state.profile }, title: file.name, mimeType: file.type || 'video/webm' });
    for (let pos = 0; pos < file.size; pos += 8 * 1024 ** 2) { await storage.append(id, file.slice(pos, pos + 8 * 1024 ** 2)); }
    const item = await storage.finish(id, { duration, bytes: file.size });
    releaseMedia(); state.mediaUrl = url; url = null; state.item = item; await refreshRecordings(); await runAnalysis(item);
  } catch (error) { await setBusy(false); if (id) await storage.finish(id, { incomplete: true }).catch(() => {}); render(); notify(`导入失败：${error.message}`, true); }
  finally { if (url) URL.revokeObjectURL(url); }
}

async function openRecording(id) {
  if (state.capture || state.capturePhase || state.busy) { notify('请先结束当前记录或分析。', true); return; }
  const item = state.recordings.find(r => r.id === id); if (!item) return;
  if (!usableRecording(item)) { notify('这段录像的实际文件为空（0 字节），不能进入分析。原文件与元数据仍保留在本机；请重新录制或导入其他录像。', true); return; }
  const reportState = readReportState(id);
  if (reportState.status === 'invalid') {
    notify('这份报告的存档数据不完整，无法打开。录像和原报告仍保留；可以继续录制、导入，或打开其他报告。', true);
    return;
  }
  try {
    releaseMedia(); state.mediaUrl = await storage.url(item); state.item = item;
    if (reportState.status === 'valid') { state.report = reportState.report; state.eventIndex = 0; state.filter = 'all'; navigate('report'); }
    else await runAnalysis(item);
  } catch (error) { notify(`打开录像失败：${error.message}`, true); }
}

async function runAnalysis(item) {
  if (!item || !usableRecording(item)) { notify('这段录像的实际文件为空（0 字节），不能分析。原文件与元数据仍保留在本机；请重新录制或导入其他录像。', true); render(); return; }
  await setBusy(true); state.abort = new AbortController(); state.progress = { fraction: 0 }; state.page = 'report'; render();
  try {
    state.report = await analyzeVideo(state.mediaUrl, item, progress => { state.progress = progress; const bar = $('progress'); if (bar) bar.value = progress.fraction; const detail = $('.progress-meta'); if (detail) detail.innerHTML = `<span>${Math.round(progress.fraction * 100)}%</span><span>已检查 ${progress.processed.toLocaleString()} 帧 · ${progress.candidates} 个候选片段</span>`; }, state.abort.signal);
    state.eventIndex = 0; state.filter = 'all'; state.clipEnd = null; persistReport();
    state.notice = { message: state.report.events.length ? '分析完成。请先回放确认候选片段。' : '分析完成，没有找到候选片段。录像已保留；可以播放完整录像并手动标记关键事件，或导入另一段录像。', error: false };
  } catch (error) {
    state.page = 'history'; state.notice = { message: error.name === 'AbortError' ? '分析已取消，录像仍保留在对局记录中。' : `分析未完成：${error.message} 录像已保留，可重新打开重试。`, error: error.name !== 'AbortError' };
  } finally { await setBusy(false); state.abort = null; render(); }
}
function exportReport() {
  const report = { ...state.report, recommendation: recommend(state.report.events, state.report.profile, { demo: state.report.demo }) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `doctorgame-${report.demo ? 'demo' : report.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('已导出 JSON 报告。');
}

// Delegated so navigation and import triggers rendered inside refreshed panels
// keep working without re-binding on every partial update.
document.addEventListener('click', event => {
  const nav = event.target.closest?.('[data-nav]');
  if (nav) { event.preventDefault(); navigate(nav.dataset.nav); return; }
  if (event.target.closest?.('[data-import-video]')) { $('#video-file')?.click(); }
});

window.doctorgame?.onStop(() => state.capture?.stop());
window.addEventListener('beforeunload', event => { if (state.capture || state.capturePhase || state.busy) { event.preventDefault(); event.returnValue = ''; } });
await refreshRecordings().catch(error => { state.notice = { message: `无法加载本地记录：${error.message}`, error: true }; });
render();
