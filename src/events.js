// Local HUD kill-feed detection. This is an observation layer, not a trained
// combat detector and never a quantitative sample by itself.
//
// The OCR is deliberately low-frequency: a 1 Hz scan of a fixed VALORANT
// kill-feed region, followed by a short finer pass around new rows. It never
// OCRs every analysis frame and never reads game memory or sends video anywhere.
import { HUD_PRE_ROLL_SECONDS, HUD_POST_ROLL_SECONDS } from './events-shared.js';

export { HUD_PRE_ROLL_SECONDS, HUD_POST_ROLL_SECONDS } from './events-shared.js';

export const HUD_DETECTOR_VERSION = 'hud-feed-ocr-0.1';
export const HUD_MODEL = 'tesseract.js@7.0.0 · eng+chi_sim · 4.0.0_best_int';
export const HUD_SAMPLE_SECONDS = 1;
export const HUD_REFINE_WINDOW_SECONDS = 1.2;
export const HUD_REFINE_STEP_SECONDS = 0.4;
export const HUD_ROW_TTL_SECONDS = 8;
export const HUD_MIN_OCR_CONFIDENCE = 55;
// Normalized coordinates of the right-top kill-feed area. Intentionally broad
// enough for 16:9, 16:10 and letterboxed captures; crop is upscaled for OCR.
export const HUD_REGION = Object.freeze({ x: 0.68, y: 0.07, width: 0.31, height: 0.42 });
export const HUD_REJECT_REASONS = Object.freeze({
  NAME_MISSING: 'name-missing',
  NAME_MIDDLE: 'name-not-at-edge',
  NAME_BOTH_SIDES: 'name-on-both-sides',
  NO_OPPONENT: 'no-opponent',
  LOW_CONFIDENCE: 'low-confidence',
  ASSIST_TEXT: 'assist-or-extra-text',
  LINE_TOO_SMALL: 'line-too-small'
});

export function normalizeName(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[\s\u200b-\u200d\uFEFF]+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function lineWords(line) {
  if (Array.isArray(line.words) && line.words.length) return line.words.map(word => ({ text: String(word.text ?? ''), confidence: Number(word.confidence ?? line.confidence ?? 0), bbox: word.bbox }));
  return String(line.text ?? '').trim().split(/\s+/).filter(Boolean).map(text => ({ text, confidence: Number(line.confidence ?? 0), bbox: null }));
}

function ocrNoiseSuffix(value, target) {
  if (!value.startsWith(target)) return false;
  const suffix = value.slice(target.length);
  return suffix.length > 0 && suffix.length <= 3 && /^(.)\1*$/.test(suffix);
}
function ocrNoisePrefix(value, target) {
  if (!value.endsWith(target)) return false;
  const prefix = value.slice(0, value.length - target.length);
  return prefix.length > 0 && prefix.length <= 3 && /^(.)\1*$/.test(prefix);
}
function sequenceMatch(values, target, fromStart) {
  if (!values.length || !target) return 0;
  if (fromStart) {
    for (let count = 1; count <= values.length; count++) {
      const combined = values.slice(0, count).join('');
      if (combined === target || ocrNoiseSuffix(combined, target)) return count;
    }
  } else {
    for (let count = 1; count <= values.length; count++) {
      const combined = values.slice(-count).join('');
      if (combined === target || ocrNoisePrefix(combined, target)) return count;
    }
  }
  return 0;
}
function playerUsesCjk(name) { return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(name || '')); }

