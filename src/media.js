import { AimTracker, detectTargets, estimateCameraMotion, grayscale, summarizeMotion, ANALYSIS_VERSION } from './analysis.js';
import { detectHudEvents, associateHudEvents } from './events.js';
import { storage } from './storage.js';

// A live MediaStreamTrack is not proof of a picture: macOS native capture was
// observed with a live track but videoWidth=0 and a 0-byte file. Only advertise
// recording after a decodable frame actually arrives.
export const CAPTURE_FRAME_TIMEOUT_MS = 8000;

const abortError = () => new DOMException('已取消等待窗口画面。', 'AbortError');
const stopStream = stream => { try { stream?.getTracks().forEach(track => track.stop()); } catch { /* already stopped */ } };
const noFramesError = detail => Object.assign(new Error(detail), { code: 'NO_FRAMES' });

export function waitForFirstVideoFrame(stream, { timeout = CAPTURE_FRAME_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    let settled = false, timer, poll;
    const cleanup = () => {
      settled = true; clearTimeout(timer); clearInterval(poll);
      signal?.removeEventListener('abort', onAbort);
      video.removeEventListener('loadeddata', check); video.removeEventListener('resize', check);
      video.pause(); video.srcObject = null;
    };
    const succeed = () => { if (settled) return; const frame = { width: video.videoWidth, height: video.videoHeight }; cleanup(); resolve(frame); };
    const fail = error => { if (settled) return; cleanup(); reject(error); };
    const onAbort = () => fail(abortError());
    const check = () => {
      const track = stream.getVideoTracks?.()[0];
      if (!track || track.readyState !== 'live') { fail(noFramesError('窗口画面已结束，没有收到可解码画面。')); return; }
      if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) succeed();
    };
    timer = setTimeout(() => {
      const track = stream.getVideoTracks?.()[0];
      const detail = !track ? '选中的窗口没有视频轨道。' : track.readyState !== 'live' ? '窗口画面已结束。' : '窗口没有输出可解码画面。';
      fail(noFramesError(`${detail} 等待了 ${Math.round(timeout / 1000)} 秒仍未收到画面，录制没有开始。`));
    }, timeout);
    poll = setInterval(check, 100);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    video.addEventListener('loadeddata', check);
    video.addEventListener('resize', check);
    video.srcObject = stream;
    // play() can stay pending forever for a track with no frames; polling and
    // the timeout above are the authority, not the play promise.
    try { const started = video.play(); started?.catch?.(() => {}); } catch { /* no frame yet */ }
    check();
  });
}

export async function beginCapture(profile, onStop, onError, { signal, onWaiting, playerName = '' } = {}) {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920, max: 1920 }, height: { ideal: 1080, max: 1080 } }, audio: false });
  if (signal?.aborted) { stopStream(stream); throw abortError(); }
  onWaiting?.();
  try { await waitForFirstVideoFrame(stream, { signal }); }
  catch (error) { stopStream(stream); throw error; }
  if (signal?.aborted) { stopStream(stream); throw abortError(); }
  const supported = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!supported) { stopStream(stream); throw new Error('当前浏览器不支持 WebM 录制，请使用桌面版或 Chrome。'); }
  let id;
  try { id = await storage.begin({ profile, playerName: String(playerName || '').trim(), mimeType: supported, title: stream.getVideoTracks()[0].label || '游戏窗口' }); }
  catch (error) { stopStream(stream); throw error; }
  const startedAt = performance.now();
  let recorder;
  try { recorder = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: 5_000_000 }); }
  catch (error) { stopStream(stream); await storage.finish(id, { duration: 0, bytes: 0, empty: true, incomplete: true }).catch(() => {}); throw error; }
  let queue = Promise.resolve(), failed = null, size = 0, stopping = false;
  const stop = () => { if (!stopping) { stopping = true; if (recorder.state !== 'inactive') recorder.stop(); } };
  const stopOnError = error => { if (!failed) { failed = error; onError(error); } stop(); };
  recorder.ondataavailable = event => {
    if (!event.data.size) return;
    size += event.data.size;
    queue = queue.then(() => storage.append(id, event.data)).catch(stopOnError);
    if (size > 1.8 * 1024 ** 3) { onError(new Error('录像接近 2 GB，已自动结束并保存。')); stop(); }
  };
  recorder.onerror = event => stopOnError(event.error || new Error('录制中断，请检查游戏窗口。'));
  const maxDuration = setTimeout(stop, 90 * 60 * 1000);
  recorder.onstop = async () => {
    clearTimeout(maxDuration);
    stream.getTracks().forEach(t => t.stop());
    await queue;
    try {
      // Preserve the file and metadata, but never present a 0-byte capture as a
      // saved, analyzable recording. The UI uses bytes===0 to refuse analysis.
      const item = await storage.finish(id, { duration: (performance.now() - startedAt) / 1000, bytes: size, empty: size === 0, incomplete: Boolean(failed) || size === 0 });
      await onStop(item);
    } catch (error) { onError(error, true); await window.doctorgame?.setBusy(false); }
  };
  stream.getVideoTracks()[0].addEventListener('ended', stop, { once: true });
  recorder.start(2000);
  return { id, stop, stream, startedAt };
}

