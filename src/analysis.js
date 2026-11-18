// Deliberately conservative, explainable prototype. These are engineering
// thresholds, not experimentally validated estimates of ideal sensitivity.
export const ANALYSIS_VERSION = 'outline-baseline-0.1';
export const MIN_REVIEWED = 20;
export const DEFAULT_PROFILE = Object.freeze({ dpi: 800, sensitivity: 0.35, outline: 'yellow', aimStyle: 'mixed', grip: 'unknown', mouseSpace: null, comfort: 'unknown' });

export const HABIT_LABELS = {
  aimStyle: { arm: '手臂为主', wrist: '手腕为主', mixed: '手臂 + 手腕', unknown: '暂不确定' },
  grip: { palm: '趴握', claw: '抓握', fingertip: '指握', unknown: '暂不确定' },
  comfort: { comfortable: '移动舒适', limited: '经常拉到边缘', tense: '容易用力过紧', unknown: '暂不确定' }
};
export const SCENE_LABELS = { unknown: '场景待确认', kill: '完成击杀', death: '被击杀', duel: '对枪未击杀', preaim: '预瞄移动' };

// Estimate small background translations, not hand movement. Large camera
// turns, low texture and inconsistent motion are rejected instead of scored.
export function estimateCameraMotion(previous, current, width, height) {
  const flows = [], radius = 10;
  for (const fy of [0.24, 0.38, 0.56]) for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const x = Math.round(width * fx), y = Math.round(height * fy);
    const samples = [];
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) samples.push(previous[(y + dy) * width + x + dx]);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length < 180) continue;
    let best = Infinity, bestX = 0, bestY = 0;
    const cost = (ox, oy) => {
      let sum = 0, i = 0;
      for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) sum += Math.abs(samples[i++] - current[(y + dy + oy) * width + x + dx + ox]);
      return sum / samples.length;
    };
    for (let oy = -radius; oy <= radius; oy += 2) for (let ox = -radius; ox <= radius; ox += 2) {
      const score = cost(ox, oy); if (score < best) { best = score; bestX = ox; bestY = oy; }
    }
    const coarseX = bestX, coarseY = bestY;
    for (let oy = coarseY - 1; oy <= coarseY + 1; oy++) for (let ox = coarseX - 1; ox <= coarseX + 1; ox++) {
      const score = cost(ox, oy); if (score < best) { best = score; bestX = ox; bestY = oy; }
    }
    if (best < 22 && Math.abs(bestX) < radius && Math.abs(bestY) < radius) flows.push({ dx: bestX, dy: bestY });
  }
  if (flows.length < 5) return null;
  const dx = median(flows.map(p => p.dx)), dy = median(flows.map(p => p.dy));
  const consensus = flows.filter(p => Math.hypot(p.dx - dx, p.dy - dy) <= 2);
  if (consensus.length < 5 || consensus.length / flows.length < 0.6) return null;
  return { dx: median(consensus.map(p => p.dx)), dy: median(consensus.map(p => p.dy)), agreement: consensus.length / flows.length };
}

export function grayscale({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < gray.length; p++) gray[p] = Math.round(data[p * 4] * 0.299 + data[p * 4 + 1] * 0.587 + data[p * 4 + 2] * 0.114);
  return gray;
}

export function summarizeMotion(samples) {
  const moving = samples.filter(p => Math.hypot(p.dx, p.dy) >= 1);
  let reversals = 0;
  for (let i = 1; i < moving.length; i++) {
    const a = moving[i - 1], b = moving[i];
    if (a.dx * b.dx + a.dy * b.dy < -0.35 * Math.hypot(a.dx, a.dy) * Math.hypot(b.dx, b.dy)) reversals++;
  }
  const speeds = samples.map(p => Math.hypot(p.dx, p.dy) / p.dt);
  return { reversals, medianSpeed: Math.round(median(speeds)), sampleCount: samples.length, duration: samples.length ? samples.at(-1).t - samples[0].t : 0 };
}

export function validateProfile(profile) {
  if (!Number.isFinite(Number(profile.dpi)) || Number(profile.dpi) < 100 || Number(profile.dpi) > 64000) throw new Error('DPI 请填写 100–64000 之间的数字。');
  if (!Number.isFinite(Number(profile.sensitivity)) || Number(profile.sensitivity) < 0.001 || Number(profile.sensitivity) > 10) throw new Error('游戏灵敏度请填写 0.001–10 之间的数字。');
  if (!['yellow', 'purple', 'red'].includes(profile.outline)) throw new Error('请选择敌人高亮颜色。');
  const aimStyle = profile.aimStyle || 'unknown', grip = profile.grip || 'unknown', comfort = profile.comfort || 'unknown';
  if (!HABIT_LABELS.aimStyle[aimStyle] || !HABIT_LABELS.grip[grip] || !HABIT_LABELS.comfort[comfort]) throw new Error('请选择有效的瞄准习惯。');
  const mouseSpace = profile.mouseSpace === '' || profile.mouseSpace == null ? null : Number(profile.mouseSpace);
  if (mouseSpace !== null && (!Number.isFinite(mouseSpace) || mouseSpace < 5 || mouseSpace > 150)) throw new Error('可移动宽度请填写 5–150 cm，也可以留空。');
  return { dpi: Number(profile.dpi), sensitivity: Number(profile.sensitivity), outline: profile.outline, aimStyle, grip, mouseSpace, comfort };
}