// A kill-feed row is a ranked statement: killer on the left, victim on the
// right. Matching only at an edge prevents a teammate, an assist icon, or a
// player name appearing in the middle of an unrelated string from being counted.
export function classifyHudLine(line, playerName, { minConfidence = HUD_MIN_OCR_CONFIDENCE } = {}) {
  const identity = String(playerName ?? '').trim();
  const identityNorm = normalizeName(identity);
  if (identityNorm.length < 2) return { status: 'reject', reason: HUD_REJECT_REASONS.NAME_MISSING };
  const text = String(line?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { status: 'reject', reason: HUD_REJECT_REASONS.LINE_TOO_SMALL };
  if (/\b(?:assist|assists|assisting|助攻)\b/i.test(text)) return { status: 'reject', reason: HUD_REJECT_REASONS.ASSIST_TEXT };
  const bboxHeight = Number(line?.bbox?.y1) - Number(line?.bbox?.y0);
  if (Number.isFinite(bboxHeight) && bboxHeight > 0 && (bboxHeight < 8 || bboxHeight > 220)) return { status: 'reject', reason: HUD_REJECT_REASONS.LINE_TOO_SMALL };
  const words = lineWords(line);
  if (words.length < 2) return { status: 'reject', reason: HUD_REJECT_REASONS.NO_OPPONENT };
  const values = words.map(word => normalizeName(word.text));
  const confidence = Number(line?.confidence ?? words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length));
  if (!Number.isFinite(confidence) || confidence < minConfidence) return { status: 'reject', reason: HUD_REJECT_REASONS.LOW_CONFIDENCE, confidence };
  const prefix = sequenceMatch(values, identityNorm, true);
  const suffix = sequenceMatch(values, identityNorm, false);
  const both = Boolean(prefix && suffix && prefix + suffix > values.length);
  const left = prefix > 0 && prefix < values.length ? values.slice(0, prefix).join('') : '';
  const right = suffix > 0 && suffix < values.length ? values.slice(-suffix).join('') : '';
  const side = prefix && !suffix ? 'left' : suffix && !prefix ? 'right' : null;
  if (both || (prefix && suffix)) return { status: 'reject', reason: HUD_REJECT_REASONS.NAME_BOTH_SIDES, confidence };
  if (!side) {
    const middle = values.join('').includes(identityNorm);
    return { status: 'reject', reason: middle ? HUD_REJECT_REASONS.NAME_MIDDLE : HUD_REJECT_REASONS.NAME_MISSING, confidence };
  }
  const other = side === 'left' ? values.slice(prefix).join('') : values.slice(0, values.length - suffix).join('');
  if (!other) return { status: 'reject', reason: HUD_REJECT_REASONS.NO_OPPONENT, confidence };
  const leftWords = side === 'left' ? words.slice(0, prefix) : words.slice(0, values.length - suffix);
  const rightWords = side === 'right' ? words.slice(-suffix) : words.slice(prefix);
  return {
    status: 'match', side, confidence: Math.round(confidence) / 100, ocrConfidence: Math.round(confidence),
    context: side === 'left' ? 'kill' : 'death',
    rowKey: `${side}|${values.join('')}`,
    lineText: text,
    leftText: leftWords.map(word => word.text).join(' '),
    rightText: rightWords.map(word => word.text).join(' '),
    otherText: other,
    matchedName: identity,
    words: words.map(word => word.text)
  };
}

export function parseHudLines(lines, playerName, options = {}) {
  const observations = [], rejected = {};
  for (const line of lines || []) {
    const result = classifyHudLine(line, playerName, options);
    if (result.status === 'match') observations.push(result);
    else rejected[result.reason] = (rejected[result.reason] || 0) + 1;
  }
  // Duplicate lines in one OCR result describe one row, not multiple kills.
  const unique = new Map();
  for (const observation of observations) if (!unique.has(observation.rowKey)) unique.set(observation.rowKey, observation);
  return { observations: [...unique.values()], rejected };
}

export function flattenOcrLines(blocks) {
  const lines = [];
  for (const block of blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) lines.push(line);
  return lines;
}

export function parseHudPayload(data, playerName, options = {}) {
  const lines = flattenOcrLines(data?.blocks);
  if (!lines.length && data?.text) {
    return parseHudLines(String(data.text).split(/\r?\n/).filter(Boolean).map(text => ({ text, confidence: data.confidence, words: [] })), playerName, options);
  }
  return parseHudLines(lines, playerName, options);
}

