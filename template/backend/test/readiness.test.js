import test from 'node:test';
import assert from 'node:assert/strict';
import { businessReadiness, knownCapacity, windowTime } from '../readiness.js';

const window = { openAt: '2026-10-01T09:00:00+08:00', closeAt: '2026-10-31T17:00:00+08:00' };
const complete = () => ({ event: { capacity: 100 }, attendance: { ...window }, submission: { ...window } });

test('readiness depends on facts, independently for each application, and ignores optimistic cached flags', () => {
  assert.deepEqual(businessReadiness(complete()), { mode: 'ready', unresolved: [], attendanceEnabled: true, submissionEnabled: true });
  const cfg = complete(); cfg.attendance.openAt = null; cfg.readiness = { mode: 'ready', unresolved: [], attendanceEnabled: true, submissionEnabled: true };
  const readiness = businessReadiness(cfg);
  assert.equal(readiness.mode, 'preview'); assert.equal(readiness.attendanceEnabled, false); assert.equal(readiness.submissionEnabled, true);
  assert.deepEqual(readiness.unresolved.map(item => item.key), ['attendance.openAt']);
  cfg.event.capacity = null;
  assert.equal(businessReadiness(cfg).submissionEnabled, false);
  assert.deepEqual(businessReadiness(cfg).unresolved.map(item => item.key), ['event.capacity', 'attendance.openAt']);
});

test('missing, malformed, date-only and backwards application windows never become unrestricted final windows', () => {
  for (const value of [null, undefined, '', '1970', '2026-10-01', '2026-10-01T09:00:00', 'not-a-date', '2026-02-30T09:00:00Z', '2026-13-01T09:00:00Z', '2026-10-01T24:00:00Z']) {
    assert.equal(Number.isFinite(windowTime(value)), false, String(value));
    const cfg = complete(); cfg.submission.closeAt = value;
    assert.equal(businessReadiness(cfg).submissionEnabled, false, String(value));
    assert.equal(businessReadiness(cfg).attendanceEnabled, true, String(value));
  }
  assert.equal(windowTime('2026-10-01T09:00Z'), Date.parse('2026-10-01T09:00Z'));
  assert.equal(windowTime('2026-10-01T09:00:00.123+08:00'), Date.parse('2026-10-01T09:00:00.123+08:00'));
  const backwards = complete(); backwards.submission.closeAt = backwards.submission.openAt;
  assert.equal(businessReadiness(backwards).submissionEnabled, false);
});

test('unknown or invalid capacity stays unknown; it is never synthesized as a limit', () => {
  for (const capacity of [null, undefined, 0, -1, 1.5, '1', true, [], 2147483648]) {
    const cfg = complete(); cfg.event.capacity = capacity;
    assert.equal(knownCapacity(cfg), null); assert.equal(businessReadiness(cfg).attendanceEnabled, false); assert.equal(businessReadiness(cfg).submissionEnabled, false);
  }
  assert.equal(knownCapacity(complete()), 100);
});
