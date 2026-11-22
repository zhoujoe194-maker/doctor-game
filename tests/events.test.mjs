import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHudLine, parseHudLines, HudFeedTracker, normalizeName, hudSampleTimes,
  HUD_REJECT_REASONS, HUD_ROW_TTL_SECONDS, associateHudEvents, applyHudRefinement, mergeHudRescan
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

test('does not treat a longer or edited name as the exact player identity', () => {
  assert.equal(classifyHudLine({ text: 'AlexB Enemy', confidence: 95 }, 'Alex').status, 'reject');
  for (const identity of ['AlexB', 'Alex1', 'Alexll', 'AlexBB']) {
    const result = classifyHudLine(line(`${identity} Enemy`), 'Alex');
    assert.equal(result.status, 'reject', identity);
  }
  assert.equal(classifyHudLine(line('Alex Enemy'), 'Alex').status, 'match');
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


test('coarse episodes separated by more than the TTL stay separate during per-episode refinement', () => {
  const row = observations('Alex', 'Alex Enemy');
  const tracker = new HudFeedTracker();
  tracker.observe(row, 2.6);
  tracker.observe([], 12.6);
  tracker.observe(row, 22.6);
  tracker.observe(row, 42.6);
  const events = tracker.finish(60);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => e.firstSeen), [2.6, 22.6, 42.6]);
  // A late/refine scan for the first episode must update only that episode.
  assert.equal(applyHudRefinement(events[0], row[0], 1.8), true);
  assert.equal(events[0].firstSeen, 1.8);
  assert.equal(events[0].at, 1.8);
  assert.equal(events[0].lastSeen, 2.6);
  assert.equal(events[1].firstSeen, 22.6);
  assert.equal(events[1].at, 22.6);
  assert.equal(events[2].firstSeen, 42.6);
  // A non-matching refinement cannot touch an episode.
  assert.equal(applyHudRefinement(events[0], observations('Alex', 'AlexOther Enemy')[0], 1.2), false);
  assert.equal(events[0].firstSeen, 1.8);
});


test('a same-identity rescan preserves reviewed, included and user-corrected context', () => {
  const old = { id: 'hud-1', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: true, included: false, rowKey: 'left|alexenemy', firstSeen: 2, start: 0.5, end: 3.5, evidence: {} };
  const candidate = { id: 'hud-9', source: 'hud-ocr', kind: 'observation', context: 'death', reviewed: false, included: true, rowKey: 'left|alexenemy', firstSeen: 2.2, start: 0.7, end: 3.7, evidence: {} };
  const merged = mergeHudRescan({ hud: { identity: { name: 'Alex' } }, events: [old] }, { status: 'complete', events: [candidate], message: 'ok' }, 'Alex');
  assert.equal(merged.events[0].reviewed, true);
  assert.equal(merged.events[0].included, false);
  assert.equal(merged.events[0].context, 'kill');
  assert.equal(merged.hud.retained, 0);
});

test('a changed identity retains the old confirmed candidate instead of deleting it', () => {
  const old = { id: 'hud-1', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: true, included: true, rowKey: 'left|alexenemy', firstSeen: 2, start: 0.5, end: 3.5, evidence: { rowText: 'Alex Enemy' } };
  const candidate = { id: 'hud-9', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: false, included: true, rowKey: 'left|alexenemy', firstSeen: 2.2, start: 0.7, end: 3.7, evidence: {} };
  const merged = mergeHudRescan({ hud: { identity: { name: 'Alex' } }, events: [old] }, { status: 'complete', events: [candidate], message: 'ok' }, 'AlexB');
  const retained = merged.events.find(event => event.retained);
  assert.ok(retained);
  assert.equal(retained.reviewed, true);
  assert.equal(retained.included, true);
  assert.equal(retained.evidence.previousIdentity, 'Alex');
  assert.equal(merged.hud.retainedConfirmed, 1);
});


test('rescan identity changes never duplicate IDs and can restore the original confirmation', () => {
  const oldAlex = { id: 'hud-1', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: true, included: false, rowKey: 'left|alexenemy', firstSeen: 2, start: 0.5, end: 3.5, evidence: { identity: 'Alex' } };
  const freshBob = { id: 'hud-1', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: false, included: true, rowKey: 'left|alexenemy', firstSeen: 4, start: 2.5, end: 5.5, evidence: {} };
  const bob = mergeHudRescan({ hud: { identity: { name: 'Alex' } }, events: [oldAlex] }, { status: 'complete', events: [freshBob], message: 'ok' }, 'Bob');
  const bobIds = bob.events.map(event => event.id);
  assert.equal(new Set(bobIds).size, bobIds.length);
  const retainedAlex = bob.events.find(event => event.retained && event.reviewed);
  assert.ok(retainedAlex);
  assert.equal(retainedAlex.id, 'hud-1');
  assert.equal(bob.events.find(event => !event.retained).id, 'hud-1-r1');

  const freshAlex = { id: 'hud-1', source: 'hud-ocr', kind: 'observation', context: 'kill', reviewed: false, included: true, rowKey: 'left|alexenemy', firstSeen: 2.2, start: 0.7, end: 3.7, evidence: {} };
  const back = mergeHudRescan({ hud: bob.hud, events: bob.events }, { status: 'complete', events: [freshAlex], message: 'ok' }, 'Alex');
  const backIds = back.events.map(event => event.id);
  assert.equal(new Set(backIds).size, backIds.length);
  const restored = back.events.find(event => !event.retained);
  assert.equal(restored.id, 'hud-1');
  assert.equal(restored.reviewed, true);
  assert.equal(restored.included, false);
  // The restored Alex confirmation is the non-retained matched candidate; the
  // unconfirmed Bob row remains retained and cannot collide with it.
  assert.equal(back.events.filter(event => event.retained && event.reviewed).length, 0);
  assert.ok(back.events.some(event => event.retained && event.evidence?.previousIdentity === 'Bob'));
});
