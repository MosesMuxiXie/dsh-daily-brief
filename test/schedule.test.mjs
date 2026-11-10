import test from 'node:test';
import assert from 'node:assert/strict';
import { shiftClock, zonedDateTime, resolveSchedulePhase } from '../lib/engine/schedule.js';
import { mergeConfig } from '../lib/engine/config.js';

test('shiftClock wraps across midnight', () => {
  assert.equal(shiftClock('08:00', -10), '07:50');
  assert.equal(shiftClock('00:05', -10), '23:55');
  assert.equal(shiftClock('23:55', 10), '00:05');
});

test('zonedDateTime resolves a wall clock in Asia/Shanghai', () => {
  assert.equal(
    zonedDateTime('2026-11-10', '08:00', 'Asia/Shanghai').toISOString(),
    '2026-11-10T00:00:00.000Z',
  );
});

test('resolveSchedulePhase splits prepare and publish', () => {
  const schedule = { time: '08:00', prepareLeadMin: 10 };
  const prep = resolveSchedulePhase({
    now: new Date('2026-11-10T07:50:00+08:00'),
    schedule,
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(prep.phase, 'prepare');
  assert.equal(prep.dateKey, '2026-11-10');
  assert.equal(prep.publishAt.toISOString(), '2026-11-10T00:00:00.000Z');

  const publish = resolveSchedulePhase({
    now: new Date('2026-11-10T08:00:05+08:00'),
    schedule,
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(publish.phase, 'publish');
  assert.equal(publish.dateKey, '2026-11-10');
});

test('resolveSchedulePhase targets tomorrow for a cross-midnight prepare', () => {
  const schedule = { time: '00:05', prepareLeadMin: 10 };
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T23:55:00+08:00'),
    schedule,
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'prepare');
  assert.equal(plan.dateKey, '2026-11-11');
  assert.equal(plan.publishAt.toISOString(), '2026-11-10T16:05:00.000Z');
});

test('resolveSchedulePhase still publishes a just-missed run', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-11T00:06:00+08:00'),
    schedule: { time: '00:05', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'publish');
  assert.equal(plan.dateKey, '2026-11-11');
});

test('mergeConfig defaults and clamps prepareLeadMin', () => {
  assert.equal(mergeConfig({}).schedule.prepareLeadMin, 10);
  assert.equal(mergeConfig({ schedule: { prepareLeadMin: 0 } }).schedule.prepareLeadMin, 1);
  assert.equal(mergeConfig({ schedule: { prepareLeadMin: 999 } }).schedule.prepareLeadMin, 60);
  assert.equal(mergeConfig({ schedule: { time: '08:00', prepareLeadMin: 15 } }).schedule.prepareLeadMin, 15);
});

test('resolveSchedulePhase catches up the most recent publish after a long outage', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T15:00:00+08:00'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'publish');
  assert.equal(plan.dateKey, '2026-11-10');
  assert.equal(plan.lateMs, 7 * 60 * 60 * 1000);
});

test('resolveSchedulePhase waits instead of preparing hours early after a boot', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-11T00:30:00+08:00'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'idle');
  assert.equal(plan.dateKey, '2026-11-10');
});

test('resolveSchedulePhase does not prepare hours early after a boot', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T06:00:00+08:00'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'idle');
  assert.equal(plan.dateKey, '2026-11-09');
  assert.equal(plan.lateMs, 22 * 60 * 60 * 1000);
});

test('resolveSchedulePhase does not chase yesterday just before the prepare window', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T07:44:00+08:00'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'idle');
  assert.equal(plan.dateKey, '2026-11-09');
});

test('resolveSchedulePhase prepares inside the early window', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T07:46:00+08:00'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'prepare');
  assert.equal(plan.dateKey, '2026-11-10');
});

test('resolveSchedulePhase does not start a stale catch-up right before the next publish', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T23:49:00+08:00'),
    schedule: { time: '00:05', prepareLeadMin: 10 },
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(plan.phase, 'idle');
  assert.equal(plan.dateKey, '2026-11-10');
});

test('resolveSchedulePhase uses the configured timezone, not the host zone', () => {
  const plan = resolveSchedulePhase({
    now: new Date('2026-11-10T02:00:00Z'),
    schedule: { time: '08:00', prepareLeadMin: 10 },
    timeZone: 'America/New_York',
  });
  assert.equal(plan.phase, 'publish');
  assert.equal(plan.dateKey, '2026-11-09');
});