function waitFor(target, event, signal, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error('无法读取录像画面。文件可能为空、损坏或编码不受支持；请重新录制或导入其他 MP4 / WebM 文件。')); };
    const aborted = () => { cleanup(); reject(new DOMException('分析已取消', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('读取视频帧超时，请重试或换一段录像。')); }, timeout);
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', error); signal?.removeEventListener('abort', aborted); };
    target.addEventListener(event, done, { once: true }); target.addEventListener('error', error, { once: true }); signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

export async function inspectVideo(url, durationHint, signal) {
  const video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.playsInline = true; video.crossOrigin = 'anonymous';
  const ready = waitFor(video, 'loadeddata', signal); video.src = url; video.load();
  try {
    await ready;
    if (!video.videoWidth || !video.videoHeight) throw new Error('这段录像没有可解码的画面（可能是空文件或录制已中断）。请重新录制，或导入其他录像。');
    // MediaRecorder WebM may have no duration metadata; seek to discover it.
    if (!Number.isFinite(video.duration) && !durationHint) {
      const discovered = waitFor(video, 'seeked', signal); video.currentTime = 1e9; await discovered;
    }
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationHint;
    if (!duration || duration <= 0) throw new Error('无法读取录像时长，请重新导出视频。');
    return { video, duration };
  } catch (error) { video.removeAttribute('src'); video.load(); throw error; }
}

