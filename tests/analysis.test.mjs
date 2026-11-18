import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTrack, detectTargets, recommend, validateProfile, DEFAULT_PROFILE, AimTracker, habitContext, estimateCameraMotion, summarizeMotion } from '../src/analysis.js';

const profile = { ...DEFAULT_PROFILE };
const trajectory = offsets => offsets.map((offset, i) => ({ t: i * 0.05, x: 320 + offset, y: 180, width: 32, height: 70 }));
const reviewed = (kind, n) => Array.from({ length: n }, () => ({ kind, context: 'duel', reviewed: true, included: true }));
test('detects a yellow vertical outline, ignores the central crosshair', () => {
  const width = 640, height = 360, data = new Uint8ClampedArray(width * height * 4);
  const pixel = (x, y) => { const i = (y * width + x) * 4; data.set([255, 235, 40, 255], i); };
  for (let y = 130; y < 210; y++) for (let x = 400; x < 430; x++) if (x < 404 || x > 425 || y < 134 || y > 205) pixel(x, y);
  for (let x = 314; x < 327; x++) pixel(x, 180);
  const targets = detectTargets({ data, width, height }, 'yellow');
  assert.equal(targets.length, 1); assert.ok(targets[0].x > 410 && targets[0].x < 420);
  assert.equal(detectTargets({ data, width, height }, 'purple').length, 0);
});
test('identifies crossing and continued travel beyond target', () => {
  assert.equal(classifyTrack(trajectory([90, 75, 58, 35, 10, -15, -25, -20, -8, 0]), 640, 360).kind, 'overshoot');
});
test('identifies settling before the target without treating any miss as undershoot', () => {
  assert.equal(classifyTrack(trajectory([90, 70, 50, 34, 28, 26, 25, 26, 25, 25]), 640, 360).kind, 'undershoot');
  assert.equal(classifyTrack(trajectory([90, 89, 90, 88, 87, 89, 90, 89]), 640, 360), null);
});
test('rejects insufficient sampling and lateral target motion', () => {
  const points = trajectory([90, 70, 50, 30, 10, -20, -25, -10]);
  assert.equal(classifyTrack(points.map((p, i) => ({ ...p, t: i * 0.2 })), 640, 360), null);
  assert.equal(classifyTrack(points.map((p, i) => ({ ...p, y: p.y + i * 35 })), 640, 360), null);
});
test('ambiguous targets cannot be combined into evidence', () => {
  const tracker = new AimTracker(640, 360);
  trajectory([90, 70, 50, 30, 10, -20, -25, -10]).forEach(p => tracker.push(p.t, [p, { ...p, x: p.x + 50 }]));
  assert.equal(tracker.finish().length, 0);
});
test('unreviewed, excluded and demo events never trigger a sensitivity change', () => {
  assert.equal(recommend(reviewed('overshoot', 50).map(e => ({ ...e, reviewed: false })), profile).change, 0);
  assert.equal(recommend(reviewed('overshoot', 50).map(e => ({ ...e, included: false })), profile).change, 0);
  assert.equal(recommend(reviewed('overshoot', 50), profile, { demo: true }).change, 0);
  assert.equal(recommend(reviewed('overshoot', 19), profile).status, 'insufficient');
});
test('consistent reviewed evidence suggests a bounded experiment in the correct direction', () => {
  const lower = recommend([...reviewed('overshoot', 25), ...reviewed('settled', 5)], profile);
  assert.equal(lower.change, -0.03); assert.equal(lower.candidate, 0.3395);
  const higher = recommend([...reviewed('undershoot', 25), ...reviewed('settled', 5)], profile);
  assert.equal(higher.change, 0.03); assert.equal(higher.candidate, 0.3605);
  assert.equal(recommend([...reviewed('undershoot', 20), ...reviewed('overshoot', 20)], profile).change, 0);
});
test('habits change explanation and retest plan, not an unsupported numeric mapping', () => {
  const wrist = { ...profile, aimStyle: 'wrist', grip: 'claw', mouseSpace: 20, comfort: 'limited' };
  const arm = { ...profile, aimStyle: 'arm', grip: 'palm', mouseSpace: 60, comfort: 'comfortable' };
  const a = recommend(reviewed('overshoot', 30), wrist), b = recommend(reviewed('overshoot', 30), arm);
  assert.equal(a.candidate, b.candidate);
  assert.ok(a.habits.notes.some(n => n.includes('降低灵敏度需要更大的移动距离')));
  assert.ok(a.habits.tasks.some(n => n.includes('抬鼠')));
  assert.ok(b.habits.tasks.some(n => n.includes('小目标')));
  assert.ok(habitContext(wrist).notes.some(n => n.includes('抓握')));
});
test('invalid input is rejected; omitted physical measurements stay unknown', () => {
  for (const sensitivity of [0, -1, NaN, Infinity, 100]) assert.throws(() => validateProfile({ ...profile, sensitivity }));
  assert.throws(() => validateProfile({ ...profile, dpi: 0 }));
  assert.throws(() => validateProfile({ ...profile, aimStyle: 'something' }));
  assert.throws(() => validateProfile({ ...profile, mouseSpace: -1 }));
  assert.equal(validateProfile({ ...profile, mouseSpace: '' }).mouseSpace, null);
});
test('camera motion recovers known translation and rejects flat frames', () => {
  const w = 320, h = 180, a = new Uint8Array(w * h), b = new Uint8Array(w * h);
  let seed = 37;
  for (let i = 0; i < a.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; a[i] = seed >>> 24; }
  for (let y = 0; y < h - 2; y++) for (let x = 0; x < w - 4; x++) b[(y + 2) * w + x + 4] = a[y * w + x];
  const motion = estimateCameraMotion(a, b, w, h);
  assert.equal(motion.dx, 4); assert.equal(motion.dy, 2);
  assert.equal(estimateCameraMotion(new Uint8Array(w * h), new Uint8Array(w * h), w, h), null);
});
test('preaim and unconfirmed scenes cannot create a sensitivity recommendation', () => {
  assert.equal(recommend(reviewed('overshoot', 40).map(e => ({ ...e, context: 'preaim' })), profile).status, 'insufficient');
  assert.equal(recommend(reviewed('overshoot', 40).map(e => ({ ...e, context: 'unknown' })), profile).status, 'insufficient');
  const points = [2, 2, 2, -2, -2, 2].map((dx, i) => ({ dx, dy: 0, t: i * 0.05, dt: 0.05 }));
  assert.equal(summarizeMotion(points).reversals, 2);
});
