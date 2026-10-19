/* P02L server — Step 1+2+3: static files, server-authoritative timer,
   crash-safe persistence, and an append-only action journal.
   Node built-ins only (http, fs, path, crypto) — zero npm dependencies on
   purpose, so the club PC never needs internet after Node itself is
   installed once.
   Money/cashdesk/prize logic is untouched — it still lives in each browser's
   localStorage, exactly as before. The server only owns the timer clock and
   (as of Step 3) a record of who did what. */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var timerEngine = require("./timer-engine");
var persistence = require("./persistence");
var journal = require("./journal");

var ROOT = __dirname;
var PORT = process.env.PORT || 8080;
var TICK_MS = 250;
var HEARTBEAT_MS = 5000;
var DATA_FILE = path.join(ROOT, "data", "timer-state.json");
var JOURNAL_FILE = path.join(ROOT, "data", "journal.jsonl");

var timer = timerEngine.createTimer();

// ---------- Step 2: load persisted state, recover from an unclean shutdown ----------
var recoveredBanner = null; // {remainingMs, levelIndex} | null — shown once in admin until dismissed
(function loadAndRecover() {
  var persisted = persistence.readJson(DATA_FILE);
  if (!persisted || !persisted.raw) return; // first run ever, or nothing usable on disk
  var result = timerEngine.computeRecovery(persisted.raw, persisted.lastHeartbeatAt || 0);
  timer.restoreState(result.restored);
  recoveredBanner = result.recovered;
  if (recoveredBanner) {
    console.log(
      "P02L: recovered after an unclean shutdown — level " + (recoveredBanner.levelIndex + 1) +
      ", " + Math.round(recoveredBanner.remainingMs / 1000) + "s remaining, resuming paused."
    );
  }
})();

function persistNow() {
  persistence.atomicWriteJson(DATA_FILE, {
    raw: timer.exportState(),
    lastHeartbeatAt: Date.now(),
  });
}
persistNow(); // establish a baseline file immediately, even before any action

// ---------- Step 3: append-only journal ----------
// "device" is ПК vs телефон+IP per spec — only the server can see the real
// remote address, so this can only be filled in here, not by the client.
// Everything is "ПК" until Step 4 actually opens the server to the network.
function inferDevice(req) {
  var ip = (req.socket.remoteAddress || "").replace("::ffff:", "");
  if (ip === "127.0.0.1" || ip === "::1" || ip === "") return "ПК";
  return "телефон/др. устройство · " + ip;
}
function logEntry(req, patch) {
  var entry = Object.assign(
    { id: crypto.randomBytes(4).toString("hex"), at: Date.now(), device: inferDevice(req) },
    patch
  );
  journal.appendEntry(JOURNAL_FILE, entry);
  return entry;
}
// the 250ms auto-advance tick has no HTTP request to read a device from —
// it's the server acting on its own, label it plainly instead of guessing
function logAutoEntry(patch) {
  var entry = Object.assign(
    { id: crypto.randomBytes(4).toString("hex"), at: Date.now(), device: "авто" },
    patch
  );
  journal.appendEntry(JOURNAL_FILE, entry);
  return entry;
}

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// snapshot() plus the one-shot recovery banner, if any — this is what every
// /api/timer response (GET and the action POSTs) returns to the client
function fullSnapshot() {
  var snap = timer.snapshot();
  snap.recovered = recoveredBanner;
  return snap;
}
function timerLogShape(snap) {
  return { status: snap.status, levelIndex: snap.levelIndex, remainingMs: Math.round(snap.remainingMs) };
}

