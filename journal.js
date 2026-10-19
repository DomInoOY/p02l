/* P02L — append-only action journal (Step 3).
   Pure I/O helpers, no HTTP here — server.js wires this to the API and fills
   in device/IP (only the HTTP layer knows who's actually connecting).
   JSONL on disk (one entry per line) so a running tournament with hundreds
   of entries never needs a full-file rewrite just to add one more — append
   is the only disk operation on the hot path. */
"use strict";

var fs = require("fs");
var path = require("path");

function appendEntry(filePath, entry) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
}

// tolerant of a half-written last line (process died mid-append) — skips it
// instead of throwing, same "never let a crash corrupt the whole file" spirit
// as the atomic writes in persistence.js
function readEntries(filePath) {
  var raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return [];
  }
  var out = [];
  raw.split("\n").forEach(function (line) {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      // partial last line from a crash mid-append — drop it, not a parse we can trust
    }
  });
  return out;
}

module.exports = { appendEntry: appendEntry, readEntries: readEntries };
