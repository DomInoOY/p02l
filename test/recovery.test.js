"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var computeRecovery = require("../timer-engine").computeRecovery;

test("computeRecovery: already paused on disk — restored as-is, no banner", function () {
  var raw = { status: "paused", levelIndex: 2, remainingMs: 45000, endsAt: null, pauseReason: null, durationsSec: [1200, 900] };
  var result = computeRecovery(raw, 1_000_000);
  assert.equal(result.restored, raw);
  assert.equal(result.recovered, null);
});

test("г) перезапуск сервера на ходу: стартует paused, остаток = endsAt - lastHeartbeat (не до 'now')", function () {
  var raw = {
    status: "running",
    levelIndex: 1,
    remainingMs: 0,
    endsAt: 2_000_000, // was going to end at t=2,000,000
    pauseReason: null,
    durationsSec: [1200, 900],
  };
  var lastHeartbeatAt = 1_940_000; // last confirmed-alive checkpoint, 60s before endsAt
  var result = computeRecovery(raw, lastHeartbeatAt);

  assert.equal(result.restored.status, "paused", "must come back paused, never silently running");
  assert.equal(result.restored.remainingMs, 60000, "frozen at the last heartbeat, not recomputed against a later 'now'");
  assert.equal(result.restored.endsAt, null);
  assert.equal(result.restored.levelIndex, 1);
  assert.deepEqual(result.recovered, { remainingMs: 60000, levelIndex: 1 });
});

test("downtime that ran past endsAt clamps to 0, does not go negative or auto-skip levels", function () {
  var raw = { status: "running", levelIndex: 0, remainingMs: 0, endsAt: 1_000_000, durationsSec: [1200], pauseReason: null };
  var result = computeRecovery(raw, 1_500_000); // heartbeat itself was already past endsAt
  assert.equal(result.restored.remainingMs, 0);
  assert.equal(result.restored.levelIndex, 0, "stays on the level it crashed on — no silent multi-level skip");
});

test("no persisted file at all (first run ever) — nothing to recover", function () {
  var result = computeRecovery(null, Date.now());
  assert.equal(result.restored, null);
  assert.equal(result.recovered, null);
});
