/* P02L — shared state engine, used by every window (index/tv/admin/cashdesk/prize).
   Pure vanilla JS, zero external dependencies, fully offline.
   All windows must be opened from the SAME file path so they share one
   localStorage origin — that's what keeps them in sync on one PC. */

(function (global) {
  "use strict";

  var STORAGE_KEY = "p02l_state_v2";
  var EVT = "p02l:update";

  // ---------- payout % table (Olympic Poker Club structure, verbatim) ----------
  // each bracket's percentages sum to exactly 100%; "max" is the upper bound of
  // total entries (buy-ins + re-entries) that bracket covers.
  var PAYOUT_BRACKETS = [
    { max: 8, pct: [60, 40] },
    { max: 11, pct: [50, 30, 20] },
    { max: 20, pct: [40, 27, 19, 14] },
    { max: 30, pct: [36.0, 25.0, 17.5, 12.8, 8.7] },
    { max: 50, pct: [34.0, 23.0, 16.5, 11.9, 8.0, 6.6] },
    { max: 70, pct: [31.7, 20.7, 15.3, 10.8, 7.2, 5.8, 4.6, 3.9] },
    { max: 100, pct: [30.5, 19.5, 13.7, 10.0, 6.7, 5.4, 4.2, 3.7, 3.3, 3.0] },
    { max: 130, pct: [29.0, 18.7, 13.5, 9.5, 6.5, 5.2, 4.0, 3.4, 2.9, 2.6, 2.4, 2.3] },
    { max: Infinity, pct: [28.0, 18.0, 13.0, 9.3, 6.3, 5.0, 3.9, 3.3, 2.9, 2.55, 2.25, 2.0, 1.8, 1.7] },
  ];

  function pickBracket(entries) {
    for (var i = 0; i < PAYOUT_BRACKETS.length; i++) {
      if (entries <= PAYOUT_BRACKETS[i].max) return PAYOUT_BRACKETS[i];
    }
    return PAYOUT_BRACKETS[PAYOUT_BRACKETS.length - 1];
  }

  // ---------- helpers ----------
  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }
  function fmt(n) {
    if (n === null || n === undefined || isNaN(n)) return "0";
    return Math.round(n).toLocaleString("ru-RU");
  }
  function mmss(totalSec) {
    var s = Math.max(0, Math.floor(totalSec));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return String(m).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  }
  function hhmm(totalSec) {
    var s = Math.max(0, Math.floor(totalSec));
    return String(Math.floor(s / 3600)).padStart(2, "0") + ":" + String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  }
  function roundBlind(v) {
    if (v < 100) return Math.round(v / 5) * 5;
    if (v < 1000) return Math.round(v / 25) * 25;
    if (v < 10000) return Math.round(v / 100) * 100;
    return Math.round(v / 500) * 500;
  }

  // ---------- default data ----------
  function defaultLevels() {
    return [
      { id: uid(), sb: 25, bb: 50, ante: 0, duration: 20, isBreak: false },
      { id: uid(), sb: 50, bb: 100, ante: 0, duration: 20, isBreak: false },
      { id: uid(), sb: 75, bb: 150, ante: 0, duration: 20, isBreak: false },
      { id: uid(), sb: 100, bb: 200, ante: 200, duration: 20, isBreak: false },
      { id: uid(), sb: 0, bb: 0, ante: 0, duration: 15, isBreak: true },
      { id: uid(), sb: 150, bb: 300, ante: 300, duration: 20, isBreak: false },
      { id: uid(), sb: 200, bb: 400, ante: 400, duration: 20, isBreak: false },
      { id: uid(), sb: 300, bb: 600, ante: 600, duration: 20, isBreak: false },
    ];
  }

  function defaultState() {
    return {
      clubName: "P02L",
      levels: defaultLevels(),
      currentLevelIndex: 0,
      levelStartedAt: null,
      pausedRemainingSec: null,
      isRunning: false,
      isPaused: false,
      cashdesk: {
        open: false, // cashier screen stays locked until admin confirms today's prices
        rake: 10,
        // each tariff = {id, label, price, stack}; buy-in and re-entry share the
        // same tariff list (a club may offer e.g. a pricier "boosted stack" option)
        entryTariffs: [{ id: uid(), label: "Стандарт", price: 3000, stack: 10000 }],
        // each tariff = {id, label, price, chips}; add a second tariff for a "double addon"
        addonTariffs: [{ id: uid(), label: "Аддон", price: 2000, chips: 10000 }],
        buyIns: {}, // tariffId -> count
        reEntries: {}, // tariffId -> count
        addons: {}, // tariffId -> count
        bustouts: 0,
        log: [], // {id, type, tariffId, at} — most recent last; used for "undo last"
      },
      prize: { mode: "auto", manualTotal: 0, note: "" },
      updatedAt: Date.now(),
    };
  }

  // a saved cashdesk from before the per-tariff pricing redesign has
  // buyIns/reEntries/addons as plain numbers and no entryTariffs/addonTariffs —
  // merging that shape in would make every tariff-aware helper below throw,
  // so treat it as absent and fall back to a fresh cashdesk instead
  function isLegacyCashdesk(cd) {
    return !cd.entryTariffs || !cd.addonTariffs || typeof cd.buyIns === "number";
  }

  function mergeDefaults(s) {
    var d = defaultState();
    if (!s) return d;
    var cd = s.cashdesk && !isLegacyCashdesk(s.cashdesk) ? Object.assign({}, d.cashdesk, s.cashdesk) : d.cashdesk;
    return Object.assign({}, d, s, {
      cashdesk: cd,
      prize: Object.assign({}, d.prize, s.prize || {}),
    });
  }

  function sumMap(map) {
    var sum = 0;
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) sum += map[k];
    return sum;
  }

  // ---------- storage layer ----------
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return mergeDefaults(JSON.parse(raw));
    } catch (e) {
      console.error("loadState failed", e);
      return defaultState();
    }
  }

  function saveState(state) {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      // 'storage' only fires in OTHER windows, so tell this window directly too
      window.dispatchEvent(new CustomEvent(EVT, { detail: state }));
      return true;
    } catch (e) {
      console.error("saveState failed", e);
      return false;
    }
  }

  // calls `cb(state)` whenever state changes — from this window's own saves,
  // another window's saves (native 'storage' event), or a 1s safety poll
  // (file:// localStorage sync between windows is reliable in Chrome but this
  // costs nothing and guards against any edge case).
  function subscribe(cb) {
    var last = JSON.stringify(loadState());
    function onLocal(e) {
      cb(e.detail);
      last = JSON.stringify(e.detail);
    }
    function onStorage(e) {
      if (e.key && e.key !== STORAGE_KEY) return;
      var s = loadState();
      cb(s);
      last = JSON.stringify(s);
    }
    window.addEventListener(EVT, onLocal);
    window.addEventListener("storage", onStorage);
    var poll = setInterval(function () {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw && raw !== last) {
          last = raw;
          cb(JSON.parse(raw));
        }
      } catch (e) {
        /* storage unavailable this tick — next tick will retry */
      }
    }, 1000);
    return function unsubscribe() {
      window.removeEventListener(EVT, onLocal);
      window.removeEventListener("storage", onStorage);
      clearInterval(poll);
    };
  }

  // ---------- derived numbers ----------
  function totalEntries(state) {
    var cd = state.cashdesk;
    return sumMap(cd.buyIns) + sumMap(cd.reEntries);
  }
  function playersRemaining(state) {
    return Math.max(0, totalEntries(state) - state.cashdesk.bustouts);
  }
  function avgStack(state) {
    var rem = playersRemaining(state);
    if (rem <= 0) return 0;
    var cd = state.cashdesk, chips = 0;
    cd.entryTariffs.forEach(function (t) {
      chips += ((cd.buyIns[t.id] || 0) + (cd.reEntries[t.id] || 0)) * t.stack;
    });
    cd.addonTariffs.forEach(function (t) {
      chips += (cd.addons[t.id] || 0) * t.chips;
    });
    return Math.round(chips / rem);
  }
  function moneyCollected(state) {
    var cd = state.cashdesk, sum = 0;
    cd.entryTariffs.forEach(function (t) {
      sum += ((cd.buyIns[t.id] || 0) + (cd.reEntries[t.id] || 0)) * t.price;
    });
    cd.addonTariffs.forEach(function (t) {
      sum += (cd.addons[t.id] || 0) * t.price;
    });
    return sum;
  }
  function prizePoolAuto(state) {
    var gross = moneyCollected(state);
    return Math.max(0, gross * (1 - state.cashdesk.rake / 100));
  }
  function prizePoolTotal(state) {
    return state.prize.mode === "manual" ? state.prize.manualTotal : prizePoolAuto(state);
  }
  // returns [{place, amount}], rounded to nearest 100, remainder folded into 1st place
  function payoutBreakdown(state) {
    var entries = totalEntries(state);
    if (entries <= 0) return [];
    var bracket = pickBracket(entries);
    var total = prizePoolTotal(state);
    var raw = bracket.pct.map(function (p) {
      return (total * p) / 100;
    });
    var rounded = raw.map(function (v) {
      return Math.round(v / 100) * 100;
    });
    var sumRounded = rounded.reduce(function (a, b) {
      return a + b;
    }, 0);
    var diff = Math.round(total - sumRounded);
    if (rounded.length > 0) rounded[0] += diff;
    return rounded.map(function (amount, i) {
      return { place: i + 1, amount: amount, pct: bracket.pct[i] };
    });
  }

  // ---------- timer math ----------
  function levelRemaining(state, nowMs) {
    var lvl = state.levels[state.currentLevelIndex];
    if (!lvl) return 0;
    var full = lvl.duration * 60;
    if (state.isPaused || !state.isRunning) {
      return state.pausedRemainingSec != null ? state.pausedRemainingSec : full;
    }
    var elapsed = (nowMs - (state.levelStartedAt || nowMs)) / 1000;
    return full - elapsed;
  }
  function elapsedTournamentSeconds(state, nowMs) {
    var sec = 0;
    for (var i = 0; i < state.currentLevelIndex; i++) sec += state.levels[i].duration * 60;
    var lvl = state.levels[state.currentLevelIndex];
    if (lvl) sec += Math.max(0, lvl.duration * 60 - levelRemaining(state, nowMs));
    return sec;
  }
  function levelNumber(levels, idx) {
    var n = 0;
    for (var i = 0; i <= idx; i++) if (!levels[i].isBreak) n++;
    return n;
  }

  // ---------- sound (Web Audio — 100% offline, no network) ----------
  var sharedCtx = null;
  function getAudioCtx() {
    if (sharedCtx) return sharedCtx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      sharedCtx = new Ctx();
    } catch (e) {
      sharedCtx = null;
    }
    return sharedCtx;
  }
  function beep(opts) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    opts = opts || {};
    var freq = opts.freq || 880,
      duration = opts.duration || 0.15,
      type = opts.type || "sine",
      delay = opts.delay || 0,
      gain = opts.gain || 0.25;
    try {
      if (ctx.state === "suspended") ctx.resume();
      var t0 = ctx.currentTime + delay;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.03);
    } catch (e) {}
  }
  function playWarningSound() {
    beep({ freq: 1046.5, duration: 0.12, delay: 0, gain: 0.3 });
    beep({ freq: 1046.5, duration: 0.12, delay: 0.22, gain: 0.3 });
  }
  function playLevelChangeSound() {
    beep({ freq: 523.25, duration: 0.18, delay: 0, gain: 0.32 });
    beep({ freq: 659.25, duration: 0.18, delay: 0.16, gain: 0.32 });
    beep({ freq: 783.99, duration: 0.36, delay: 0.32, gain: 0.34 });
  }
  function playTickSound() {
    beep({ freq: 800, duration: 0.08, delay: 0, gain: 0.22, type: "square" });
  }
  function playClickSound() {
    beep({ freq: 660, duration: 0.07, delay: 0, gain: 0.18, type: "triangle" });
  }

  // speech synthesis uses the OS's own local voices — works fully offline,
  // unlike speech RECOGNITION which needs a network connection in Chrome.
  function speak(text) {
    try {
      if (!("speechSynthesis" in window)) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ru-RU";
      u.rate = 1.0;
      u.volume = 1.0;
      var voices = window.speechSynthesis.getVoices();
      var ru = voices.find(function (v) {
        return v.lang && v.lang.toLowerCase().indexOf("ru") === 0;
      });
      if (ru) u.voice = ru;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- voice command assistant ----------
  // Uses the browser's SpeechRecognition (webkitSpeechRecognition in Chrome).
  // IMPORTANT: Chrome's implementation sends audio to Google's servers to
  // transcribe it — it needs an internet connection and will not work on a
  // fully offline PC. It's included for when the machine does have a
  // connection (or for a laptop you drive the club from); the status
  // callback reports "no-speech-api" / "network" / "not-allowed" so the UI
  // can show an honest message instead of pretending it's listening.
  function createVoiceAssistant(opts) {
    opts = opts || {};
    var commands = opts.commands || []; // [{patterns:[...], action:fn, label:""}]
    var onStatus = opts.onStatus || function () {};
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      onStatus({ state: "unsupported" });
      return { start: function () {}, stop: function () {}, supported: false };
    }
    var rec = new Rec();
    rec.lang = opts.lang || "ru-RU";
    rec.continuous = true;
    rec.interimResults = false;
    var running = false;
    var wantRunning = false;

    rec.onresult = function (e) {
      var res = e.results[e.results.length - 1];
      var transcript = (res[0].transcript || "").toLowerCase().trim();
      onStatus({ state: "heard", text: transcript });
      for (var i = 0; i < commands.length; i++) {
        var cmd = commands[i];
        for (var j = 0; j < cmd.patterns.length; j++) {
          if (transcript.indexOf(cmd.patterns[j]) !== -1) {
            cmd.action(transcript);
            onStatus({ state: "matched", label: cmd.label, text: transcript });
            return;
          }
        }
      }
      onStatus({ state: "unmatched", text: transcript });
    };
    rec.onerror = function (e) {
      onStatus({ state: "error", error: e.error });
    };
    rec.onend = function () {
      running = false;
      if (wantRunning) {
        // Chrome stops recognition after a pause — restart automatically
        try { rec.start(); running = true; } catch (e) {}
      } else {
        onStatus({ state: "stopped" });
      }
    };

    return {
      supported: true,
      start: function () {
        wantRunning = true;
        try { rec.start(); running = true; onStatus({ state: "listening" }); } catch (e) {}
      },
      stop: function () {
        wantRunning = false;
        try { rec.stop(); } catch (e) {}
      },
    };
  }

  // visible safety net: if someone opens these pages by double-clicking the
  // file instead of through the server, warn them in the page itself — under
  // plain file:// Chrome treats each HTML file as a separate origin, so
  // tv/admin/cashdesk/prize would silently stop sharing data.
  if (window.location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
      var b = document.createElement("div");
      b.textContent = "⚠ Открыто напрямую, без сервера — окна могут не синхронизироваться между собой. Закройте и запустите через «Запустить P02L.bat».";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;background:#e2593f;color:#fff;text-align:center;padding:7px 10px;font-size:12px;z-index:99999;font-family:sans-serif;";
      document.body.appendChild(b);
    });
  }

  global.P02L = {
    STORAGE_KEY: STORAGE_KEY,
    loadState: loadState,
    saveState: saveState,
    subscribe: subscribe,
    defaultState: defaultState,
    defaultLevels: defaultLevels,
    uid: uid,
    sumMap: sumMap,
    fmt: fmt,
    mmss: mmss,
    hhmm: hhmm,
    roundBlind: roundBlind,
    totalEntries: totalEntries,
    playersRemaining: playersRemaining,
    avgStack: avgStack,
    moneyCollected: moneyCollected,
    prizePoolAuto: prizePoolAuto,
    prizePoolTotal: prizePoolTotal,
    payoutBreakdown: payoutBreakdown,
    levelRemaining: levelRemaining,
    elapsedTournamentSeconds: elapsedTournamentSeconds,
    levelNumber: levelNumber,
    getAudioCtx: getAudioCtx,
    playWarningSound: playWarningSound,
    playLevelChangeSound: playLevelChangeSound,
    playTickSound: playTickSound,
    playClickSound: playClickSound,
    speak: speak,
    createVoiceAssistant: createVoiceAssistant,
    PAYOUT_BRACKETS: PAYOUT_BRACKETS,
  };
})(window);
