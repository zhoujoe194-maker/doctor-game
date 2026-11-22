import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHudLine, parseHudLines, HudFeedTracker, normalizeName, hudSampleTimes,
  HUD_REJECT_REASONS, HUD_ROW_TTL_SECONDS, associateHudEvents
} from '../src/events.js';
import { recommend, DEFAULT_PROFILE } from '../src/analysis.js';

const line = (text, confidence = 90) => ({
  text, confidence, bbox: { x0: 0, y0: 0, x1: 400, y1: 32 },
  words: text.split(/\s+/).map((word, index) => ({ text: word, confidence, bbox: { x0: index * 100, y0: 0, x1: index * 100 + 80, y1: 32 } }))
});
const observations = (player, text, confidence = 90) => parseHudLines([line(text, confidence)], player).observations;

test('matches the player on the left as a kill and on the right as a death', () => {
  const kill = classifyHudLine(line('PlayerOne EnemyOne'), 'PlayerOne');
  assert.equal(kill.status, 'match'); assert.equal(kill.context, 'kill'); assert.equal(kill.leftText, 'PlayerOne'); assert.equal(kill.rightText, 'EnemyOne');
  const death = classifyHudLine(line('EnemyTwo PlayerOne'), 'PlayerOne');
  assert.equal(death.status, 'match'); assert.equal(death.context, 'death'); assert.equal(death.leftText, 'EnemyTwo'); assert.equal(death.rightText, 'PlayerOne');
});

test('supports Chinese player names and exact normalized matching', () => {
  const kill = classifyHudLine(line('玩家甲 幻影 敌人乙'), '玩家甲');
  assert.equal(kill.status, 'match'); assert.equal(kill.context, 'kill');
  assert.equal(normalizeName(' 玩家甲 '), '玩家甲');
  const split = { text: '玩家 甲 敌人 乙', confidence: 70, bbox: { x0: 0, y0: 0, x1: 400, y1: 32 }, words: ['玩家', '甲', '敌人', '乙'].map((text, index) => ({ text, confidence: 70, bbox: { x0: index * 70, y0: 0, x1: index * 70 + 60, y1: 32 } })) };
  const chinese = classifyHudLine(split, '玩家甲');
  assert.equal(chinese.status, 'match'); assert.equal(chinese.context, 'kill'); assert.equal(chinese.rightText, '敌人 乙');
  assert.equal(classifyHudLine(line('玩家甲二号 幻影 敌人乙'), '玩家甲').status, 'reject');
});

test('rejects teammates, assists, missing names and names not at a participant edge', () => {
  assert.equal(parseHudLines([line('AllyOne Vandal EnemyOne')], 'PlayerOne').observations.length, 0);
  assert.equal(classifyHudLine(line('PlayerOne assist AllyOne'), 'PlayerOne').reason, HUD_REJECT_REASONS.ASSIST_TEXT);
  assert.equal(classifyHudLine(line('AllyOne Vandal EnemyOne'), '').reason, HUD_REJECT_REASONS.NAME_MISSING);
  assert.equal(classifyHudLine(line('AllyOne PlayerOne EnemyOne'), 'PlayerOne').reason, HUD_REJECT_REASONS.NAME_MIDDLE);
  assert.equal(classifyHudLine(line('PlayerOne PlayerOne'), 'PlayerOne').reason, HUD_REJECT_REASONS.NAME_BOTH_SIDES);
});

test('rejects low-confidence rows and does not invent an event from one word', () => {
  assert.equal(classifyHudLine(line('PlayerOne EnemyOne', 30), 'PlayerOne').reason, HUD_REJECT_REASONS.LOW_CONFIDENCE);
  assert.equal(classifyHudLine(line('PlayerOne'), 'PlayerOne').reason, HUD_REJECT_REASONS.NO_OPPONENT);
});

