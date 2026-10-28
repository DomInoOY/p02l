"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");

global.window = global;
global.window.location = { protocol: "http:" };
global.document = { addEventListener: function () {} };
require("../core.js");
var P = global.P02L;

function freshState() {
  var s = P.defaultState();
  var entryId = s.cashdesk.entryTariffs[0].id;
  var addonId = s.cashdesk.addonTariffs[0].id;
  return { s: s, entryId: entryId, addonId: addonId };
}

test("re-entry: hotfix — money/avgStack/playersRemaining unaffected, only payout bracket size", function () {
  var f = freshState(); // tariff: price 3000, stack 10000
  var s = f.s;
  s.cashdesk.buyIns[f.entryId] = 9;
  s.cashdesk.reEntries[f.entryId] = 2;
  s.cashdesk.bustouts = 1;

  // unchanged by the fix — same formula, same numbers as before
  assert.equal(P.totalEntries(s), 11, "buyIns+reEntries — still used by money/avgStack/playersRemaining");
  assert.equal(P.playersRemaining(s), 10, "11 seats filled minus 1 bustout");
  assert.equal(P.moneyCollected(s), 11 * 3000, "re-entry money still counted");
  assert.equal(P.avgStack(s), Math.round((11 * 10000) / 10), "re-entry stack still counted");

  // the actual fix: re-entries must not buy another paid place
  assert.equal(P.paidEntries(s), 9, "only buy-ins count toward the payout bracket");
});

test("payoutBreakdown picks its bracket off paidEntries, not totalEntries", function () {
  var f = freshState();
  var s = f.s;
  // 8 buy-ins alone sit on the boundary of the first bracket (max:8, 2 places);
  // 3 re-entries on top used to push totalEntries to 11 and jump to a wider
  // bracket (max:11, 3 places) — after the fix it must stay a 2-place payout
  s.cashdesk.buyIns[f.entryId] = 8;
  s.cashdesk.reEntries[f.entryId] = 3;

  var breakdown = P.payoutBreakdown(s);
  assert.equal(breakdown.length, 2, "bracket for 8 paid entries (re-entries must not widen it to 3 places)");

  var totalPaid = breakdown.reduce(function (sum, p) { return sum + p.amount; }, 0);
  var expectedPool = P.prizePoolTotal(s);
  assert.ok(Math.abs(totalPaid - expectedPool) <= 1, "payout still adds up to the full pool (re-entry money is still in it)");
});

test("re-entry still buys a real seat for TV/cashdesk headcounts (totalEntries), only the bracket excludes it", function () {
  var f = freshState();
  var s = f.s;
  s.cashdesk.buyIns[f.entryId] = 5;
  s.cashdesk.reEntries[f.entryId] = 1; // one player busted and rebought
  s.cashdesk.bustouts = 1;

  assert.equal(P.playersRemaining(s), 5, "the rebuying player is back at the table");
  assert.equal(P.paidEntries(s), 5, "but the rebuy didn't buy an extra paid place");
});
