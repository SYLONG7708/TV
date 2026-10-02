import assert from 'node:assert/strict';
import test from 'node:test';
import { clamp, formatTime, seekTarget, subtitleToVtt } from '../docs/iphone/player-controls.mjs';
const ranges = pairs => ({ length: pairs.length, start: i => pairs[i][0], end: i => pairs[i][1] });
test('time display handles live, unknown, seconds and long movies', () => {
  assert.equal(formatTime(Infinity), '--:--'); assert.equal(formatTime(NaN), '--:--');
  assert.equal(formatTime(-1), '--:--'); assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(61.8), '01:01'); assert.equal(formatTime(3661), '1:01:01');
});
test('seek is bounded to VOD and avoids seeking exactly past the last frame', () => {
  assert.equal(seekTarget(-100, null, 60), 0);
  assert.equal(seekTarget(100, null, 60), 59.95);
  assert.equal(seekTarget(10, null, Infinity), null);
});
test('live seek follows the moving window and skips unavailable gaps', () => {
  const live = ranges([[50, 70], [80, 100]]);
  assert.equal(seekTarget(0, live, Infinity), 50);
  assert.equal(seekTarget(55, live, Infinity), 55);
  assert.equal(seekTarget(75, live, Infinity), 80);
  assert.equal(seekTarget(500, live, Infinity), 99.95);
});
test('SRT import converts UTF-8 BOM, CRLF and cue timestamps without altering content', () => {
  assert.equal(subtitleToVtt('\uFEFF1\r\n00:00:01,200 --> 00:00:03,900\r\n繁體字幕\r\n'), 'WEBVTT\n\n1\n00:00:01.200 --> 00:00:03.900\n繁體字幕\n');
});
test('WebVTT stays valid and unsupported or oversized input is rejected', () => {
  assert.equal(subtitleToVtt('WEBVTT\n\n00:00.000 --> 00:02.000\nHello'), 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n');
  assert.throws(() => subtitleToVtt('<html>error</html>'), /UTF-8/);
  assert.throws(() => subtitleToVtt('a'.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});
test('volume bounds reject NaN and prevent out-of-range media assignments', () => {
  assert.equal(clamp('bad', 0, 1), 0); assert.equal(clamp(2, 0, 1), 1); assert.equal(clamp(-1, 0, 1), 0);
});
