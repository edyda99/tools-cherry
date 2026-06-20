// test-timezone.js — unit tests for the pure time-zone module.
// Run via `npm test`. Uses fixed instants so DST behaviour is deterministic.
import assert from 'node:assert/strict';
import {
  tzOffsetMinutes, formatOffset, listTimeZones,
  zonedWallTime, wallTimeToInstant, convert
} from '../src/engine/timezone.js';

let pass = 0;
const t = (name, fn) => {
  fn();
  pass++;
  console.log('ok  - ' + name);
};

t('tzOffsetMinutes for fixed standard-time instants', () => {
  // 2026-01-15 12:00 UTC — northern-hemisphere winter (no US DST).
  const winter = new Date('2026-01-15T12:00:00Z');
  assert.equal(tzOffsetMinutes('UTC', winter), 0);
  assert.equal(tzOffsetMinutes('America/New_York', winter), -300); // EST
  assert.equal(tzOffsetMinutes('Asia/Tokyo', winter), 540);        // no DST
  assert.equal(tzOffsetMinutes('Asia/Kolkata', winter), 330);      // +05:30
});

t('tzOffsetMinutes reflects DST in summer', () => {
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(tzOffsetMinutes('America/New_York', summer), -240); // EDT
  assert.equal(tzOffsetMinutes('Europe/London', summer), 60);      // BST
});

t('formatOffset renders signed HH:MM', () => {
  assert.equal(formatOffset(0), 'UTC+00:00');
  assert.equal(formatOffset(330), 'UTC+05:30');
  assert.equal(formatOffset(-240), 'UTC-04:00');
  assert.equal(formatOffset(540), 'UTC+09:00');
  assert.equal(formatOffset(-330), 'UTC-05:30');
});

t('zonedWallTime reads the local clock', () => {
  const inst = new Date('2026-07-15T12:00:00Z');
  const tokyo = zonedWallTime('Asia/Tokyo', inst); // +9 -> 21:00 same day
  assert.deepEqual(
    [tokyo.year, tokyo.month, tokyo.day, tokyo.hour, tokyo.minute],
    [2026, 7, 15, 21, 0]
  );
  const ny = zonedWallTime('America/New_York', inst); // -4 -> 08:00
  assert.equal(ny.hour, 8);
});

t('wallTimeToInstant round-trips through zonedWallTime', () => {
  const w = { year: 2026, month: 7, day: 15, hour: 9, minute: 30, second: 0 };
  const inst = wallTimeToInstant('America/New_York', w);
  const back = zonedWallTime('America/New_York', inst);
  assert.deepEqual([back.year, back.month, back.day, back.hour, back.minute], [2026, 7, 15, 9, 30]);
  // 09:30 EDT == 13:30 UTC
  assert.equal(inst.toISOString(), '2026-07-15T13:30:00.000Z');
});

t('convert maps a meeting time across zones', () => {
  // 09:00 in New York on a summer day -> 22:00 in Tokyo (NY +13h).
  const r = convert('America/New_York', 'Asia/Tokyo', {
    year: 2026, month: 7, day: 15, hour: 9, minute: 0, second: 0
  });
  assert.equal(r.to.hour, 22);
  assert.equal(r.to.day, 15);
  assert.equal(r.from.offset, -240);
  assert.equal(r.to.offset, 540);
});

t('convert crosses the date line forward', () => {
  // 23:00 in Los Angeles -> next-day morning in Tokyo.
  const r = convert('America/Los_Angeles', 'Asia/Tokyo', {
    year: 2026, month: 7, day: 15, hour: 23, minute: 0, second: 0
  });
  assert.equal(r.to.day, 16);
});

t('listTimeZones returns a non-trivial list including UTC', () => {
  const list = listTimeZones();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 5);
  assert.ok(list.includes('UTC') || list.includes('Etc/UTC'));
});

console.log(`\n${pass} passing`);