export class HudFeedTracker {
  constructor({ ttl = HUD_ROW_TTL_SECONDS, preRoll = HUD_PRE_ROLL_SECONDS, postRoll = HUD_POST_ROLL_SECONDS } = {}) {
    this.ttl = ttl; this.preRoll = preRoll; this.postRoll = postRoll;
    this.active = new Map(); this.events = [];
    this.sequence = 0;
  }
  expire(t) {
    for (const [key, event] of this.active) if (t - event.lastSeen > this.ttl) this.active.delete(key);
  }
  observe(observations, t, { allowCreate = true } = {}) {
    this.expire(t);
    const seen = new Set();
    let created = 0, matched = 0;
    for (const observation of observations || []) {
      if (!observation?.rowKey || seen.has(observation.rowKey)) continue;
      seen.add(observation.rowKey);
      let event = this.active.get(observation.rowKey);
      if (event) {
        event.firstSeen = Math.min(event.firstSeen, t);
        event.lastSeen = Math.max(event.lastSeen, t);
        event.lastScan = t;
        event.scanCount++;
        event.confidence = Math.max(event.confidence, observation.confidence || 0);
        event.ocrConfidence = Math.max(event.ocrConfidence || 0, observation.ocrConfidence || 0);
        matched++;
      } else if (allowCreate) {
        event = {
          id: `hud-${++this.sequence}`,
          at: t, firstSeen: t, lastSeen: t, lastScan: t,
          start: Math.max(0, t - this.preRoll), end: Math.min(999999, t + this.postRoll),
          kind: 'observation', context: observation.context,
          source: 'hud-ocr', reviewed: false, included: true,
          confidence: observation.confidence || 0, ocrConfidence: observation.ocrConfidence || 0,
          scanCount: 1,
          points: [], error: [], corrections: null, acquisitionMs: null,
          evidence: {
            detector: HUD_DETECTOR_VERSION, model: HUD_MODEL,
            participantSide: observation.side, rowText: observation.lineText,
            matchedName: observation.matchedName || '', otherText: observation.otherText,
            leftText: observation.leftText || '', rightText: observation.rightText || '',
            rowsInSample: observations.length, firstSeen: t, lastSeen: t,
            region: { ...HUD_REGION }
          },
          rowKey: observation.rowKey
        };
        this.active.set(observation.rowKey, event);
        this.events.push(event);
        created++;
      }
    }
    return { created, matched };
  }
  finish(duration) {
    for (const event of this.events) {
      event.start = Math.max(0, event.firstSeen - this.preRoll);
      event.end = Math.min(duration, event.lastSeen + this.postRoll);
      event.evidence.firstSeen = event.firstSeen;
      event.evidence.lastSeen = event.lastSeen;
      event.evidence.scanCount = event.scanCount;
    }
    this.events.sort((a, b) => a.firstSeen - b.firstSeen);
    this.events.forEach((event, index) => { event.id = `hud-${index + 1}`; });
    return this.events;
  }
}

// Time proximity is context for navigation only. It never copies trajectory
// points, marks the trajectory reviewed, or turns an observation into evidence.
export function associateHudEvents(hudEvents, trajectoryEvents, windowSeconds = 3) {
  const trajectory = (trajectoryEvents || []).filter(event => event && event.id && Number.isFinite(event.start) && Number.isFinite(event.end));
  for (const event of hudEvents || []) {
    let best = null;
    for (const candidate of trajectory) {
      if (candidate.start <= event.at + windowSeconds && candidate.end >= event.at - windowSeconds) {
        const delta = Math.abs((candidate.start + candidate.end) / 2 - event.at);
        if (!best || delta < best.delta) best = { candidate, delta };
      }
    }
    if (best) {
      event.relatedEventId = best.candidate.id;
      event.evidence = { ...event.evidence, relatedEventId: best.candidate.id, relatedDeltaSeconds: Math.round(best.delta * 10) / 10, relatedOnlyForContext: true };
    }
  }
  return hudEvents;
}

