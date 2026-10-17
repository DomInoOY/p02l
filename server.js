/* P02L server — Step 1: static files + server-authoritative timer.
   Node built-ins only (http, fs, path) — zero npm dependencies on purpose,
   so the club PC never needs internet after Node itself is installed once.
   Money/cashdesk/prize logic is untouched — it still lives in each browser's
   localStorage, exactly as before. Only the running/paused clock moved here. */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var createTimer = require("./timer-engine").createTimer;

var ROOT = __dirname;
var PORT = process.env.PORT || 8080;
var TICK_MS = 250;

var timer = createTimer();

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
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
    return sendJson(res, 200, timer.snapshot());
  }
  if (url === "/api/timer/levels" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || !Array.isArray(body.durationsSec)) return sendJson(res, 400, { error: "bad body" });
      sendJson(res, 200, timer.setDurations(body.durationsSec));
    });
  }
  if (url === "/api/timer/start" && req.method === "POST") {
    return sendJson(res, 200, timer.start());
  }
  if (url === "/api/timer/pause" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      sendJson(res, 200, timer.pause(body && body.reason));
    });
  }
  if (url === "/api/timer/level" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.index !== "number") return sendJson(res, 400, { error: "bad body" });
      sendJson(res, 200, timer.setLevel(body.index));
    });
  }
  if (url === "/api/timer/adjust" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.deltaMs !== "number") return sendJson(res, 400, { error: "bad body" });
      sendJson(res, 200, timer.adjust(body.deltaMs));
    });
  }
  if (url === "/api/timer/set" && req.method === "POST") {
    return readJsonBody(req, function (err, body) {
      if (err || typeof body.sec !== "number") return sendJson(res, 400, { error: "bad body" });
      sendJson(res, 200, timer.setExact(body.sec));
    });
  }

  serveStatic(req, res);
});

setInterval(function () {
  timer.tick();
}, TICK_MS);

server.listen(PORT, function () {
  console.log("P02L server: http://localhost:" + PORT + "/");
});

module.exports = { server: server, timer: timer };