test('continuous rows and rows shifting upward deduplicate to one HUD candidate', () => {
  const tracker = new HudFeedTracker();
  const first = observations('PlayerOne', 'PlayerOne EnemyOne');
  tracker.observe(first, 2); tracker.observe(first, 3); tracker.observe(first, 4);
  // A newer row above pushes the same row down; identity is not the array index.
  const shifted = observations('PlayerOne', 'PlayerOne EnemyOne');
  tracker.observe([...parseHudLines([line('AllyOne EnemyTwo')], 'PlayerOne').observations, ...shifted], 5);
  const events = tracker.finish(20);
  assert.equal(events.length, 1);
  assert.equal(events[0].scanCount, 4);
  assert.equal(events[0].source, 'hud-ocr');
  assert.equal(events[0].kind, 'observation');
  assert.equal(events[0].reviewed, false);
  assert.ok(events[0].start < events[0].firstSeen);
});

test('the same player name reappears as a second event after the row expires', () => {
  const tracker = new HudFeedTracker({ ttl: 4 });
  const row = observations('PlayerOne', 'PlayerOne EnemyOne');
  tracker.observe(row, 2); tracker.observe(row, 3);
  tracker.observe([], 3 + HUD_ROW_TTL_SECONDS + 1);
  tracker.observe(row, 20);
  const events = tracker.finish(30);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].firstSeen, events[1].firstSeen);
});

test('a refine observation cannot create an unrelated candidate', () => {
  const tracker = new HudFeedTracker();
  tracker.observe([], 1, { allowCreate: false });
  assert.equal(tracker.finish(10).length, 0);
});

test('HUD observations never become quantitative evidence, even if reviewed', () => {
  const hud = Array.from({ length: 30 }, (_, i) => ({
    id: `hud-${i}`, kind: 'observation', context: 'kill', source: 'hud-ocr',
    reviewed: true, included: true, start: i * 2, end: i * 2 + 1,
    points: [], error: []
  }));
  const result = recommend(hud, { ...DEFAULT_PROFILE });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.reviewed, 0);
  assert.equal(result.change, 0);
  const forged = recommend([{ ...hud[0], kind: 'overshoot', reviewed: true, included: true }], { ...DEFAULT_PROFILE });
  assert.equal(forged.reviewed, 0);
  assert.equal(forged.change, 0);
});

test('HUD sampling is low-frequency and bounded by duration', () => {
  const times = hudSampleTimes(10.2, 1);
  assert.ok(times.length >= 9 && times.length <= 11);
  for (let i = 1; i < times.length; i++) assert.equal(Math.round((times[i] - times[i - 1]) * 1000), 1000);
  assert.ok(times.every(t => t < 10.2));
});


test('tolerates common trailing OCR noise without accepting a different name', () => {
  const noisy = classifyHudLine(line('PlayerOnelll EnemyOne'), 'PlayerOne');
  assert.equal(noisy.status, 'match'); assert.equal(noisy.context, 'kill');
  assert.equal(classifyHudLine(line('PlayerOneTwo EnemyOne'), 'PlayerOne').status, 'reject');
});

test('trajectory proximity is navigation context only and does not review or copy evidence', () => {
  const hud = [{ id: 'hud-1', at: 3.2, firstSeen: 3.2, lastSeen: 4, start: 1, end: 4, kind: 'observation', context: 'kill', source: 'hud-ocr', reviewed: false, included: true, evidence: {} }];
  const trajectory = [{ id: 'event-1', start: 2.5, end: 3.6, kind: 'overshoot', context: 'duel', source: 'trajectory', reviewed: false, included: true, points: [], error: [10], }];
  associateHudEvents(hud, trajectory);
  assert.equal(hud[0].relatedEventId, 'event-1');
  assert.equal(hud[0].kind, 'observation');
  assert.equal(hud[0].reviewed, false);
  assert.equal(trajectory[0].reviewed, false);
  assert.equal(trajectory[0].kind, 'overshoot');
  assert.deepEqual(trajectory[0].points, []);
});
