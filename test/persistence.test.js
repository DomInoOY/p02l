"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var persistence = require("../persistence");

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p02l-test-")), "state.json");
}

test("atomicWriteJson + readJson round-trip", function () {
  var file = tmpFile();
  var data = { status: "running", levelIndex: 3, endsAt: 123456 };
  persistence.atomicWriteJson(file, data);
  assert.deepEqual(persistence.readJson(file), data);
});

test("atomic write leaves no .tmp file behind after success", function () {
  var file = tmpFile();
  persistence.atomicWriteJson(file, { a: 1 });
  assert.equal(fs.existsSync(file + ".tmp"), false);
  assert.equal(fs.existsSync(file), true);
});

test("readJson on a missing file returns null instead of throwing", function () {
  var file = tmpFile(); // created dir but never written
  assert.equal(persistence.readJson(file), null);
});

test("readJson on a corrupt file returns null instead of throwing", function () {
  var file = tmpFile();
  fs.writeFileSync(file, "{not valid json", "utf8");
  assert.equal(persistence.readJson(file), null);
});

test("overwriting an existing file replaces its content atomically", function () {
  var file = tmpFile();
  persistence.atomicWriteJson(file, { v: 1 });
  persistence.atomicWriteJson(file, { v: 2 });
  assert.deepEqual(persistence.readJson(file), { v: 2 });
});