export function habitContext(profile, direction = 0) {
  const p = validateProfile(profile), notes = [], tasks = [];
  if (p.aimStyle === 'wrist') { notes.push('手腕为主：同时检查小幅修正和大角度转身的取舍。'); tasks.push('加入大角度转身，记录是否需要频繁抬鼠。'); }
  if (p.aimStyle === 'arm') { notes.push('手臂为主：分别观察大幅移动和停下后的精细修正。'); tasks.push('加入远距离小目标，记录停下后是否还要反复补拉。'); }
  if (p.aimStyle === 'mixed') { notes.push('混合瞄准：区分手臂转向与手腕微调，避免把两者合成一个平均值。'); tasks.push('分别复测大幅转向和小幅微调。'); }
  if (p.grip !== 'unknown') notes.push(`已记录${HABIT_LABELS.grip[p.grip]}；比较两档灵敏度时保持握姿一致，握姿本身不直接决定数值。`);
  if (p.mouseSpace) notes.push(`可移动宽度约 ${p.mouseSpace} cm；复测时记录触及边缘和抬鼠次数。`);
  if (direction < 0 && (p.comfort === 'limited' || p.aimStyle === 'wrist' || (p.mouseSpace && p.mouseSpace < 25))) notes.push('降低灵敏度需要更大的移动距离；如果转身受限，保留原值并比较两种设置。');
  if (p.comfort === 'tense') { notes.push('你记录了容易用力过紧，当前偏差也可能与用力状态有关。'); tasks.push('在相近、放松的状态下复测，分别记录控制感。'); }
  if (!tasks.length) tasks.push('复测大角度转身和小目标微调，记录控制感。');
  return { notes, tasks, basis: '习惯信息用于解释和设计复测，不是已经验证的灵敏度映射。' };
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

export function isOutline(r, g, b, color) {
  if (color === 'purple') return r > 150 && b > 140 && g < Math.min(r, b) * 0.78 && Math.abs(r - b) < 115;
  if (color === 'red') return r > 175 && r > g * 1.65 && r > b * 1.45;
  return r > 160 && g > 145 && b < 130 && Math.min(r, g) > b * 1.45 && Math.abs(r - g) < 90;
}

// A color baseline only: outline-colored effects, scenery and HUD can still
// produce false positives. Nothing from this detector is a confirmed enemy.
export function detectTargets({ data, width, height }, color = 'yellow') {
  const step = 2, w = Math.floor(width / step), h = Math.floor(height / step);
  const mask = new Uint8Array(w * h), dilated = new Uint8Array(w * h);
  const minX = Math.floor(w * 0.16), maxX = Math.ceil(w * 0.84);
  const minY = Math.floor(h * 0.15), maxY = Math.ceil(h * 0.78);
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    // Remove the likely crosshair so it cannot masquerade as a target.
    if (Math.abs(x - w / 2) < 5 && Math.abs(y - h / 2) < 5) continue;
    const i = (y * step * width + x * step) * 4;
    if (isOutline(data[i], data[i + 1], data[i + 2], color)) mask[y * w + x] = 1;
  }
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) if (mask[y * w + x]) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dilated[(y + dy) * w + x + dx] = 1;
  }
  const targets = [], queue = new Int32Array(w * h);
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {
    const start = y * w + x;
    if (dilated[start] !== 1) continue;
    let head = 0, tail = 1, pixels = 0, left = x, right = x, top = y, bottom = y;
    queue[0] = start; dilated[start] = 2;
    while (head < tail) {
      const p = queue[head++], px = p % w, py = Math.floor(p / w);
      pixels += mask[p]; left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
      for (const n of [p - 1, p + 1, p - w, p + w]) {
        if (n >= 0 && n < dilated.length && Math.abs(n % w - px) <= 1 && dilated[n] === 1) { dilated[n] = 2; queue[tail++] = n; }
      }
    }
    const bw = right - left + 1, bh = bottom - top + 1, ratio = bh / bw;
    if (pixels < 10 || bw < 4 || bh < 8 || ratio < 1.15 || ratio > 6 || bw > w * 0.22 || bh > h * 0.55) continue;
    targets.push({ x: (left + right) / 2 * step, y: (top + bh * 0.15) * step, width: bw * step, height: bh * step, top: top * step, left: left * step, density: pixels / (bw * bh) });
  }
  return targets.sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2));
}