function readJsonBody(req, cb) {
  var data = "";
  var tooBig = false;
  req.on("data", function (chunk) {
    data += chunk;
    if (data.length > 1e6) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on("end", function () {
    if (tooBig) return;
    if (!data) return cb(null, {});
    try {
      cb(null, JSON.parse(data));
    } catch (e) {
      cb(e);
    }
  });
}

function serveStatic(req, res) {
  var urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  var filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, function (err, buf) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 not found: " + urlPath);
      return;
    }
    var ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

var server = http.createServer(function (req, res) {
  var urlParts = req.url.split("?");
  var url = urlParts[0];
  var query = new URLSearchParams(urlParts[1] || "");

  if (url === "/api/timer" && req.method === "GET") {
    return sendJson(res, 200, fullSnapshot());
  }
  if (url === "/api/timer/levels" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || !Array.isArray(body.durationsSec)) return sendJson(res, 400, { error: "bad body" });
      timer.setDurations(body.durationsSec);
      persistNow();
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/start" && req.method === "POST") {
    var beforeStart = timerLogShape(timer.snapshot());
    timer.start();
    persistNow();
    // skip the journal entry for a no-op double-click (engine already made
    // start()/pause() idempotent — this just keeps the journal from filling
    // with "Старт: running -> running" noise from an impatient double-tap)
    if (beforeStart.status !== "running") {
      logEntry(req, { type: "timer", action: "Старт", before: beforeStart, after: timerLogShape(timer.snapshot()) });
    }
    return sendJson(res, 200, fullSnapshot());
  }
  if (url === "/api/timer/pause" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      var beforePause = timerLogShape(timer.snapshot());
      var reason = body && body.reason;
      timer.pause(reason);
      persistNow();
      if (beforePause.status !== "paused") {
        logEntry(req, { type: "timer", action: "Пауза", before: beforePause, after: timerLogShape(timer.snapshot()), reason: reason || null });
      }
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/level" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.index !== "number") return sendJson(res, 400, { error: "bad body" });
      var beforeLevel = timerLogShape(timer.snapshot());
      timer.setLevel(body.index);
      persistNow();
      logEntry(req, { type: "timer", action: "Смена уровня", before: beforeLevel, after: timerLogShape(timer.snapshot()) });
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/adjust" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.deltaMs !== "number") return sendJson(res, 400, { error: "bad body" });
      var beforeAdjust = timerLogShape(timer.snapshot());
      timer.adjust(body.deltaMs);
      persistNow();
      logEntry(req, { type: "timer", action: "Правка времени (" + (body.deltaMs > 0 ? "+" : "") + Math.round(body.deltaMs / 1000) + " с)", before: beforeAdjust, after: timerLogShape(timer.snapshot()) });
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/set" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.sec !== "number") return sendJson(res, 400, { error: "bad body" });
      var beforeSet = timerLogShape(timer.snapshot());
      timer.setExact(body.sec);
      persistNow();
      logEntry(req, { type: "timer", action: "Правка времени (точно)", before: beforeSet, after: timerLogShape(timer.snapshot()) });
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/dismiss-recovered" && req.method === "POST") {
    recoveredBanner = null;
    return sendJson(res, 200, fullSnapshot());
  }

  // Step 3: client-originated entries — money/cashdesk/settings changes still
  // live in each browser's localStorage (untouched), the client just also
  // reports them here so there's one durable, cross-device record. Server
  // fills in id/at/device; client supplies type/action/before/after/reason.
  if (url === "/api/journal" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || !body.type || !body.action) return sendJson(res, 400, { error: "bad body" });
      var entry = logEntry(req, {
        type: String(body.type),
        action: String(body.action),
        before: body.before != null ? body.before : null,
        after: body.after != null ? body.after : null,
        reason: body.reason || null,
      });
      sendJson(res, 200, entry);
    });
  }
  if (url === "/api/journal" && req.method === "GET") {
    var all = journal.readEntries(JOURNAL_FILE);
    var type = query.get("type");
    if (type && type !== "all") all = all.filter(function (e) { return e.type === type; });
    var limit = parseInt(query.get("limit"), 10) || 200;
    var page = all.slice(-limit).reverse(); // newest first
    return sendJson(res, 200, { entries: page, total: all.length });
  }

  serveStatic(req, res);
});

setInterval(function () {
  if (timer.tick()) {
    persistNow(); // a level just auto-advanced — that's a change, persist it immediately
    logAutoEntry({ type: "timer", action: "Автопереход уровня", before: null, after: timerLogShape(timer.snapshot()) });
  }
}, TICK_MS);

setInterval(function () {
  if (timer.snapshot().status === "running") persistNow(); // heartbeat while running, per spec
}, HEARTBEAT_MS);

// opens the default browser the same way the old PowerShell static server
// used to (Start-Process) — works regardless of how this process was
// launched (the .bat, `npm start`, or `node server.js` by hand)
function openBrowser(url) {
  var cmd = process.platform === "win32" ? 'start "" "' + url + '"'
    : process.platform === "darwin" ? 'open "' + url + '"'
    : 'xdg-open "' + url + '"';
  require("child_process").exec(cmd, function () {});
}

server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.log("Не удалось запустить сервер на порту " + PORT + " — он уже занят (возможно, P02L уже запущен).");
    console.log("Если P02L уже открыт в браузере, просто откройте новую вкладку: http://localhost:" + PORT + "/index.html");
  } else {
    console.log("Ошибка сервера: " + err.message);
  }
  // the tick/heartbeat intervals above would otherwise keep this process
  // alive forever even though it never actually started listening
  process.exit(1);
});

server.listen(PORT, function () {
  var url = "http://localhost:" + PORT + "/index.html";
  console.log("P02L server: http://localhost:" + PORT + "/");
  console.log("Держите это окно открытым, пока используете систему. Чтобы остановить — закройте окно или Ctrl+C.");
  openBrowser(url);
});

module.exports = { server: server, timer: timer };
