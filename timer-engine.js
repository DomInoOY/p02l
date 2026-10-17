/* P02L — pure timer state machine (server-side source of truth for Step 1).
   No I/O, no HTTP, no Date.now() calls of its own — the caller injects "now"
   so this file can be unit-tested without real wall-clock waits. */
"use strict";

function createTimer(opts) {
  opts = opts || {};
  var now = opts.now || Date.now;

  var state = {
    status: "paused", // "running" | "paused" — binary, per spec; no separate "stopped"
    levelIndex: 0,
    remainingMs: 0, // authoritative while paused
    endsAt: null, // authoritative while running (epoch ms)
    pauseReason: null,
    durationsSec: [], // parallel to admin's levels array, synced via setDurations
  };
  var durationsKnown = false; // true once setDurations has run at least once

  function currentFullMs() {
    var d = state.durationsSec[state.levelIndex];
    return (d != null ? d : 0) * 1000;
  }

  function remainingNowMs() {
    if (state.status === "running") return Math.max(0, state.endsAt - now());
    return Math.max(0, state.remainingMs);
  }

  function snapshot() {
    return {
      serverNow: now(),
      status: state.status,
      levelIndex: state.levelIndex,
      remainingMs: remainingNowMs(),
      endsAt: state.endsAt,
      pauseReason: state.pauseReason,
      levelCount: state.durationsSec.length,
    };
  }

  // called by admin whenever the blind structure changes — keeps the server
  // able to compute "full duration of level N" without owning sb/bb/ante
  function setDurations(durationsSec) {
    state.durationsSec = durationsSec.slice();
    // reset remainingMs to the current level's full duration on the very
    // first sync (nothing else has set it yet) or when the structure shrank
    // under the current level index — but NOT on every later resync, so
    // tweaking other levels' durations mid-tournament doesn't touch the
    // live countdown (full "don't touch the running level" rule is Step 4)
    if (!durationsKnown || state.levelIndex >= state.durationsSec.length) {
      state.levelIndex = Math.max(0, Math.min(state.levelIndex, state.durationsSec.length - 1));
      state.remainingMs = currentFullMs();
      state.endsAt = state.status === "running" ? now() + state.remainingMs : null;
    }
    durationsKnown = true;
    return snapshot();
  }

  function start() {
    if (state.status === "running") return snapshot(); // no-op, per spec
    state.status = "running";
    state.endsAt = now() + Math.max(0, state.remainingMs);
    state.pauseReason = null;
    return snapshot();
  }

  function pause(reason) {
    if (state.status === "paused") return snapshot(); // no-op, per spec
    state.remainingMs = Math.max(0, state.endsAt - now());
    state.status = "paused";
    state.endsAt = null;
    state.pauseReason = reason || null;
    return snapshot();
  }

  // manual level change: remainder = full duration of the new level,
  // status (running/paused) is preserved
  function setLevel(index) {
    if (state.durationsSec.length === 0) return snapshot();
    index = Math.max(0, Math.min(index, state.durationsSec.length - 1));
    state.levelIndex = index;
    state.remainingMs = currentFullMs();
    state.endsAt = state.status === "running" ? now() + state.remainingMs : null;
    return snapshot();
  }

  // relative manual edit (-1min/-10s/+10s/+1min buttons)
  function adjust(deltaMs) {
    var rem = Math.max(0, remainingNowMs() + deltaMs);
    state.remainingMs = rem;
    state.endsAt = state.status === "running" ? now() + rem : null;
    return snapshot();
  }

  // absolute manual edit (mm:ss input)
  function setExact(sec) {
    var rem = Math.max(0, sec * 1000);
    state.remainingMs = rem;
    state.endsAt = state.status === "running" ? now() + rem : null;
    return snapshot();
  }

  // auto-advance when a running level hits 0 — call this periodically.
  // Returns true if it advanced. Leaves behavior unchanged from before:
  // at the last level it just sits at 0 (no wraparound).
  function tick() {
    if (state.status !== "running") return false;
    if (state.endsAt == null || now() < state.endsAt) return false;
    var nextIdx = state.levelIndex + 1;
    if (nextIdx >= state.durationsSec.length) return false;
    state.levelIndex = nextIdx;
    state.remainingMs = currentFullMs();
    state.endsAt = now() + state.remainingMs;
    return true;
  }

  return {
    snapshot: snapshot,
    setDurations: setDurations,
    start: start,
    pause: pause,
    setLevel: setLevel,
    adjust: adjust,
    setExact: setExact,
    tick: tick,
  };
}

module.exports = { createTimer: createTimer };
