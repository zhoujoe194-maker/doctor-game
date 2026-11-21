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
const recordingLabel = item => activeRecording(item) ? '正在录制' : item.actualBytes === 0 ? '无画面' : loadReport(item.id) ? '查看报告' : item.status === 'ready' ? '待分析' : '录制中断 · 可恢复';
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
const state = { page: 'workspace', profile, profileConfirmed: initialProfile.confirmed, recordings: [], capture: null, capturePhase: null, captureAbort: null, reselectCapture: false, busy: false, report: null, item: null, mediaUrl: null, eventIndex: 0, filter: 'all', progress: null, abort: null, notice: null, playbackRate: 1, clipEnd: null, homePreviewUrl: null, railPreviewUrl: null };
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
const navItems = [['workspace', 'grid', '工作台'], ['history', 'play', '对局记录'], ['profile', 'sliders', '玩家档案'], ['method', 'book', '分析方法']];

function render() {
  $('#replay')?.pause();
  if (state.homePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.homePreviewUrl);
  if (state.railPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(state.railPreviewUrl);
  state.homePreviewUrl = null; state.railPreviewUrl = null;
  const current = navItems.find(n => n[0] === state.page);
  const waiting = state.capturePhase === 'waiting';
  $('#app').innerHTML = '<aside class="sidebar" aria-label="工作空间导航">' +
    '<a class="brand" href="#workspace" data-nav="workspace" aria-label="doctorgame 首页"><img src="./assets/mark.svg" alt="" width="32" height="32"><span>doctorgame</span></a>' +
    '<nav aria-label="主导航">' + navItems.map(([page, glyph, title]) => '<button class="nav-item ' + (state.page === page || (state.page === 'report' && page === 'history') ? 'active' : '') + '" data-nav="' + page + '" aria-label="' + title + '" ' + (state.page === page ? 'aria-current="page"' : '') + '>' + icon(glyph) + '<span>' + title + '</span></button>').join('') + '</nav>' +
    recentsRail() +
    '<div class="local-status">' + icon('shield') + '<span>录像保存在本机<small>不录制音频</small></span></div></aside>' +
    '<div class="app-body"><header class="topbar"><span>' + (current?.[2] || '赛后复盘') + '</span><span>无畏契约 <span class="version">桌面测试版</span></span></header>' +
    '<main id="main" tabindex="-1"><div id="notice" class="notice ' + (state.notice?.error ? 'error' : '') + '" ' + (state.notice ? '' : 'hidden') + '>' + esc(state.notice?.message) + '</div>' +
    (waiting && state.page !== 'workspace' ? '<div class="recording-banner waiting"><span class="wait-dot"></span>正在等待窗口画面 <button class="button small secondary" id="cancel-capture-banner">取消等待</button></div>' : '') +
    (state.capture && state.page !== 'workspace' ? '<div class="recording-banner"><span class="record-dot"></span>正在录制 <button class="button small danger" id="stop-banner">结束并分析</button></div>' : '') +
    (state.busy && !state.capture && !state.capturePhase ? progressView() : state.page === 'workspace' ? workspaceView() : state.page === 'history' ? historyView() : state.page === 'profile' ? profileView() : state.page === 'method' ? methodView() : reportView()) +
    '</main><footer class="app-footer"><span>doctorgame</span><span>' + (window.doctorgame ? '本地桌面版' : '浏览器预览 · 录制时请保持页面打开') + '</span></footer></div>' +
    '<input id="video-file" type="file" hidden accept="video/mp4,video/webm,video/x-matroska,.webm,.mp4,.mkv" aria-label="导入游戏录像">' +
    '<dialog id="source-dialog" aria-labelledby="source-title"><div class="dialog-head"><h2 id="source-title">选择游戏窗口</h2><button id="close-source" class="icon-button" aria-label="关闭窗口选择">×</button></div><p class="muted">选择完整的游戏窗口，准星应位于画面中央。</p><div id="source-list"></div></dialog>';
  bind();
  if (state.page === 'report' && state.report && !state.busy) refreshReport({ seek: true });
  if (state.capture && state.page === 'workspace') {
    const preview = $('#live-preview');
    if (preview) { preview.srcObject = state.capture.stream; preview.play().catch(() => {}); tick(); }
  } else if (state.page === 'workspace' && !state.busy) loadRecentPreview();
  if (!state.busy) loadRailPreview();
}

function workspaceView() {
  const recording = Boolean(state.capture), waiting = state.capturePhase === 'waiting' || state.capturePhase === 'requesting';
  const latestUsable = state.recordings.find(usableRecording);
  const latest = latestUsable || state.recordings[0];
  const returning = Boolean(state.recordings.length);
  return '<section class="page-heading"><div><h1>录制与复盘</h1><p>' + (returning ? '先继续上一局，或录一段新的对局。' : '选择一段对局，回看你的瞄准过程。') + '</p></div></section>' +
    (waiting ? waitingView() : recording ? captureView() : returning ? recentSessionView(latest) + captureCompactView() : firstUseView()) +
    profileStripView() +
    (returning ? '' : emptyRecentView()) +
    '<p class="bottom-note">' + icon('info') + '测试版会产生候选误检；回放确认后再判断是否试用新的灵敏度。</p>';
}

function firstUseView() {
  return '<section class="recording-home" aria-label="录制操作"><div class="recording-intro"><h2>录下一局，或导入已有录像</h2><p>手动选择窗口，结束后分析。录像和档案仅保存在本机。</p></div><div class="start-actions"><button class="button primary large" id="start-recording">' + icon('record') + '开始录制</button><button class="button secondary large" id="import-video">' + icon('upload') + '导入录像</button></div><p class="capture-note">支持 MP4 / WebM · 单个文件最多 2 GB · 不录制音频</p></section>';
}

function waitingView() {
  const requesting = state.capturePhase === 'requesting';
  return '<section class="recording-home is-waiting" aria-label="等待窗口画面"><div class="capture-actions"><div><h2><span class="wait-dot"></span>' + (requesting ? '正在打开窗口选择…' : '正在等待窗口画面…') + '</h2><p>' + (requesting ? '在系统窗口列表中选一个正在显示游戏画面的窗口。' : '已选择窗口。收到第一帧画面后才开始录制；没有画面不会保存空录像。') + '</p></div>' +
    (requesting ? '' : '<div class="waiting-actions"><button class="button secondary" id="cancel-capture">取消等待</button><button class="button secondary" id="reselect-capture">重新选择窗口</button></div>') +
    '</div></section>';
}

function captureView() {
  return '<section class="recording-home is-recording" aria-label="录制状态"><div class="capture-actions"><div><h2><span class="record-dot"></span> 正在录制 <span id="elapsed">00:00</span></h2><p>已收到窗口画面。可以返回游戏；关闭桌面窗口后仍在托盘录制。</p></div><button class="button danger" id="stop-recording">' + icon('stop') + '结束并分析</button></div><div class="capture-stage"><video id="live-preview" autoplay muted playsinline aria-label="正在录制的画面预览"></video></div></section>';
}

function profileStripView() {
  const p = state.profile;
  return '<section class="profile-strip" aria-label="本局玩家档案"><div><span>鼠标 DPI</span><strong>' + p.dpi + '</strong></div><div><span>游戏内灵敏度</span><strong>' + p.sensitivity.toFixed(3) + '</strong></div><div class="profile-habits"><span>瞄准习惯</span><strong>' + HABIT_LABELS.aimStyle[p.aimStyle] + ' / ' + HABIT_LABELS.grip[p.grip] + '</strong></div>' +
    '<span class="profile-state ' + (state.profileConfirmed ? 'confirmed' : 'unconfirmed') + '">' + (state.profileConfirmed ? '档案已保存' : '默认值 · 待核对') + '</span>' +
    '<button class="text-button" data-nav="profile" aria-label="编辑玩家档案">' + icon('sliders') + '编辑玩家档案</button></section>' +
    (state.profileConfirmed ? '' : '<p class="profile-verify" role="note">' + icon('info') + '开始录制前请核对 DPI 和游戏内灵敏度；当前显示的是默认值。</p>');
}

function recentSessionView(item) {
  const report = usableRecording(item) ? loadReport(item.id) : null;
  let result = null;
  try { if (report) result = recommend(report.events, report.profile, { demo: false }); } catch { result = null; }
  const pending = report ? report.events.filter(e => e.included && !e.reviewed).length : 0;
  return '<section class="recent-section" aria-label="最近一局"><div class="section-heading"><h2>继续上一局</h2><button class="text-button" data-nav="history">全部记录 ' + icon('arrow') + '</button></div>' +
    (usableRecording(item) ?
      '<div class="recent-session"><div class="recent-preview"><video id="recent-preview" muted playsinline preload="metadata" aria-label="最近一局画面预览"></video><span>' + time(item.duration) + '</span></div><div class="recent-description"><span class="muted">' + new Date(item.createdAt).toLocaleString('zh-CN') + '</span><h3>' + esc(item.title || '游戏录像') + '</h3><p>' + (report ? '复盘进度已保存在本机。' : item.status === 'ready' ? '录像已保存，尚未分析。' : '上次录制中断，已写入的画面仍保留，可尝试恢复分析。') + '</p>' +
        (result ? '<p class="recent-progress">已确认且可量化 <strong>' + result.reviewed + '</strong> / ' + MIN_REVIEWED + ' 起步样本 · 待确认 <strong>' + pending + '</strong> 个片段</p>' : '') +
        '<button class="button primary" data-recording="' + esc(item.id) + '">' + icon('play') + (report ? '继续复盘' : '打开并分析') + '</button></div></div>' :
      '<div class="recent-session no-footage"><div class="recent-preview"><span class="no-video">' + icon('record') + '</span><span>无画面</span></div><div class="recent-description"><span class="muted">' + new Date(item.createdAt).toLocaleString('zh-CN') + '</span><h3>' + esc(item.title || '游戏录像') + '</h3><p>磁盘上的录像文件为空（0 字节），未生成可回放录像；原文件与元数据仍保留在本地。</p><p class="recent-progress">可以重新选择窗口录制，或导入已有录像。</p><div class="recent-actions"><button class="button primary" id="retry-capture">' + icon('record') + '重新选择窗口</button><button class="button secondary" data-import-video>' + icon('upload') + '导入录像</button></div></div></div>') +
    '</section>';
}

function captureCompactView() {
  return '<section class="capture-compact" aria-label="录制新对局"><div><h2>录下一局</h2><p>手动选择窗口，结束后分析。录像和档案仅保存在本机，不录制音频。</p></div><div class="capture-compact-actions"><button class="button primary" id="start-recording">' + icon('record') + '开始录制</button><button class="button secondary" id="import-video">' + icon('upload') + '导入录像</button></div></section>';
}

function emptyRecentView() {
  return '<section class="recent-section"><div class="section-heading"><h2>最近一局</h2><button class="text-button" data-nav="history">全部记录 ' + icon('arrow') + '</button></div><div class="empty-history"><div>' + icon('play') + '<h3>还没有录像</h3><p>用上方的「开始录制」或「导入录像」添加第一局。</p></div><button class="text-button" id="load-demo">查看合成示例 ' + icon('arrow') + '</button></div></section>';
}

// Fixed Recents entry, borrowed from Aimlabs' left rail: the last session's
// thumbnail and its "open report/analyze" action stay adjacent on every page.
function recentsRail() {
  const item = state.recordings.find(usableRecording) || state.recordings[0];
  if (!item) return '';
  const report = usableRecording(item) ? loadReport(item.id) : null;
  return '<div class="recents-rail" aria-label="最近一局"><div class="recents-rail-head"><span>最近一局</span><button class="rail-more" data-nav="history" aria-label="查看全部对局记录">全部记录</button></div>' +
    (usableRecording(item) ?
      '<div class="rail-card"><div class="rail-thumb"><video id="rail-preview" muted playsinline preload="metadata" aria-label="最近一局缩略画面"></video><span class="rail-duration">' + time(item.duration) + '</span></div><p class="rail-title">' + esc(item.title || '游戏录像') + '</p><button class="button small secondary rail-open" data-recording="' + esc(item.id) + '" aria-label="' + (report ? '打开最近一局的复盘报告' : '分析最近一局的录像') + '">' + icon('play') + (report ? '查看报告' : '打开并分析') + '</button></div>' :
      '<div class="rail-card"><div class="rail-thumb"><span class="no-video">' + icon('record') + '</span></div><p class="rail-title">上次录制没有画面</p><button class="button small secondary rail-open" id="retry-capture-rail">重新录制</button></div>') +
    '</div>';
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

async function loadRailPreview() {
  const video = $('#rail-preview'), item = state.recordings.find(usableRecording);
  if (!video || !item) return;
  try {
    const url = await storage.url(item);
    if (!video.isConnected) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); return; }
    state.railPreviewUrl = url; video.src = url;
    video.addEventListener('loadedmetadata', () => { video.currentTime = Math.min(1, item.duration / 2 || 0); }, { once: true });
  } catch { /* The rail entry remains available even if its preview cannot load. */ }
}