export async function analyzeVideo(url, item, onProgress, signal) {
  if (!item) throw new Error('请先选择一段录像。');
  // Only a verified empty file is rejected. Missing/local-stale metadata is not
  // proof of emptiness: let the decoder attempt recovery from the real bytes.
  if (item.actualBytes === 0) throw new Error('这段录像的实际文件为空（0 字节），不能分析。原文件仍保留在本机；请重新录制或导入其他录像。');
  const { video, duration } = await inspectVideo(url, item.duration, signal);
  const width = 640, height = Math.round(width * video.videoHeight / video.videoWidth);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tracker = new AimTracker(width, height);
  const total = Math.ceil(duration * 20); let detected = 0, ambiguous = 0, processed = 0;
  let previousGray, lastTime = 0, motionRun = [];
  const preaim = [];
  const flushMotion = () => {
    if (motionRun.length >= 16 && motionRun.filter(p => Math.hypot(p.dx, p.dy) >= 1).length >= 10) {
      let x = 0, y = 0;
      const points = motionRun.map(p => { x -= p.dx; y -= p.dy; return { x: 0.5 + x / width, y: 0.5 + y / height, t: p.t }; });
      preaim.push({ start: motionRun[0].t, end: motionRun.at(-1).t, kind: 'preaim', context: 'preaim', reviewed: false, included: true,
        points, error: points.map(p => (p.x - 0.5) * 100), motion: summarizeMotion(motionRun), corrections: null, acquisitionMs: null });
    }
    motionRun = [];
  };
  try {
    for (let index = 0; index < total; index++) {
      if (signal.aborted) throw new DOMException('分析已取消', 'AbortError');
      const t = Math.min(index / 20, duration - 0.01);
      if (Math.abs(video.currentTime - t) > 0.002) {
        const ready = waitFor(video, 'seeked', signal); video.currentTime = t; await ready;
      }
      ctx.drawImage(video, 0, 0, width, height);
      const frame = ctx.getImageData(0, 0, width, height);
      const targets = detectTargets(frame, item.profile.outline);
      const gray = grayscale(frame), dt = t - lastTime;
      const motion = previousGray && dt > 0 && dt < 0.13 && !targets.length ? estimateCameraMotion(previousGray, gray, width, height) : null;
      if (motion) { motionRun.push({ ...motion, t, dt }); if (motionRun.length >= 50) flushMotion(); }
      else flushMotion();
      previousGray = gray; lastTime = t;
      if (targets.length) detected++;
      if (targets.length > 1) ambiguous++;
      tracker.push(t, targets); processed++;
      if (index % 20 === 0) { onProgress({ fraction: index / total, processed, total, candidates: tracker.events.length + preaim.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    flushMotion();
    const trajectoryEvents = [...tracker.finish().map(e => ({ ...e, context: 'unknown', source: 'trajectory' })), ...preaim.map(e => ({ ...e, source: 'preaim' }))]
      .sort((a, b) => a.start - b.start).map((e, i) => ({ ...e, id: `event-${i + 1}` }));
    const playerName = String(item.playerName || item.analysisSettings?.playerName || '').trim();
    let hud = null;
    try {
      hud = await detectHudEvents(video, {
        duration, playerName, signal,
        onProgress: progress => onProgress?.({
          fraction: 0.55 + Math.max(0, Math.min(1, progress.fraction || 0)) * 0.45,
          processed, total, candidates: trajectoryEvents.length + (progress.candidates || 0),
          phase: progress.phase, hud: progress
        })
      });
      if (hud.events?.length) hud.events = associateHudEvents(hud.events, trajectoryEvents);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      hud = { status: 'error', events: [], identity: { name: playerName }, message: `HUD 自动识别未完成：${error.message}`, scans: 0, ocrRuns: 0, candidates: 0 };
    }
    const events = [...trajectoryEvents, ...(hud?.events || [])].sort((a, b) => a.start - b.start);
    return { id: item.id, version: ANALYSIS_VERSION, createdAt: new Date().toISOString(), profile: { ...item.profile }, duration, events, hud, processed, detected, ambiguous, demo: false };
  } finally { video.removeAttribute('src'); video.load(); }
}

export function makeDemo(profile) {
  const kinds = ['overshoot', 'settled', 'overshoot', 'undershoot', 'overshoot', 'settled'];
  const events = kinds.map((kind, index) => {
    const start = index * 3 + 1;
    const error = kind === 'overshoot' ? [14, 12, 9, 6, 2, -2, -4, -2, 0, 0.5] : kind === 'undershoot' ? [14, 11, 8, 5, 4, 3.5, 3.5, 3, 3, 3] : [14, 11, 9, 6, 4, 2, 1, 0.4, 0.3, 0];
    return { id: `demo-${index}`, start, end: start + 0.9, kind, context: ['kill', 'death', 'duel', 'duel', 'kill', 'death'][index], error, reviewed: false, included: true, corrections: kind === 'overshoot' ? 1 : 0, acquisitionMs: kind === 'undershoot' ? null : 400,
      points: error.map((e, i) => ({ x: 0.5 + e / 100, y: 0.5 + Math.sin(i) * 0.002, t: start + i * 0.1 })) };
  });
  const preaim = events.at(-1);
  preaim.kind = 'preaim'; preaim.context = 'preaim'; preaim.error = [0, 1, 3, 5, 6, 6.5, 6.8, 6.7, 6.9, 7];
  preaim.points = preaim.error.map((e, i) => ({ x: 0.5 + e / 100, y: 0.5, t: preaim.start + i * 0.1 }));
  preaim.motion = { reversals: 2, medianSpeed: 38, sampleCount: 10, duration: 0.9 };
  return { id: 'demo', version: ANALYSIS_VERSION, createdAt: new Date().toISOString(), profile: { ...profile }, duration: 20, events, processed: 400, detected: 60, ambiguous: 0, demo: true };
}
