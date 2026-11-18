import { DEFAULT_PROFILE, HABIT_LABELS, SCENE_LABELS, validateProfile, recommend, MIN_REVIEWED } from './analysis.js';
import { storage, loadProfile, saveProfile, loadReport, saveReport } from './storage.js';
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
let profile;
try { profile = validateProfile(loadProfile(DEFAULT_PROFILE)); } catch { profile = { ...DEFAULT_PROFILE }; }
const state = { page: 'workspace', profile, recordings: [], capture: null, busy: false, report: null, item: null, mediaUrl: null, eventIndex: 0, filter: 'all', progress: null, abort: null, notice: null };
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
function navigate(page) { state.page = page; state.notice = null; render(); $('#main').focus(); }
const navItems = [['workspace', 'grid', '工作台'], ['history', 'play', '对局记录'], ['profile', 'sliders', '玩家档案'], ['method', 'book', '分析方法']];

function render() {
  $('#replay')?.pause();
  const current = navItems.find(n => n[0] === state.page);
  $('#app').innerHTML = `<aside class="sidebar">
    <a class="brand" href="#workspace" data-nav="workspace"><img src="./assets/mark.svg" alt="" width="36" height="36"><span>doctorgame<span class="brand-dot">.</span><small>灵敏度实验室</small></span></a>
    <div class="nav-label">你的工作空间</div>
    <nav aria-label="主导航">${navItems.map(([page, glyph, title]) => `<button class="nav-item ${state.page === page || (state.page === 'report' && page === 'history') ? 'active' : ''}" data-nav="${page}" ${state.page === page ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span>${page === 'history' && state.recordings.length ? `<span class="nav-count">${state.recordings.length}</span>` : ''}</button>`).join('')}</nav>
    <div class="sidebar-note"><span class="little-cross">+</span><p>好手感，<br>值得被认真理解。</p><span>OBSERVE. REFLECT. REFINE.</span></div>
    <div class="local-status">${icon('shield')}<span>本地工作空间<small>画面仅存储在本机</small></span><span class="online-dot"></span></div>
  </aside>
  <div class="app-body"><header class="topbar"><span>DOCTORGAME LAB <span class="slash">/</span> ${current?.[2] || '赛后报告'}</span><div class="top-right"><span class="game-badge"><span class="val-mark">V</span> VALORANT</span><span class="version">原型 v0.1</span></div></header>
  <main id="main" tabindex="-1"><div id="notice" class="notice ${state.notice?.error ? 'error' : ''}" ${state.notice ? '' : 'hidden'} role="status">${esc(state.notice?.message)}</div>
  ${state.capture && state.page !== 'workspace' ? `<div class="recording-banner"><span class="record-dot"></span>正在后台记录 <button class="text-button" id="stop-banner">结束并分析 ${icon('arrow')}</button></div>` : ''}
  ${state.busy && !state.capture ? progressView() : state.page === 'workspace' ? workspaceView() : state.page === 'history' ? historyView() : state.page === 'profile' ? profileView() : state.page === 'method' ? methodView() : reportView()}
  </main><footer class="app-footer"><span>DOCTORGAME / 灵敏度是一场个人实验。</span><span>${window.doctorgame ? '桌面版 · 后台记录' : '浏览器预览 · 录制时请保持页面打开'}</span></footer></div>
  <input id="video-file" class="sr-only" type="file" accept="video/mp4,video/webm,video/x-matroska,.webm,.mp4,.mkv" aria-label="导入游戏录像">
  <dialog id="source-dialog" aria-labelledby="source-title"><div class="dialog-head"><div><span class="eyebrow">CAPTURE SOURCE</span><h2 id="source-title">选择游戏窗口</h2></div><button id="close-source" class="icon-button" aria-label="关闭窗口选择">×</button></div><p class="muted">优先选择完整的 VALORANT 游戏窗口，画面中准星应位于中央。</p><div id="source-list"></div></dialog>`;
  bind();
  if (state.page === 'report' && state.report && !state.busy) renderEvidence();
  if (state.capture && state.page === 'workspace') {
    const preview = $('#live-preview'); preview.srcObject = state.capture.stream; preview.play().catch(() => {}); tick();
  }
}

function workspaceView() {
  const p = state.profile, recording = Boolean(state.capture);
  return `<section class="page-heading"><div><div class="eyebrow">A LITTLE MORE IN CONTROL</div><h1>你的瞄准工作台<span class="heading-dot">.</span></h1><p>后台记录，赛后复盘。找到更适合你的灵敏度。</p></div><button class="button secondary" id="import-video" ${recording ? 'disabled' : ''}>${icon('upload')}导入录像</button></section>
  <div class="workspace-grid"><section class="recording-panel" aria-labelledby="record-title"><div class="panel-heading"><h2 id="record-title">${icon('monitor')}对局观察</h2><span class="status-pill ${recording ? 'recording' : ''}">${recording ? '<span class="record-dot"></span> 正在记录' : '<span class="status-dot"></span> 等待开始'}</span></div>
    <div class="capture-stage ${recording ? 'is-recording' : ''}">${recording ? '<video id="live-preview" autoplay muted playsinline aria-label="正在记录的画面预览"></video><div class="live-label">REC <span id="elapsed">00:00</span></div>' : `<div class="stage-corner top-left"></div><div class="stage-corner top-right"></div><div class="stage-corner bottom-left"></div><div class="stage-corner bottom-right"></div><span class="stage-axis x-axis"></span><span class="stage-axis y-axis"></span><div class="reticle"><div></div></div><div class="stage-copy"><h3>下一次瞄准，从这里开始</h3><p>选择游戏画面，让 doctorgame 安静地记录。</p></div><span class="stage-tag">POST-GAME ANALYSIS</span><span class="stage-coordinate">X: 0.000 &nbsp; Y: 0.000</span>`}</div>
    <div class="capture-actions"><div><strong>${recording ? '专注游戏，剩下的赛后再看。' : '准备好开始一场对局？'}</strong><p>${recording ? '结束后点击按钮；桌面版可关闭窗口，继续在托盘记录。' : '手动开始与结束 · 不录制麦克风 · 仅赛后分析'}</p></div><button class="button ${recording ? 'danger' : 'primary'}" id="${recording ? 'stop-recording' : 'start-recording'}">${icon(recording ? 'stop' : 'record')}${recording ? '结束并分析' : '开始观察'}</button></div>
  </section><aside class="profile-summary"><div class="panel-heading"><h2>当前玩家档案</h2><button class="text-button" data-nav="profile" aria-label="编辑玩家档案">编辑 ${icon('arrow')}</button></div><div class="profile-game"><span class="game-symbol">V</span><div><strong>无畏契约</strong><span>鼠标 · 基础灵敏度</span></div></div>
    <div class="sensitivity-number"><span>游戏内灵敏度</span><strong>${p.sensitivity.toFixed(3)}<span>SENS</span></strong></div><div class="mini-stats"><div><span>鼠标 DPI</span><strong>${p.dpi}</strong></div><div><span>当前 eDPI</span><strong>${Number((p.dpi * p.sensitivity).toFixed(2))}</strong></div></div><div class="habit-summary"><span>${icon('mouse')}${HABIT_LABELS.aimStyle[p.aimStyle]}</span><span>${HABIT_LABELS.grip[p.grip]}</span></div><p class="profile-footnote">${p.grip === 'unknown' ? '补充握姿和鼠标空间，让复测更贴合你的习惯。' : '分析时会保留这份档案，便于比较调整前后。'}</p>
  </aside></div>
  <section class="workflow-strip" aria-label="工作流程"><div><span>01</span><div><strong>像平时一样打</strong><p>选择窗口后，正常进行对局。</p></div></div><div><span>02</span><div><strong>看见瞄准细节</strong><p>赛后回放，确认有效片段。</p></div></div><div><span>03</span><div><strong>小幅调整，再验证</strong><p>结合你的习惯，比较实际手感。</p></div></div></section>
  <section class="recent-section"><div class="section-heading"><h2>最近的观察</h2><button class="text-button" data-nav="history">全部记录 ${icon('arrow')}</button></div>${state.recordings.length ? recordingRows(state.recordings.slice(0, 3)) : `<div class="empty-history"><div class="empty-icon">${icon('chart')}</div><div><h3>第一份报告，等你开场</h3><p>记录会按对局保存在这里。你也可以先看看报告如何工作。</p></div><button class="button secondary" id="load-demo">体验示例 ${icon('arrow')}</button></div>`}</section>
  <div class="bottom-note">${icon('info')} 原型阶段：颜色识别会产生误检。建议需要回放确认，尚未经过真实对局准确率验证。</div>`;
}

function recordingRows(items) {
  return `<div class="recording-list">${items.map(item => `<button class="recording-row" data-recording="${esc(item.id)}"><span class="recording-icon">${icon('play')}</span><span class="recording-name"><strong>${esc(item.title || '游戏录像')}</strong><small>${new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${item.profile?.sensitivity ?? '—'} SENS · ${item.profile?.dpi ?? '—'} DPI</small></span><span class="recording-duration">${time(item.duration)}</span><span class="recording-tag">${loadReport(item.id) ? '查看报告' : item.status === 'ready' ? '待分析' : '录制中断'}</span>${icon('arrow')}</button>`).join('')}</div>`;
}
function historyView() {
  return `<section class="page-heading"><div><div class="eyebrow">YOUR SESSION LIBRARY</div><h1>对局记录<span class="heading-dot">.</span></h1><p>把感觉留下来，再用证据比较。</p></div><button class="button secondary" id="import-video" ${state.capture ? 'disabled' : ''}>${icon('upload')}导入录像</button></section>${state.recordings.length ? recordingRows(state.recordings) : '<div class="large-empty">还没有对局记录。开始观察或导入一段录像即可。</div>'}<div class="history-actions"><button class="button secondary" id="load-demo" ${state.capture ? 'disabled' : ''}>体验合成示例</button>${window.doctorgame ? '<button class="text-button" id="open-folder">打开录像文件夹</button>' : '<span class="muted">浏览器版录像保存在当前浏览器；清理网站数据会移除它们。</span>'}</div>`;
}

function choiceGroup(name, legend, options, hint) {
  return `<fieldset class="choice-group"><legend>${legend}</legend><div class="choices">${options.map(([value, label, detail]) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${state.profile[name] === value ? 'checked' : ''}><span><strong>${label}</strong>${detail ? `<small>${detail}</small>` : ''}</span></label>`).join('')}</div>${hint ? `<p class="field-hint">${hint}</p>` : ''}</fieldset>`;
}
function profileView() {
  const p = state.profile;
  return `<section class="page-heading"><div><div class="eyebrow">MADE FOR YOUR MOVEMENT</div><h1>理解你的瞄准方式<span class="heading-dot">.</span></h1><p>同一个数值，不同的手感。把影响控制的细节一起记下来。</p></div></section><form id="profile-form" class="profile-form"><div class="form-main"><section class="form-section"><div class="form-section-title"><span>01</span><div><h2>游戏与鼠标</h2><p>填写游戏中实际使用的数值。</p></div></div><div class="fields"><label>鼠标 DPI<input name="dpi" type="number" min="100" max="64000" step="1" value="${p.dpi}" required><small>在鼠标驱动中查看</small></label><label>游戏内灵敏度<input name="sensitivity" type="number" min="0.001" max="10" step="any" value="${p.sensitivity}" required><small>基础灵敏度，暂不包含开镜倍率</small></label><label>敌人高亮颜色<select name="outline">${Object.entries(outlineLabel).map(([key, label]) => `<option value="${key}" ${p.outline === key ? 'selected' : ''}>${label}</option>`).join('')}</select><small>与游戏内设置保持一致</small></label></div></section>
  <section class="form-section"><div class="form-section-title"><span>02</span><div><h2>你的瞄准习惯</h2><p>按大多数时候的动作选择，混合使用很正常。</p></div></div>
    ${choiceGroup('aimStyle', '主要通过哪里移动鼠标？', [['arm', '手臂为主', '前臂带动大部分移动'], ['wrist', '手腕为主', '手腕转动完成大部分移动'], ['mixed', '混合使用', '手臂转向，手腕或手指微调'], ['unknown', '暂不确定', '可以之后再补充']])}
    ${choiceGroup('grip', '平时怎样握住鼠标？', [['palm', '趴握', '手掌大面积贴住鼠背'], ['claw', '抓握', '掌根接触，手指拱起'], ['fingertip', '指握', '主要由指尖接触鼠标'], ['unknown', '暂不确定', '也可能介于两种握法之间']], '这些信息由你填写；游戏画面无法直接判断握姿。')}
  </section><section class="form-section"><div class="form-section-title"><span>03</span><div><h2>空间与控制感</h2><p>记录实际可用的空间，比鼠标垫标称尺寸更有用。</p></div></div><label class="space-field">鼠标左右可移动的总宽度 <span class="muted">（选填，cm）</span><input name="mouseSpace" type="number" min="5" max="150" step="any" placeholder="例如 35" value="${p.mouseSpace ?? ''}"></label>
  ${choiceGroup('comfort', '目前哪种描述最接近你的体验？', [['comfortable', '移动舒适', '大幅转向也有余量'], ['limited', '经常拉到边缘', '转身时需要抬鼠重置'], ['tense', '容易用力过紧', '微调时控制感不稳定'], ['unknown', '暂不确定', '先记录，再观察']])}</section>
  <div class="form-save"><span id="profile-feedback" role="status">保存后用于下一次观察；旧报告保留当时的档案。</span><button class="button primary" type="submit" ${state.capture ? 'disabled' : ''}>${icon('check')}保存玩家档案</button></div></div>
  <aside class="form-aside"><span class="aside-label">WHY IT MATTERS</span><h2>数字之外，<br>还有你的动作。</h2><div class="hand-diagram" aria-hidden="true">${icon('mouse')}<div class="motion-arc"></div><span>↔</span></div><p>手臂、手腕和手指各自承担的动作不同。分析会结合这些习惯，提醒你复测哪些场景。</p><hr><strong>习惯是线索，不是结论。</strong><p>不会仅凭握姿推荐固定灵敏度。是否调整，还需要画面证据和调整前后的表现来验证。</p></aside></form>`;
}

function progressView() {
  const p = state.progress;
  return `<section class="progress-page"><div class="progress-symbol">${icon('target')}</div><div class="eyebrow">LOOKING A LITTLE CLOSER</div><h1>${p?.label || '正在整理瞄准片段'}</h1><p>全程在本机处理。完整对局可能需要较长时间。</p><progress max="1" value="${p?.fraction || 0}" aria-label="分析进度"></progress><div class="progress-detail"><span>${Math.round((p?.fraction || 0) * 100)}%</span><span>${p?.processed ? `已检查 ${p.processed.toLocaleString()} 帧 · ${p.candidates || 0} 个候选片段` : '正在准备录像…'}</span></div>${state.abort ? '<button class="button secondary" id="cancel-analysis">取消分析，保留录像</button>' : '<span class="muted">正在保存，请稍候。</span>'}<div class="bottom-note">${icon('shield')} 分析结果只在赛后展示。</div></section>`;
}

function reportView() {
  const r = state.report;
  if (!r) return '<div class="large-empty">请先从对局记录中打开一份报告。</div>';
  const result = recommend(r.events, r.profile, { demo: r.demo }), usable = r.events.filter(e => e.included), reviewed = r.events.filter(e => e.reviewed && e.included && ['kill', 'death', 'duel'].includes(e.context) && ['overshoot', 'undershoot', 'settled'].includes(e.kind));
  return `<section class="page-heading report-heading"><div><div class="eyebrow">${r.demo ? 'SYNTHETIC DEMO / 合成示例' : 'POST-GAME REVIEW / 赛后复盘'}</div><h1>${r.demo ? '一份报告，如何读懂' : '看清这一次瞄准'}<span class="heading-dot">.</span></h1><p>${r.demo ? '以下轨迹由程序生成，用来体验流程，不代表真实识别效果。' : `${time(r.duration)} 录像 · ${r.processed.toLocaleString()} 帧 · ${r.profile.dpi} DPI / ${r.profile.sensitivity} SENS`}</p></div><button class="button secondary" id="export-report">${icon('download')}导出报告</button></section>
    <div class="report-stats"><div><span>候选瞄准片段</span><strong>${r.events.length}<small>个</small></strong></div><div><span>已确认有效</span><strong>${reviewed.length}<small>/ ${MIN_REVIEWED} 起步样本</small></strong></div><div><span>待回放确认</span><strong>${usable.filter(e => !e.reviewed).length}<small>个</small></strong></div><div><span>本场使用习惯</span><strong class="habit-stat">${HABIT_LABELS.aimStyle[r.profile.aimStyle || 'unknown']}<small>${HABIT_LABELS.grip[r.profile.grip || 'unknown']}</small></strong></div></div>
    <div class="review-grid"><section class="evidence-panel"><div class="panel-heading"><h2>${icon('play')}回放与证据</h2><span class="muted">${r.demo ? '合成轨迹演示' : '请先确认目标与瞄准意图'}</span></div><div id="evidence-stage" class="evidence-stage"></div><div id="evidence-controls" class="evidence-controls"></div><div class="error-chart"><div><strong>目标相对准星的位置</strong><span>沿初始瞄准方向 · 屏幕宽度 %</span></div><svg id="error-plot" viewBox="0 0 640 130" role="img" aria-label="目标相对准星的位置曲线"></svg><p>越过零线仅是候选线索，移动目标、压枪和切换目标都可能影响结果。</p></div></section>
    <aside class="recommendation"><span class="aside-label">YOUR NEXT EXPERIMENT</span><h2>${result.status === 'experiment' ? '试一次，小幅调整' : result.status === 'demo' ? '先看证据，再谈数值' : '先保持，继续观察'}</h2><div class="recommend-value"><strong>${result.candidate}</strong><span>${result.change ? (result.change > 0 ? '+3%' : '−3%') : '保持当前值'}</span></div><span class="confidence-label">${result.confidence}</span><p>${result.reason}</p><div class="recommend-divider"></div><h3>结合你的习惯</h3>${result.habits.notes.slice(0, 4).map(n => `<p class="habit-note">${icon('check')}${n}</p>`).join('')}<h3>下一次怎样验证</h3><ol class="test-plan"><li>保持 DPI、握姿和设备不变。</li><li>${result.change ? `将 ${result.current} 与 ${result.candidate} 交替复测，先留出适应时间。` : '记录更多可比较的瞄准片段，先确认再汇总。'}</li>${result.habits.tasks.map(t => `<li>${t}</li>`).join('')}</ol><p class="small-note">目前是启发式实验建议，不是已验证的最佳灵敏度。</p></aside></div>
    <section class="events-section"><div class="section-heading"><h2>候选片段 <span class="count-badge">${r.events.length}</span></h2><label class="filter-label">筛选<select id="event-filter"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>全部片段</option><option value="pending" ${state.filter === 'pending' ? 'selected' : ''}>待确认</option><option value="reviewed" ${state.filter === 'reviewed' ? 'selected' : ''}>已确认</option><option value="excluded" ${state.filter === 'excluded' ? 'selected' : ''}>已排除</option></select></label></div><div class="events-list">${eventRows()}</div></section>`;
}

function eventRows() {
  const events = state.report.events.map((e, index) => ({ ...e, index })).filter(e => state.filter === 'all' || (state.filter === 'pending' && !e.reviewed && e.included) || (state.filter === 'reviewed' && e.reviewed && e.included) || (state.filter === 'excluded' && !e.included) || e.context === state.filter);
  return events.length ? events.map(e => `<button class="event-row ${state.eventIndex === e.index ? 'selected' : ''}" data-event="${e.index}" aria-pressed="${state.eventIndex === e.index}"><span class="event-number">${String(e.index + 1).padStart(2, '0')}</span><span>${clipTime(e.start)} <span class="muted">— ${clipTime(e.end)}</span></span><span class="kind-label ${e.kind}">${kindLabel[e.kind]}</span><span class="review-state">${!e.included ? '已排除' : e.reviewed ? '已确认' : '待确认'}</span>${icon('play')}</button>`).join('') : `<div class="large-empty">${state.report.events.length ? '此筛选条件下没有片段。' : '没有找到足够清晰的候选片段。请检查高亮颜色、游戏窗口和录像清晰度；当前灵敏度保持不变。'}</div>`;
}

function methodView() {
  return `<section class="page-heading"><div><div class="eyebrow">EVIDENCE BEFORE NUMBERS</div><h1>建议，从哪里来<span class="heading-dot">.</span></h1><p>每一步都可以解释，每一个结论都留有验证的余地。</p></div></section><div class="method-layout"><article class="method-article"><section><span class="method-number">01 / 记录</span><h2>画面 + 玩家习惯</h2><p>手动选择游戏窗口，后台记录无音频录像。DPI、游戏内灵敏度、瞄准方式、握姿、可移动空间和控制感会作为本场档案保存。结束后再分析。</p></section><section><span class="method-number">02 / 寻找线索</span><h2>寻找目标相对准星的变化</h2><p>当前原型每秒抽取 20 帧，按敌人高亮颜色查找候选轮廓，跟踪它相对画面中心的位置。丢失目标、多个候选目标或轨迹跳变的片段会被跳过。</p><p>颜色识别不是训练好的敌人检测模型。技能特效、场景、后坐力、目标移动和观战画面都可能产生误判，因此需要你回放确认。</p></section><section><span class="method-number">03 / 结合习惯</span><h2>用身体动作解释画面</h2><p>手腕为主的玩家需要同时验证微调与大角度转身；手臂为主的玩家需要关注停下后的细微修正。握姿用于保留比较条件，鼠标空间用于检查是否存在转向限制。</p><p>目前没有采用“某种握法 = 某个灵敏度”的硬编码映射。习惯信息会改变解释与复测项目，暂不直接给推荐数值加权。</p></section><section><span class="method-number">04 / 验证</span><h2>先提出假设，再比较设置</h2><p>至少 ${MIN_REVIEWED} 个回放确认的有效片段，且同一偏差方向占比达到 65%、Wilson 区间下界大于 50%，才提出 ±3% 的小幅试用设置。其他情况保持原值。</p><p>这些阈值是原型的工程规则，片段也不一定相互独立；它们不是科学保证或校准后的置信度。真实准确率与改善效果需要用标注录像和交叉复测验证。</p></section></article><aside class="method-aside"><h2>当前版本的边界</h2><ul><li>手动开始与结束记录</li><li>仅分析基础灵敏度</li><li>握姿与动作习惯由玩家填写</li><li>本地保存、赛后反馈</li><li>样本不足时保留原值</li></ul><p>下一步重点：标注真实对局，验证目标识别；引入相机运动补偿，分离敌人移动与玩家转向；比较调整前后的控制表现。</p><div class="bottom-note">${icon('info')}尚未经过 Riot 审核或 Windows 实战兼容性验证。</div></aside></div>`;
}

function renderEvidence() {
  const r = state.report, e = r.events[state.eventIndex];
  const stage = $('#evidence-stage'), controls = $('#evidence-controls');
  if (r.demo) {
    stage.innerHTML = `<div class="demo-label">合成示例 · 非游戏画面</div><svg viewBox="0 0 640 360" aria-label="合成的目标轨迹示意图" role="img"><defs><pattern id="demo-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#344039" stroke-width="0.5"/></pattern></defs><rect width="640" height="360" fill="url(#demo-grid)"/><circle cx="320" cy="180" r="55" fill="none" stroke="#52654b" stroke-dasharray="4 7"/><path d="M305 180h30M320 165v30" stroke="#e9f2e5" stroke-width="2"/>${e ? `<polyline points="${e.points.map(p => `${p.x * 640},${p.y * 360}`).join(' ')}" fill="none" stroke="#c2f279" stroke-width="2"/>${e.points.map((p, i) => `<circle cx="${p.x * 640}" cy="${p.y * 360}" r="${i === 0 ? 6 : 3}" fill="${i === 0 ? '#c2f279' : '#90aa7a'}"/>`).join('')}` : ''}</svg>`;
  } else if (state.mediaUrl) {
    stage.innerHTML = `<video id="replay" src="${esc(state.mediaUrl)}" controls muted playsinline preload="auto" aria-label="游戏录像回放"></video>`;
    const player = $('#replay'); player.addEventListener('loadedmetadata', () => { if (e) player.currentTime = Math.max(0, e.start - (e.source === 'manual' ? 0 : 2.5)); }, { once: true });
  } else stage.innerHTML = '<p>录像未加载。请从对局记录重新打开。</p>';
  if (!e) { controls.innerHTML = '<p class="muted">这段录像没有候选片段。可使用播放器查看完整录像，并标记关键事件。</p>'; $('#error-plot').innerHTML = ''; attachReplayTools(null); return; }
  controls.innerHTML = `<div class="evidence-caption"><span><strong>片段 ${String(state.eventIndex + 1).padStart(2, '0')}</strong> · ${clipTime(e.start)} — ${clipTime(e.end)}</span><span class="kind-label ${e.kind}">${kindLabel[e.kind]}</span></div><div class="review-controls"><label>回放后的分类<select id="review-kind">${Object.entries(kindLabel).map(([value, label]) => `<option value="${value}" ${e.kind === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="button small secondary" id="exclude-event">${e.included ? '排除此片段' : '恢复此片段'}</button><button class="button small primary" id="confirm-event" ${!e.included ? 'disabled' : ''}>${icon('check')}${e.reviewed ? '已确认 · 更新' : '确认有效'}</button></div><p class="review-hint">确认时请排除压枪、观战、切换目标、明显敌人移动和错误轮廓。</p>`;
  $('.review-controls').insertAdjacentHTML('afterbegin', `<label>这是哪种场景？<select id="review-context">${Object.entries(SCENE_LABELS).map(([value, label]) => `<option value="${value}" ${value === (e.context || 'unknown') ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`);
  controls.insertAdjacentHTML('beforeend', `<div class="scene-guidance"><strong>这类片段看什么</strong><p id="scene-guidance-text">${sceneGuidance[e.context || 'unknown']}</p></div>`);
  $('#review-context').addEventListener('change', event => { $('#scene-guidance-text').textContent = sceneGuidance[event.target.value]; });
  if (e.motion) {
    $('.error-chart strong').textContent = '背景位移估计 · 水平方向';
    $('.error-chart span').textContent = '屏幕宽度 % · 视角运动的近似';
    $('.error-chart p').textContent = `此片段观察到 ${e.motion.reversals} 次方向反转，位移速度中位数约 ${e.motion.medianSpeed} 像素/秒（640 像素分析画面）。角色走动也会影响画面；不能据此判断手抖或直接调整灵敏度。`;
    $('.review-hint').textContent = '先确认这确实是预瞄片段。主动检查不同点位也会转向，反转多不一定意味着控制差。';
    $('#review-kind').disabled = true;
  }
  const max = Math.max(5, ...e.error.map(Math.abs)), y = v => 66 - v / max * 49;
  $('#error-plot').innerHTML = `<line x1="34" y1="66" x2="625" y2="66" stroke="#9da99c" stroke-dasharray="3 5"/><text x="4" y="70" fill="#5c685f" font-size="12">0</text><polyline points="${e.error.map((v, i) => `${34 + i / Math.max(1, e.error.length - 1) * 590},${y(v)}`).join(' ')}" fill="none" stroke="#437330" stroke-width="2.5"/><text x="34" y="125" fill="#5c685f" font-size="11">${time(e.start)}</text><text x="584" y="125" fill="#5c685f" font-size="11">${time(e.end)}</text>`;
  if (e.kind === 'observation') {
    $('#review-kind').disabled = true;
    $('#error-plot').innerHTML = '';
    $('.error-chart strong').textContent = '该片段尚无量化轨迹';
    $('.error-chart span').textContent = '玩家手动标记';
    $('.error-chart p').textContent = '已保存事件位置和前后过程。没有可靠的轨迹测量，所以不计入灵敏度建议的有效样本。';
  }
  attachReplayTools(e);
  $('#confirm-event').onclick = () => {
    const context = $('#review-context').value;
    if (context === 'unknown') { notify('请先确认这是击杀、被击杀、对枪未击杀还是预瞄场景。', true); $('#review-context').focus(); return; }
    e.kind = e.kind === 'observation' ? 'observation' : e.motion ? 'preaim' : $('#review-kind').value; e.context = context; e.reviewed = true;
    persistReport(); render(); notify('片段已确认，报告已更新。');
  };
  $('#exclude-event').onclick = () => { e.included = !e.included; e.reviewed = false; persistReport(); render(); notify(e.included ? '片段已恢复，请重新确认。' : '已排除此片段，可随时恢复。'); };
}

function attachReplayTools(event) {
  const player = $('#replay');
  if (!player) return;
  const controls = $('#evidence-controls');
  if (event) {
    controls.insertAdjacentHTML('afterbegin', `<div class="playback-tools"><button class="button small secondary" id="replay-context">${icon('play')}回放前后过程</button><label>速度<select id="playback-rate"><option value="1">1× 正常</option><option value="0.5">0.5× 慢放</option><option value="0.25">0.25× 慢放</option></select></label><button class="text-button" id="next-clip" ${state.eventIndex === state.report.events.length - 1 ? 'disabled' : ''}>下一片段 ${icon('arrow')}</button></div>`);
    let clipEnd = null;
    $('#replay-context').onclick = async () => {
      player.currentTime = Math.max(0, event.start - (event.source === 'manual' ? 0 : 2.5));
      clipEnd = Math.min(state.report.duration, event.end + (event.source === 'manual' ? 0 : 1));
      try { await player.play(); } catch (error) { notify(`播放失败：${error.message}`, true); }
    };
    player.addEventListener('timeupdate', () => { if (clipEnd !== null && player.currentTime >= clipEnd) { player.pause(); clipEnd = null; } });
    $('#playback-rate').onchange = event => { player.playbackRate = Number(event.target.value); };
    $('#next-clip').onclick = () => { state.eventIndex++; render(); $('#replay-context')?.focus(); };
  }
  controls.insertAdjacentHTML('beforeend', `<details class="manual-marker"><summary>补充漏掉的关键事件</summary><p>播放到事件发生处后标记，保留前 3 秒和后 1 秒的过程。</p><form id="marker-form"><label>事件类型<select name="context" aria-label="手动标记的事件类型">${Object.entries(SCENE_LABELS).filter(([key]) => key !== 'unknown').map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><button class="button small secondary" type="submit">标记当前播放位置</button></form></details>`);
  $('#marker-form').onsubmit = event => {
    event.preventDefault();
    const at = player.currentTime, context = new FormData(event.currentTarget).get('context');
    if (!Number.isFinite(at) || at < 0 || at > state.report.duration) { notify('请先播放到要标记的位置。', true); return; }
    const duplicate = state.report.events.findIndex(e => e.source === 'manual' && e.context === context && Math.abs(e.at - at) < 0.5);
    if (duplicate >= 0) { state.eventIndex = duplicate; render(); notify('这个位置已有相同事件，已为你打开。'); return; }
    const mark = { id: crypto.randomUUID(), at, start: Math.max(0, at - 3), end: Math.min(state.report.duration, at + 1), context, kind: 'observation', source: 'manual', reviewed: true, included: true, points: [], error: [], corrections: null, acquisitionMs: null };
    state.report.events.push(mark); state.report.events.sort((a, b) => a.start - b.start);
    state.eventIndex = state.report.events.findIndex(e => e.id === mark.id); state.filter = 'all'; persistReport(); render();
    notify('关键事件已标记。手动标记只用于复盘，不计入量化建议样本。');
  };
}

function persistReport() { if (!state.report.demo) { try { saveReport(state.report); } catch { notify('报告暂时无法保存：本地存储空间可能不足，请先导出。', true); } } }
function bind() {
  $('.brand').setAttribute('aria-label', 'doctorgame 灵敏度实验室首页');
  $('#video-file').hidden = true;
  $('#notice').removeAttribute('role');
  document.querySelectorAll('aside').forEach((element, index) => element.setAttribute('aria-label', element.querySelector('h2')?.textContent || `工作空间导航 ${index + 1}`));
  if ($('#event-filter')) {
    for (const [value, label] of Object.entries(SCENE_LABELS)) if (value !== 'unknown') $('#event-filter').add(new Option(label, value, false, state.filter === value));
    document.querySelectorAll('[data-event]').forEach(button => {
      const e = state.report.events[Number(button.dataset.event)];
      const scene = document.createElement('span'); scene.className = 'scene-label'; scene.textContent = SCENE_LABELS[e.context || 'unknown'];
      button.querySelector('.kind-label').before(scene);
    });
  }
  if (state.page === 'method') $('.method-article')?.insertAdjacentHTML('beforeend', `<section><span class="method-number">05 / 场景分开看</span><h2>击杀、被击杀、无击杀对枪与预瞄</h2><p>片段按这四种场景回放确认。当前版本不会根据颜色轨迹自动宣称发生击杀或死亡；真实结果仍由玩家选择。后续需要用游戏界面事件识别定位时间点，并连同事件前的瞄准过程一起分析。</p><p>预瞄候选使用多个背景区域的位移一致性估计视角运动，显示方向反转次数和位移速度。低纹理、快速甩动和不一致运动会被跳过。它是低频视角变化的近似，无法直接测量手部平滑度，也暂不参与推荐数值计算。</p></section>`);
  document.querySelectorAll('[data-nav]').forEach(button => button.onclick = event => { event.preventDefault(); navigate(button.dataset.nav); });
  document.querySelectorAll('.nav-item').forEach(button => button.setAttribute('aria-label', navItems.find(n => n[0] === button.dataset.nav)[2]));
  $('#start-recording')?.addEventListener('click', startRecording);
  $('#stop-recording')?.addEventListener('click', () => state.capture?.stop());
  $('#stop-banner')?.addEventListener('click', () => state.capture?.stop());
  $('#import-video')?.addEventListener('click', () => $('#video-file').click());
  $('#video-file')?.addEventListener('change', importVideo);
  $('#load-demo')?.addEventListener('click', () => { if (state.capture) return; releaseMedia(); state.report = makeDemo(state.profile); state.eventIndex = 0; state.filter = 'all'; navigate('report'); });
  $('#profile-form')?.addEventListener('submit', event => { event.preventDefault(); try { const data = Object.fromEntries(new FormData(event.currentTarget)); const updated = validateProfile(data); saveProfile(updated); state.profile = updated; $('#profile-feedback').textContent = '已保存。下一次观察将使用这份档案。'; notify('玩家档案已保存。'); } catch (error) { notify(error.message, true); } });
  $('#cancel-analysis')?.addEventListener('click', () => state.abort?.abort());
  $('#export-report')?.addEventListener('click', exportReport);
  $('#event-filter')?.addEventListener('change', event => { state.filter = event.target.value; render(); });
  document.querySelectorAll('[data-recording]').forEach(button => button.onclick = () => openRecording(button.dataset.recording));
  document.querySelectorAll('[data-event]').forEach(button => button.onclick = () => { state.eventIndex = Number(button.dataset.event); render(); $('#evidence-stage').scrollIntoView({ block: 'nearest' }); });
  $('#open-folder')?.addEventListener('click', async () => { const error = await window.doctorgame.openFolder(); if (error) notify(error, true); });
}

async function startRecording() {
  if (state.capture || state.busy) return;
  if (!navigator.mediaDevices?.getDisplayMedia) { notify('请在桌面版或支持屏幕录制的 Chrome / Edge 中打开。', true); return; }
  if (window.doctorgame) {
    const dialog = $('#source-dialog'); dialog.showModal(); $('#source-list').textContent = '正在查找窗口…';
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
  try {
    const button = $('#start-recording'); if (button) button.disabled = true;
    state.capture = await beginCapture({ ...state.profile }, async item => {
      clearInterval(elapsedTimer); state.capture = null; await refreshRecordings(); releaseMedia(); state.mediaUrl = await storage.url(item); state.item = item; await runAnalysis(item);
    }, async (error, terminal) => {
      if (terminal) { clearInterval(elapsedTimer); state.capture = null; await setBusy(false); render(); }
      notify(error.message, true);
    });
    await window.doctorgame?.setBusy(true); state.page = 'workspace'; render(); elapsedTimer = setInterval(tick, 1000);
    notify('已开始记录。打完后点击“结束并分析”。');
  } catch (error) { notify(error.name === 'NotAllowedError' ? '未获得录屏权限。可以重新选择窗口，或在系统设置中允许录屏。' : `无法开始记录：${error.message}`, true); const button = $('#start-recording'); if (button) button.disabled = false; }
}
function tick() { const target = $('#elapsed'); if (target && state.capture) target.textContent = time((performance.now() - state.capture.startedAt) / 1000); }

async function importVideo(event) {
  const file = event.target.files?.[0]; if (!file || state.capture || state.busy) return;
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
  if (state.capture || state.busy) { notify('请先结束当前记录或分析。', true); return; }
  const item = state.recordings.find(r => r.id === id); if (!item) return;
  try {
    releaseMedia(); state.mediaUrl = await storage.url(item); state.item = item;
    const report = loadReport(id);
    if (report) { state.report = report; state.eventIndex = 0; state.filter = 'all'; navigate('report'); }
    else await runAnalysis(item);
  } catch (error) { notify(`打开录像失败：${error.message}`, true); }
}

async function runAnalysis(item) {
  await setBusy(true); state.abort = new AbortController(); state.progress = { fraction: 0 }; state.page = 'report'; render();
  try {
    state.report = await analyzeVideo(state.mediaUrl, item, progress => { state.progress = progress; const bar = $('progress'); if (bar) bar.value = progress.fraction; const detail = $('.progress-detail'); if (detail) detail.innerHTML = `<span>${Math.round(progress.fraction * 100)}%</span><span>已检查 ${progress.processed.toLocaleString()} 帧 · ${progress.candidates} 个候选片段</span>`; }, state.abort.signal);
    state.eventIndex = 0; state.filter = 'all'; persistReport();
    state.notice = { message: '分析完成。请先回放确认候选片段。', error: false };
  } catch (error) {
    state.page = 'history'; state.notice = { message: error.name === 'AbortError' ? '分析已取消，录像仍保留在对局记录中。' : `分析未完成：${error.message} 录像已保留，可重新打开重试。`, error: error.name !== 'AbortError' };
  } finally { await setBusy(false); state.abort = null; render(); }
}
function exportReport() {
  const report = { ...state.report, recommendation: recommend(state.report.events, state.report.profile, { demo: state.report.demo }) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `doctorgame-${report.demo ? 'demo' : report.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('已导出 JSON 报告。');
}

window.doctorgame?.onStop(() => state.capture?.stop());
window.addEventListener('beforeunload', event => { if (state.capture || state.busy) { event.preventDefault(); event.returnValue = ''; } });
await refreshRecordings().catch(error => { state.notice = { message: `无法加载本地记录：${error.message}`, error: true }; });
render();