export function hudSampleTimes(duration, interval = HUD_SAMPLE_SECONDS) {
  const times = [];
  if (!Number.isFinite(duration) || duration <= 0) return times;
  for (let t = 0.6; t < duration - 0.15; t += interval) times.push(Math.round(t * 1000) / 1000);
  return times.length ? times : [Math.max(0, Math.min(0.6, duration / 2))];
}

export function hudRefineTimes(firstSeen, duration) {
  const times = [];
  const start = Math.max(0, firstSeen - HUD_REFINE_WINDOW_SECONDS);
  const end = Math.min(duration - 0.05, firstSeen + 0.45);
  for (let t = start; t <= end; t += HUD_REFINE_STEP_SECONDS) times.push(Math.round(t * 1000) / 1000);
  return times;
}

const abortError = () => new DOMException('HUD 识别已取消。', 'AbortError');
function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
function seekVideo(video, t, signal) {
  return withAbort(new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(); };
    const cleanup = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', failed); };
    const done = () => finish(); const failed = () => finish(new Error('无法读取这段录像的画面。'));
    const timer = setTimeout(() => finish(new Error('等待录像跳转超时。')), 8000);
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', failed, { once: true });
    try { video.currentTime = Math.max(0, Math.min(video.duration || t, t)); } catch (error) { finish(error); }
  }), signal);
}
async function openLocalOcr(playerName, signal, onProgress) {
  const Tesseract = (await withAbort(import(new URL('../assets/ocr/tesseract.esm.min.js', import.meta.url).href), signal)).default;
  const base = window.doctorgame ? 'doctorgame-asset://ocr/' : new URL('../assets/ocr/', import.meta.url).href;
  const languages = playerUsesCjk(playerName) ? ['chi_sim', 'eng'] : ['eng'];
  let worker;
  try {
    worker = await withTimeout(withAbort(Tesseract.createWorker(languages, 1, {
      workerPath: base + 'worker.min.js', corePath: base + 'core/', langPath: base + 'lang',
      // Browser can load the worker directly; Electron loads file/custom-scheme
      // assets through a blob worker to avoid a cross-origin Worker constructor.
      workerBlobURL: Boolean(window.doctorgame), cacheMethod: 'none', cachePath: 'doctorgame-ocr',
      logger: message => { if (message?.status) onProgress?.({ phase: message.status === 'recognizing text' ? '识别 HUD 文字' : '加载本地 OCR', fraction: Math.min(0.12, Number(message.progress || 0) * 0.12) }); }
    }), signal), 90000, '本地 OCR 初始化超时；可以重试或先手动标记。');
    await withTimeout(withAbort(worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6', user_defined_dpi: '300' }), signal), 20000, 'OCR 参数初始化超时。');
    if (signal?.aborted) throw abortError();
    return worker;
  } catch (error) {
    try { await worker?.terminate?.(); } catch { /* worker already gone */ }
    throw error;
  }
}
function drawHudCrop(video, canvas) {
  const sx = Math.floor(video.videoWidth * HUD_REGION.x), sy = Math.floor(video.videoHeight * HUD_REGION.y);
  const sw = Math.max(1, Math.floor(video.videoWidth * HUD_REGION.width)), sh = Math.max(1, Math.floor(video.videoHeight * HUD_REGION.height));
  const scale = Math.max(1, Math.min(3, 1100 / sw));
  canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'grayscale(1) contrast(1.25)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';
  return canvas;
}
function makeStandaloneVideo(url) {
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
  video.src = url;
  return video;
}

// Returns a report-safe status. OCR failure, a missing name and no HUD rows are
// all recoverable states: the caller keeps the recording and trajectory report.
export async function detectHudEvents(source, { duration, playerName, signal, interval = HUD_SAMPLE_SECONDS, onProgress } = {}) {
  const identity = String(playerName ?? '').trim();
  const base = {
    detector: HUD_DETECTOR_VERSION, model: HUD_MODEL, identity: { name: identity, normalized: normalizeName(identity) },
    status: 'name-required', events: [], scans: 0, ocrRuns: 0, candidates: 0, rejected: {}, elapsedMs: 0,
    intervalSeconds: interval, region: { ...HUD_REGION }, message: '未填写本局玩家名，未运行 HUD 识别。可以补填后重新识别。'
  };
  if (normalizeName(identity).length < 2) return base;
  let video = source, ownVideo = false;
  if (typeof source === 'string') { video = makeStandaloneVideo(source); ownVideo = true; }
  if (!(video instanceof HTMLVideoElement)) return { ...base, status: 'error', message: '没有可读取的录像画面，HUD 识别未运行。' };
  const canvas = document.createElement('canvas');
  let worker, tracker = new HudFeedTracker();
  const startedAt = performance.now();
  let scans = 0, ocrRuns = 0;
  const rejected = {};
  try {
    if (ownVideo) await withAbort(new Promise((resolve, reject) => { video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', () => reject(new Error('无法打开录像画面。')), { once: true }); }), signal);
    if (!video.videoWidth || !video.videoHeight) throw new Error('录像没有可解码画面。');
    onProgress?.({ phase: '加载本地 OCR', fraction: 0.05, scans, ocrRuns, candidates: 0 });
    worker = await openLocalOcr(identity, signal, onProgress);
    const realDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : duration;
    const times = hudSampleTimes(realDuration, interval);
    const scanAt = async (t, allowCreate = true) => {
      if (signal?.aborted) throw abortError();
      await seekVideo(video, t, signal);
      drawHudCrop(video, canvas);
      const { data } = await withTimeout(withAbort(worker.recognize(canvas, {}, { text: true, blocks: true }), signal), 30000, 'HUD OCR 单帧超时。');
      scans++; ocrRuns++;
      const parsed = parseHudPayload(data, identity);
      for (const [reason, count] of Object.entries(parsed.rejected)) rejected[reason] = (rejected[reason] || 0) + count;
      tracker.observe(parsed.observations, t, { allowCreate });
      return parsed.observations.length;
    };
    for (let index = 0; index < times.length; index++) {
      if (signal?.aborted) throw abortError();
      await scanAt(times[index]);
      onProgress?.({ phase: '扫描 HUD 击杀信息', fraction: 0.12 + 0.7 * ((index + 1) / times.length), scans, ocrRuns, candidates: tracker.events.length });
    }
    // Finer local pass around each new row; never a 20 fps OCR loop.
    for (const event of [...tracker.events]) {
      for (const t of hudRefineTimes(event.firstSeen, realDuration)) {
        if (signal?.aborted) throw abortError();
        await scanAt(t, false);
      }
    }
    tracker.finish(realDuration);
    onProgress?.({ phase: '整理 HUD 候选', fraction: 0.96, scans, ocrRuns, candidates: tracker.events.length });
    return {
      ...base, status: tracker.events.length ? 'complete' : 'zero', events: tracker.events,
      scans, ocrRuns, candidates: tracker.events.length, rejected,
      duration: realDuration, elapsedMs: Math.round(performance.now() - startedAt),
      message: tracker.events.length ? `识别到 ${tracker.events.length} 个本人 HUD 候选，等待回放确认。` : 'HUD 中没有找到可靠的本人击杀/死亡行；可以手动标记，或检查玩家名后重试。'
    };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
    return { ...base, status: 'error', scans, ocrRuns, candidates: 0, rejected, elapsedMs: Math.round(performance.now() - startedAt), message: `HUD 自动识别未完成：${error.message} 录像和已有报告仍保留，可以重试或手动标记。` };
  } finally {
    try { await worker?.terminate?.(); } catch { /* worker already gone */ }
    if (ownVideo) { video.removeAttribute('src'); video.load(); }
  }
}
