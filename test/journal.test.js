"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var journal = require("../journal");

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p02l-journal-test-")), "journal.jsonl");
}

test("appendEntry + readEntries round-trip, preserves insertion order", function () {
  var file = tmpFile();
  journal.appendEntry(file, { id: "1", action: "Старт" });
  journal.appendEntry(file, { id: "2", action: "Пауза" });
  journal.appendEntry(file, { id: "3", action: "Смена уровня" });
  var entries = journal.readEntries(file);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(function (e) { return e.id; }), ["1", "2", "3"]);
});

test("readEntries on a missing file returns an empty array, not a throw", function () {
  var file = tmpFile();
  assert.deepEqual(journal.readEntries(file), []);
});

test("readEntries skips a corrupt/half-written last line instead of failing the whole read", function () {
  var file = tmpFile();
  journal.appendEntry(file, { id: "1", action: "Старт" });
  fs.appendFileSync(file, '{"id":"2","action":"Па'); // simulates a crash mid-append, no trailing newline
  var entries = journal.readEntries(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "1");
});

test("append is cheap — doesn't rewrite earlier entries (unlike atomicWriteJson)", function () {
  var file = tmpFile();
  for (var i = 0; i < 50; i++) journal.appendEntry(file, { id: String(i) });
  var entries = journal.readEntries(file);
  assert.equal(entries.length, 50);
  assert.equal(entries[0].id, "0");
  assert.equal(entries[49].id, "49");
});
