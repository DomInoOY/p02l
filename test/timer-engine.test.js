"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var createTimer = require("../timer-engine").createTimer;

// fake clock: now() reads a mutable counter, advance() moves it forward —
// lets us test "wait 60s" without a real 60s sleep
function fakeClock(startMs) {
  var t = startMs || 1700000000000;
  return {
    now: function () { return t; },
    advance: function (ms) { t += ms; },
  };
}

function minutes(m) { return m * 60; }

test("а) старт -> пауза на 10:30 -> ждать 60с -> старт: остаток не сброшен, идёт вниз", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20)]); // 1200s level
  timer.start();

  clock.advance((1200 - 630) * 1000); // run down to 10:30 remaining
  var paused = timer.pause();
  assert.equal(paused.status, "paused");
  assert.equal(Math.round(paused.remainingMs / 1000), 630);

  clock.advance(60 * 1000); // wait 60s while paused — must NOT change remaining
  var stillPaused = timer.snapshot();
  assert.equal(Math.round(stillPaused.remainingMs / 1000), 630, "remaining must not decay while paused");

  var resumed = timer.start();
  assert.equal(resumed.status, "running");
  assert.equal(Math.round(resumed.remainingMs / 1000), 630, "resume must start exactly from the paused value");

  clock.advance(1000);
  assert.equal(Math.round(timer.snapshot().remainingMs / 1000), 629, "and then count down normally");
});

test("б) пауза -> правка на 12:00 -> старт: идёт с 12:00", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20)]);
  timer.start();
  clock.advance(5000);
  timer.pause();

  var edited = timer.setExact(12 * 60);
  assert.equal(edited.remainingMs, 12 * 60 * 1000);

  var resumed = timer.start();
  assert.equal(resumed.status, "running");
  assert.equal(resumed.remainingMs, 12 * 60 * 1000);
  assert.equal(resumed.endsAt, clock.now() + 12 * 60 * 1000);
});

test("в) правка времени на ходу (adjust/setExact while running)", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20)]);
  timer.start();
  clock.advance(10000); // 10s elapsed, 1190s left

  var afterAdjust = timer.adjust(+60000); // +1 min button
  assert.equal(Math.round(afterAdjust.remainingMs / 1000), 1250);
  assert.equal(afterAdjust.status, "running");
  assert.equal(afterAdjust.endsAt, clock.now() + afterAdjust.remainingMs);

  var afterSet = timer.setExact(5 * 60); // exact mm:ss input while running
  assert.equal(afterSet.remainingMs, 5 * 60 * 1000);
  assert.equal(afterSet.endsAt, clock.now() + 5 * 60 * 1000);

  clock.advance(2000);
  assert.equal(Math.round(timer.snapshot().remainingMs / 1000), 5 * 60 - 2);
});

test("ручная смена уровня: остаток = полная длительность нового уровня, статус сохраняется", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20), minutes(15), minutes(25)]);
  timer.start();
  clock.advance(100000);
  timer.pause(); // paused mid-level 0

  var moved = timer.setLevel(2);
  assert.equal(moved.levelIndex, 2);
  assert.equal(moved.status, "paused", "status must be preserved across a manual level change");
  assert.equal(moved.remainingMs, 25 * 60 * 1000);

  var resumed = timer.start();
  assert.equal(resumed.levelIndex, 2);
  assert.equal(resumed.status, "running");
});

test("автопереход по 0: при беге до конца уровня переходит на следующий, на последнем — стоит", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(1), minutes(2)]);
  timer.start();
  clock.advance(61 * 1000); // past end of level 0
  var advanced = timer.tick();
  assert.equal(advanced, true);
  var s = timer.snapshot();
  assert.equal(s.levelIndex, 1);
  assert.equal(Math.round(s.remainingMs / 1000), 120);

  clock.advance(121 * 1000); // past end of the LAST level
  var atEnd = timer.tick();
  assert.equal(atEnd, false, "no next level — stays put, does not wrap or crash");
  assert.equal(timer.snapshot().levelIndex, 1);
});

test("д) двойное 'пауза' на паузе и двойной 'старт' на ходу — no-op", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20)]);

  var p1 = timer.pause(); // already paused by default
  var p2 = timer.pause();
  assert.deepEqual(p1, p2, "pausing an already-paused timer changes nothing");

  timer.start();
  clock.advance(5000);
  var r1 = timer.snapshot();
  var r2 = timer.start(); // already running
  assert.equal(r2.endsAt, r1.endsAt, "starting an already-running timer must not shift endsAt");
});

test("setDurations clamps levelIndex if the structure shrank", function () {
  var clock = fakeClock();
  var timer = createTimer({ now: clock.now });
  timer.setDurations([minutes(20), minutes(15), minutes(25)]);
  timer.setLevel(2);
  var shrunk = timer.setDurations([minutes(20)]); // structure now has only 1 level
  assert.equal(shrunk.levelIndex, 0);
  assert.equal(shrunk.remainingMs, minutes(20) * 1000);
});