export function classifyTrack(points, width, height) {
  if (points.length < 8) return null;
  const duration = points.at(-1).t - points[0].t;
  if (duration < 0.3 || duration > 3) return null;
  const gaps = points.slice(1).map((p, i) => p.t - points[i].t);
  if (Math.max(...gaps) > 0.13 || gaps.some(g => g <= 0)) return null;
  const first = points[0], ex = first.x - width / 2, ey = first.y - height / 2;
  const distance = Math.hypot(ex, ey);
  const tolerance = Math.max(5, median(points.map(p => p.width)) * 0.23);
  if (distance < Math.max(18, tolerance * 2.5)) return null;
  const ux = ex / distance, uy = ey / distance;
  const projection = points.map(p => (p.x - width / 2) * ux + (p.y - height / 2) * uy);
  const perpendicular = points.map(p => Math.abs((p.x - width / 2) * uy - (p.y - height / 2) * ux));
  if (median(perpendicular) > Math.max(16, distance * 0.4)) return null;
  if (Math.min(...projection) > distance * 0.65) return null; // No clear acquisition.
  const nearIndex = projection.findIndex(p => p <= tolerance);
  let kind = 'settled';
  if (nearIndex >= 0 && projection.slice(nearIndex).some(p => p < -tolerance * 1.4)) kind = 'overshoot';
  else if (nearIndex === -1) {
    const last = projection.slice(-4);
    if (Math.max(...last) - Math.min(...last) > tolerance || median(last) > distance * 0.5) return null;
    kind = 'undershoot';
  }
  const sizes = points.map(p => p.height);
  if (Math.max(...sizes) / Math.min(...sizes) > 1.65) return null;
  let corrections = 0;
  for (let i = 2; i < projection.length; i++) {
    const a = projection[i - 1] - projection[i - 2], b = projection[i] - projection[i - 1];
    if (a * b < 0 && Math.abs(a) > tolerance * 0.4 && Math.abs(b) > tolerance * 0.4) corrections++;
  }
  return { start: first.t, end: points.at(-1).t, kind, corrections, reviewed: false, included: true,
    acquisitionMs: nearIndex >= 0 ? Math.round((points[nearIndex].t - first.t) * 1000) : null,
    points: points.map(p => ({ t: p.t, x: p.x / width, y: p.y / height })),
    error: projection.map(v => Math.round(v / width * 1000) / 10) };
}

export class AimTracker {
  constructor(width, height) { this.width = width; this.height = height; this.points = []; this.events = []; this.lastEnd = -1; }
  flush() {
    const event = classifyTrack(this.points, this.width, this.height);
    if (event && event.start > this.lastEnd + 0.1) { event.id = `event-${this.events.length + 1}`; this.events.push(event); this.lastEnd = event.end; }
    this.points = [];
  }
  push(t, targets) {
    // Multiple plausible targets make intention ambiguous; skip the frame.
    if (targets.length !== 1) { this.flush(); return; }
    const p = { ...targets[0], t }, last = this.points.at(-1);
    if (last && (t - last.t > 0.13 || Math.hypot(p.x - last.x, p.y - last.y) > this.width * 0.14 || p.height / last.height > 1.5 || last.height / p.height > 1.5)) this.flush();
    if (this.points.length && t - this.points[0].t >= 1.5) this.flush();
    this.points.push(p);
  }
  finish() { this.flush(); return this.events; }
}

export function wilsonLower(successes, total) {
  if (!total) return 0;
  const z = 1.96, p = successes / total;
  return (p + z * z / (2 * total) - z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / (1 + z * z / total);
}

export function recommend(events, profile, { demo = false } = {}) {
  const config = validateProfile(profile);
  const valid = events.filter(e => e.reviewed && e.included && ['kill', 'death', 'duel'].includes(e.context) && ['overshoot', 'undershoot', 'settled'].includes(e.kind));
  const counts = Object.fromEntries(['overshoot', 'undershoot', 'settled'].map(kind => [kind, valid.filter(e => e.kind === kind).length]));
  const result = { status: 'insufficient', current: config.sensitivity, candidate: config.sensitivity, change: 0,
    reviewed: valid.length, candidates: events.length, counts, confidence: '尚不足以判断',
    reason: `需要至少 ${MIN_REVIEWED} 个确认有效的片段；目前有 ${valid.length} 个。`, demo, habits: habitContext(config) };
  if (demo) { result.status = 'demo'; result.reason = '这是合成轨迹，用于体验回放和报告，不是你的实战数据。'; return result; }
  if (valid.length < MIN_REVIEWED) return result;
  const dominant = counts.overshoot > counts.undershoot ? 'overshoot' : 'undershoot';
  const proportion = counts[dominant] / valid.length;
  const stableDirection = wilsonLower(counts[dominant], valid.length) > 0.5;
  if (proportion >= 0.65 && stableDirection) {
    result.status = 'experiment'; result.change = dominant === 'overshoot' ? -0.03 : 0.03;
    result.candidate = Math.min(10, Math.max(0.001, Math.round(config.sensitivity * (1 + result.change) * 100000) / 100000));
    result.confidence = '有一致倾向，原因待验证';
    result.reason = dominant === 'overshoot' ? '确认片段中，越过目标后回拉的情况较多。可试用降低 3% 的设置。' : '确认片段中，移动不足后补拉的情况较多。可试用提高 3% 的设置。';
  } else {
    result.status = 'keep'; result.confidence = '没有一致方向'; result.reason = '有效片段没有显示稳定的偏高或偏低倾向，建议先保持当前灵敏度。';
  }
  result.habits = habitContext(config, result.change);
  return result;
}