function recordingRows(items) {
  return `<div class="recording-list">${items.map(item => `<button class="recording-row" data-recording="${esc(item.id)}"><span class="recording-icon">${icon('play')}</span><span class="recording-name"><strong>${esc(item.title || '游戏录像')}</strong><small>${new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${item.profile?.sensitivity ?? '—'} SENS · ${item.profile?.dpi ?? '—'} DPI</small></span><span class="recording-duration">${time(item.duration)}</span><span class="recording-tag">${recordingLabel(item)}</span>${icon('arrow')}</button>`).join('')}</div>`;
}
function historyView() {
  const locked = state.capture || state.capturePhase;
  return `<section class="page-heading"><div><h1>对局记录</h1><p>查看已保存的录像与复盘进度。</p></div><button class="button secondary" id="import-video" ${locked ? 'disabled' : ''}>${icon('upload')}导入录像</button></section>${state.recordings.length ? recordingRows(state.recordings) : '<div class="large-empty">还没有对局记录。开始录制或导入一段录像即可。</div>'}<div class="history-actions"><button class="button secondary" id="load-demo" ${locked ? 'disabled' : ''}>体验合成示例</button>${window.doctorgame ? '<button class="text-button" id="open-folder">打开录像文件夹</button>' : '<span class="muted">浏览器版录像保存在当前浏览器；清理网站数据会移除它们。</span>'}</div>`;
}

function choiceGroup(name, legend, options, hint) {
  return `<fieldset class="choice-group"><legend>${legend}</legend><div class="choices">${options.map(([value, label, detail]) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${state.profile[name] === value ? 'checked' : ''}><span><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ''}</span></label>`).join('')}</div>${hint ? `<p class="field-hint">${hint}</p>` : ''}</fieldset>`;
}
function profileView() {
  const p = state.profile;
  return `<section class="page-heading"><div><h1>玩家档案</h1><p>记录实际设置和习惯，用于下一局分析。</p></div></section>${state.profileConfirmed ? '' : '<p class="profile-verify profile-verify-page" role="note">' + icon('info') + '当前显示的是默认值 800 / 0.35。请按游戏内实际设置核对后保存；保存后可直接返回工作台。</p>'}<form id="profile-form" class="profile-form"><div class="form-main"><section class="form-section"><div class="form-section-title"><div><h2>游戏与鼠标</h2><p>填写游戏中实际使用的数值。</p></div></div><div class="fields"><label>鼠标 DPI<input name="dpi" type="number" min="100" max="64000" step="1" value="${p.dpi}" required><small>在鼠标驱动中查看</small></label><label>游戏内灵敏度<input name="sensitivity" type="number" min="0.001" max="10" step="any" value="${p.sensitivity}" required><small>基础灵敏度，暂不包含开镜倍率</small></label><label>敌人高亮颜色<select name="outline">${Object.entries(outlineLabel).map(([key, label]) => `<option value="${key}" ${p.outline === key ? 'selected' : ''}>${label}</option>`).join('')}</select><small>与游戏内设置保持一致</small></label></div></section>
  <section class="form-section"><div class="form-section-title"><div><h2>你的瞄准习惯</h2><p>按大多数时候的动作选择，混合使用很正常。</p></div></div>
    ${choiceGroup('aimStyle', '主要通过哪里移动鼠标？', [['arm', '手臂为主', '前臂带动大部分移动'], ['wrist', '手腕为主', '手腕转动完成大部分移动'], ['mixed', '混合使用', '手臂转向，手腕或手指微调'], ['unknown', '暂不确定', '可以之后再补充']])}
    ${choiceGroup('grip', '平时怎样握住鼠标？', [['palm', '趴握', '手掌大面积贴住鼠背'], ['claw', '抓握', '掌根接触，手指拱起'], ['fingertip', '指握', '主要由指尖接触鼠标'], ['unknown', '暂不确定', '也可能介于两种握法之间']], '这些信息由你填写；游戏画面无法直接判断握姿。')}
  </section><section class="form-section"><div class="form-section-title"><div><h2>空间与控制感</h2><p>记录实际可用的空间，比鼠标垫标称尺寸更有用。</p></div></div><label class="space-field">鼠标左右可移动的总宽度 <span class="muted">（选填，cm）</span><input name="mouseSpace" type="number" min="5" max="150" step="any" placeholder="例如 35" value="${p.mouseSpace ?? ''}"></label>
  ${choiceGroup('comfort', '目前哪种描述最接近你的体验？', [['comfortable', '移动舒适', '大幅转向也有余量'], ['limited', '经常拉到边缘', '转身时需要抬鼠重置'], ['tense', '容易用力过紧', '微调时控制感不稳定'], ['unknown', '暂不确定', '先记录，再观察']])}</section>
  <div class="form-save"><span id="profile-feedback" role="status">保存后用于下一次观察；旧报告保留当时的档案。</span><div class="form-save-actions"><button class="button secondary" type="submit" ${state.capture || state.capturePhase ? 'disabled' : ''}>${icon('check')}保存玩家档案</button><button class="button primary" type="submit" id="save-profile-return" ${state.capture || state.capturePhase ? 'disabled' : ''}>保存并返回工作台</button></div></div></div>
  <aside class="form-aside"><span class="aside-label">WHY IT MATTERS</span><h2>数字之外，<br>还有你的动作。</h2><div class="hand-diagram" aria-hidden="true">${icon('mouse')}<div class="motion-arc"></div><span>↔</span></div><p>手臂、手腕和手指各自承担的动作不同。分析会结合这些习惯，提醒你复测哪些场景。</p><hr><strong>习惯是线索，不是结论。</strong><p>不会仅凭握姿推荐固定灵敏度。是否调整，还需要画面证据和调整前后的表现来验证。</p></aside></form>`;
}

function progressView() {
  const p = state.progress;
  return `<section class="progress-page"><div class="progress-symbol">${icon('target')}</div><h1>${p?.label || '正在整理瞄准片段'}</h1><p>全程在本机处理。完整对局可能需要较长时间。</p><progress max="1" value="${p?.fraction || 0}" aria-label="分析进度"></progress><div class="progress-detail"><span>${Math.round((p?.fraction || 0) * 100)}%</span><span>${p?.processed ? `已检查 ${p.processed.toLocaleString()} 帧 · ${p.candidates || 0} 个候选片段` : '正在准备录像…'}</span></div>${state.abort ? '<button class="button secondary" id="cancel-analysis">取消分析，保留录像</button>' : '<span class="muted">正在保存，请稍候。</span>'}<div class="bottom-note">${icon('shield')} 分析结果只在赛后展示。</div></section>`;
}

function reportView() {
  const r = state.report;
  if (!r) return '<div class="large-empty">请先从对局记录中打开一份报告。</div>';
  return '<section class="page-heading report-heading"><div><h1>' + (r.demo ? '复盘示例' : '赛后复盘') + '</h1><p>' +
    (r.demo ? '合成示例 · 程序生成的轨迹，不是玩家实战录像。' : esc(state.item?.title || '游戏录像') + ' · ' + time(r.duration) + ' · ' + r.profile.dpi + ' DPI') +
    '</p></div><button class="button secondary" id="export-report">' + icon('download') + '导出报告</button></section>' +
    '<div id="review-summary" class="report-summary" aria-label="复盘概览"></div>' +
    '<div class="review-grid"><section class="evidence-panel" aria-label="录像与片段操作"><div id="evidence-stage" class="evidence-stage"></div>' +
    '<div class="timeline-panel"><div id="clip-timeline"></div><div class="seek-row"><label class="sr-only" for="replay-seek">录像播放位置</label><input id="replay-seek" type="range" min="0" max="' + r.duration + '" step="0.05" value="0" ' + (r.demo ? 'disabled' : '') + '><output id="replay-time">00:00 / ' + time(r.duration) + '</output></div></div><div id="playback-controls" class="playback-controls"></div></section>' +
    '<aside class="review-side" aria-label="片段选择与确认"><details id="clips-panel" class="clips-panel" ' + (innerWidth >= 1050 ? 'open' : '') + '><summary>片段 <span id="clip-total" class="count-badge">' + r.events.length + '</span><span class="collapse-hint">展开 / 收起</span></summary>' +
    '<label class="filter-label" for="event-filter">筛选<select id="event-filter"><option value="all">全部片段</option><option value="pending">待确认</option><option value="reviewed">已确认</option><option value="excluded">已排除</option>' + Object.entries(SCENE_LABELS).filter(([key]) => key !== 'unknown').map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join('') + '</select></label><div id="events-list" class="events-list"></div></details><div id="evidence-controls" class="evidence-controls"></div></aside></div>' +
    '<div class="review-details"><details class="analysis-details"><summary>轨迹与判断依据</summary><div class="error-chart"><div><strong id="chart-title">目标相对准星的位置</strong><span id="chart-unit">沿初始瞄准方向 · 屏幕宽度 %</span></div><svg id="error-plot" viewBox="0 0 640 130" role="img" aria-label="当前片段的位置曲线"></svg><p id="chart-description"></p></div></details>' +
    '<details class="advice-details" id="advice-details"><summary>建议依据与下一次复测</summary><div id="recommendation-detail"></div></details></div>';
}

function reportSummary() {
  const r = state.report, result = recommend(r.events, r.profile, { demo: r.demo });
  const adviceOpen = Boolean($('#advice-details')?.open);
  // Show the recommendation's own reason next to the number; the full rules stay
  // available but no longer hide the explanation behind a collapsed disclosure.
  return '<div><span>已确认且可量化</span><strong data-testid="quantified-count">' + (r.demo ? 0 : result.reviewed) + '<small> / ' + MIN_REVIEWED + ' 起步样本</small></strong></div>' +
    '<div><span>待确认片段</span><strong>' + r.events.filter(e => e.included && !e.reviewed).length + '</strong></div>' +
    '<div class="recommend-inline"><span>本次建议</span><strong>' + (result.status === 'experiment' ? '试用 ' : '保持当前值 ') + result.candidate + (result.change ? '<small>' + (result.change > 0 ? '+3%' : '−3%') + '</small>' : '') + '</strong>' +
    '<p class="recommend-reason" data-testid="recommend-reason">' + esc(result.reason) + '</p>' +
    '<button class="text-button advice-toggle" id="advice-toggle" type="button" aria-expanded="' + adviceOpen + '" aria-controls="advice-details">查看依据与复测 ' + icon('arrow') + '</button></div>';
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

function methodView() {
  return `<section class="page-heading"><div><div class="eyebrow">EVIDENCE BEFORE NUMBERS</div><h1>建议，从哪里来<span class="heading-dot">.</span></h1><p>每一步都可以解释，每一个结论都留有验证的余地。</p></div></section><div class="method-layout"><article class="method-article"><section><span class="method-number">01 / 记录</span><h2>画面 + 玩家习惯</h2><p>手动选择游戏窗口，后台记录无音频录像。DPI、游戏内灵敏度、瞄准方式、握姿、可移动空间和控制感会作为本场档案保存。结束后再分析。</p></section><section><span class="method-number">02 / 寻找线索</span><h2>寻找目标相对准星的变化</h2><p>当前原型每秒抽取 20 帧，按敌人高亮颜色查找候选轮廓，跟踪它相对画面中心的位置。丢失目标、多个候选目标或轨迹跳变的片段会被跳过。</p><p>颜色识别不是训练好的敌人检测模型。技能特效、场景、后坐力、目标移动和观战画面都可能产生误判，因此需要你回放确认。</p></section><section><span class="method-number">03 / 结合习惯</span><h2>用身体动作解释画面</h2><p>手腕为主的玩家需要同时验证微调与大角度转身；手臂为主的玩家需要关注停下后的细微修正。握姿用于保留比较条件，鼠标空间用于检查是否存在转向限制。</p><p>目前没有采用“某种握法 = 某个灵敏度”的硬编码映射。习惯信息会改变解释与复测项目，暂不直接给推荐数值加权。</p></section><section><span class="method-number">04 / 验证</span><h2>先提出假设，再比较设置</h2><p>至少 ${MIN_REVIEWED} 个回放确认的有效片段，且同一偏差方向占比达到 65%、Wilson 区间下界大于 50%，才提出 ±3% 的小幅试用设置。其他情况保持原值。</p><p>这些阈值是原型的工程规则，片段也不一定相互独立；它们不是科学保证或校准后的置信度。真实准确率与改善效果需要用标注录像和交叉复测验证。</p></section></article><aside class="method-aside"><h2>当前版本的边界</h2><ul><li>手动开始与结束记录</li><li>仅分析基础灵敏度</li><li>握姿与动作习惯由玩家填写</li><li>本地保存、赛后反馈</li><li>样本不足时保留原值</li></ul><p>下一步重点：标注真实对局，验证目标识别；引入相机运动补偿，分离敌人移动与玩家转向；比较调整前后的控制表现。</p><div class="bottom-note">${icon('info')}尚未经过 Riot 审核或 Windows 实战兼容性验证。</div></aside></div>`;
}

function renderEvidence({ seek = false } = {}) {
  const r = state.report, e = r.events[state.eventIndex], stage = $('#evidence-stage'), controls = $('#evidence-controls');
  if (r.demo) {
    stage.innerHTML = '<div class="demo-label">合成示例 · 非游戏画面</div><svg viewBox="0 0 640 360" aria-label="合成的目标轨迹示意图" role="img"><path d="M305 180h30M320 165v30" stroke="#f2f5ed" stroke-width="2"/>' +
      (e ? '<polyline points="' + e.points.map(p => p.x * 640 + ',' + p.y * 360).join(' ') + '" fill="none" stroke="#c2f279" stroke-width="2"/>' + e.points.map((p, i) => '<circle cx="' + p.x * 640 + '" cy="' + p.y * 360 + '" r="' + (i ? 3 : 6) + '" fill="#c2f279"/>').join('') : '') + '</svg>';
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
  plot.innerHTML = errors.length ? '<line x1="34" y1="66" x2="625" y2="66" stroke="#8f9b88" stroke-dasharray="3 5"/><text x="4" y="70" fill="#58665b" font-size="12">0</text><polyline points="' + errors.map((v, i) => (34 + i / Math.max(1, errors.length - 1) * 590) + ',' + (66 - v / max * 49)).join(' ') + '" fill="none" stroke="#426c2f" stroke-width="2.5"/>' : '';
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
  $('.brand').setAttribute('aria-label', 'doctorgame 灵敏度实验室首页');
  $('#video-file').hidden = true;
  $('#notice').removeAttribute('role');
  document.querySelectorAll('aside').forEach((element, index) => element.setAttribute('aria-label', element.querySelector('h2')?.textContent || `工作空间导航 ${index + 1}`));
  if (state.page === 'method') $('.method-article')?.insertAdjacentHTML('beforeend', `<section><span class="method-number">05 / 场景分开看</span><h2>击杀、被击杀、无击杀对枪与预瞄</h2><p>片段按这四种场景回放确认。当前版本不会根据颜色轨迹自动宣称发生击杀或死亡；真实结果仍由玩家选择。后续需要用游戏界面事件识别定位时间点，并连同事件前的瞄准过程一起分析。</p><p>预瞄候选使用多个背景区域的位移一致性估计视角运动，显示方向反转次数和位移速度。低纹理、快速甩动和不一致运动会被跳过。它是低频视角变化的近似，无法直接测量手部平滑度，也暂不参与推荐数值计算。</p></section>`);
  document.querySelectorAll('.nav-item').forEach(button => button.setAttribute('aria-label', navItems.find(n => n[0] === button.dataset.nav)[2]));
  $('#start-recording')?.addEventListener('click', startRecording);
  $('#retry-capture')?.addEventListener('click', startRecording);
  $('#retry-capture-rail')?.addEventListener('click', startRecording);
  $('#stop-recording')?.addEventListener('click', () => state.capture?.stop());
  $('#stop-banner')?.addEventListener('click', () => state.capture?.stop());
  $('#cancel-capture')?.addEventListener('click', cancelCapture);
  $('#cancel-capture-banner')?.addEventListener('click', cancelCapture);
  $('#reselect-capture')?.addEventListener('click', reselectCapture);
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
function tick() { const target = $('#elapsed'); if (target && state.capture) target.textContent = time((performance.now() - state.capture.startedAt) / 1000); }

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
  try {
    releaseMedia(); state.mediaUrl = await storage.url(item); state.item = item;
    const report = loadReport(id);
    if (report) { state.report = report; state.eventIndex = 0; state.filter = 'all'; navigate('report'); }
    else await runAnalysis(item);
  } catch (error) { notify(`打开录像失败：${error.message}`, true); }
}

async function runAnalysis(item) {
  if (!item || !usableRecording(item)) { notify('这段录像的实际文件为空（0 字节），不能分析。原文件与元数据仍保留在本机；请重新录制或导入其他录像。', true); render(); return; }
  await setBusy(true); state.abort = new AbortController(); state.progress = { fraction: 0 }; state.page = 'report'; render();
  try {
    state.report = await analyzeVideo(state.mediaUrl, item, progress => { state.progress = progress; const bar = $('progress'); if (bar) bar.value = progress.fraction; const detail = $('.progress-detail'); if (detail) detail.innerHTML = `<span>${Math.round(progress.fraction * 100)}%</span><span>已检查 ${progress.processed.toLocaleString()} 帧 · ${progress.candidates} 个候选片段</span>`; }, state.abort.signal);
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
