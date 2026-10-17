/* P02L server — Step 1+2: static files, server-authoritative timer, and
   crash-safe persistence to disk.
   Node built-ins only (http, fs, path) — zero npm dependencies on purpose,
   so the club PC never needs internet after Node itself is installed once.
   Money/cashdesk/prize logic is untouched — it still lives in each browser's
   localStorage, exactly as before. Only the running/paused clock moved here. */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var timerEngine = require("./timer-engine");
var persistence = require("./persistence");

var ROOT = __dirname;
var PORT = process.env.PORT || 8080;
var TICK_MS = 250;
var HEARTBEAT_MS = 5000;
var DATA_FILE = path.join(ROOT, "data", "timer-state.json");

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
  var url = req.url.split("?")[0];

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
    timer.start();
    persistNow();
    return sendJson(res, 200, fullSnapshot());
  }
  if (url === "/api/timer/pause" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      timer.pause(body && body.reason);
      persistNow();
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/level" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.index !== "number") return sendJson(res, 400, { error: "bad body" });
      timer.setLevel(body.index);
      persistNow();
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/adjust" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.deltaMs !== "number") return sendJson(res, 400, { error: "bad body" });
      timer.adjust(body.deltaMs);
      persistNow();
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/set" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.sec !== "number") return sendJson(res, 400, { error: "bad body" });
      timer.setExact(body.sec);
      persistNow();
      sendJson(res, 200, fullSnapshot());
    });
  }
  if (url === "/api/timer/dismiss-recovered" && req.method === "POST") {
    recoveredBanner = null;
    return sendJson(res, 200, fullSnapshot());
  }

  serveStatic(req, res);
});

setInterval(function () {
  if (timer.tick()) persistNow(); // a level just auto-advanced — that's a change, persist it immediately
}, TICK_MS);

setInterval(function () {
  if (timer.snapshot().status === "running") persistNow(); // heartbeat while running, per spec
}, HEARTBEAT_MS);

server.listen(PORT, function () {
  console.log("P02L server: http://localhost:" + PORT + "/");
});

module.exports = { server: server, timer: timer };
