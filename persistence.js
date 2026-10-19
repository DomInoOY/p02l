/* P02L — atomic JSON persistence for the timer state (Step 2).
   Node built-ins only. Write is tmp-file + rename so a crash mid-write never
   leaves a half-written, unparsable state file on disk. */
"use strict";

var fs = require("fs");
var path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWriteJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  var tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
  fs.renameSync(tmp, filePath); // atomic replace on the same filesystem (POSIX and NTFS)
}

function readJson(filePath) {
  try {
    var raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return null; // missing file, first run ever, or a corrupt/partial read — treat as "nothing to recover"
  }
}

module.exports = { atomicWriteJson: atomicWriteJson, readJson: readJson };
