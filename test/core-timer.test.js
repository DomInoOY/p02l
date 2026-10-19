"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");

// core.js is a browser IIFE attached to `window` — shim just enough to load it in Node
global.window = global;
global.window.location = { protocol: "http:" };
global.document = { addEventListener: function () {} };
require("../core.js"); // attaches global.P02L as a side effect, no module.exports
var P = global.P02L;

test("timerRemainingSec: paused uses remainingMs, running uses endsAt-now", function () {
  var paused = { status: "paused", remainingMs: 65000, endsAt: null };
  assert.equal(P.timerRemainingSec(paused, 1000000), 65);

  var running = { status: "running", remainingMs: 0, endsAt: 1010000 };
  assert.equal(P.timerRemainingSec(running, 1000000), 10);
  assert.equal(P.timerRemainingSec(running, 1020000), 0, "never goes negative past endsAt");
});

test("е) часы клиента со смещением показывают то же время, что и остальные", function () {
  // server snapshot is the same for every client, regardless of their clock
  var snapshot = { serverNow: 5_000_000, status: "running", remainingMs: 0, endsAt: 5_600_000 };

  // "normal" client: its Date.now() happens to equal serverNow at poll time
  var normalClientLocalNow = 5_000_000;
  var normalOffset = snapshot.serverNow - normalClientLocalNow; // 0
  var normalDisplay = P.timerRemainingSec(snapshot, normalClientLocalNow + normalOffset);

  // "skewed" client: its clock is 5 minutes AHEAD of real time
  var skewedClientLocalNow = 5_000_000 + 5 * 60 * 1000;
  var skewedOffset = snapshot.serverNow - skewedClientLocalNow; // -300000
  var skewedDisplay = P.timerRemainingSec(snapshot, skewedClientLocalNow + skewedOffset);

  assert.equal(skewedClientLocalNow + skewedOffset, normalClientLocalNow + normalOffset, "offset cancels the skew exactly");
  assert.equal(skewedDisplay, normalDisplay, "a 5-minute-fast client must show the identical countdown");
  assert.equal(normalDisplay, 600);
});

test("elapsedTournamentSeconds sums finished levels plus progress into the current one", function () {
  var levels = [{ duration: 20 }, { duration: 15 }, { duration: 20 }];
  var timer = { status: "paused", levelIndex: 1, remainingMs: 5 * 60 * 1000 }; // 10 min into level 1 (15 min)
  var elapsed = P.elapsedTournamentSeconds(levels, timer, 0);
  assert.equal(elapsed, 20 * 60 + 10 * 60);
});
