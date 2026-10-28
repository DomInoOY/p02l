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

// Club policy, confirmed live mid-tournament: re-entry IS a rebuy for the
// SAME person (lost their stack, or just topped it up) — never a new player.
// So headcount (playersRemaining, and anywhere that drives TV/cashdesk
// "Игроков") is paid (buy-in) entries only, same as the payout bracket.
// Money and average stack still include re-entries — more chips and more
// cash really did enter play, that part was never in question.

test("playersRemaining counts buy-ins only — a re-entry is not a new player", function () {
  var f = freshState();
  var s = f.s;
  s.cashdesk.buyIns[f.entryId] = 9;
  s.cashdesk.reEntries[f.entryId] = 2;
  s.cashdesk.bustouts = 1;

  assert.equal(P.paidEntries(s), 9, "payout bracket and headcount both key off buy-ins");
  assert.equal(P.playersRemaining(s), 8, "9 buy-ins minus 1 bustout — the 2 re-entries don't add seats");
  // money/stack still see the re-entries — that money and those chips are real
  assert.equal(P.totalEntries(s), 11, "still used by moneyCollected/avgStack's numerator");
  assert.equal(P.moneyCollected(s), 11 * 3000, "re-entry money still counted");
});

test("avgStack divides by real headcount, not inflated entries — re-entry chips land on fewer people, correctly raising the average", function () {
  var f = freshState(); // tariff: stack 10000
  var s = f.s;
  s.cashdesk.buyIns[f.entryId] = 5;
  s.cashdesk.reEntries[f.entryId] = 1; // one of the 5 rebought — still 5 people, 6 stacks' worth of chips

  assert.equal(P.playersRemaining(s), 5);
  assert.equal(P.avgStack(s), Math.round((6 * 10000) / 5), "6 stacks' worth shared across the 5 people actually seated");
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

test("live scenario: 2 Стандарт + 4 Повышенный buy-ins, 2 Повышенный re-entries, 0 bustouts — 6 players, not 8", function () {
  var s = P.defaultState();
  var std = s.cashdesk.entryTariffs[0]; // "Стандарт"
  var boosted = { id: P.uid(), label: "Повышенный", price: 5000, stack: 20000 };
  s.cashdesk.entryTariffs.push(boosted);

  s.cashdesk.buyIns[std.id] = 2;
  s.cashdesk.buyIns[boosted.id] = 4;
  s.cashdesk.reEntries[boosted.id] = 2;

  assert.equal(P.paidEntries(s), 6, "2 + 4 buy-ins — this is what 'players' and the payout bracket now see");
  assert.equal(P.playersRemaining(s), 6, "nobody busted, all 6 still seated");
  assert.equal(P.totalEntries(s), 8, "still the right number for money/avgStack's numerator");
});
