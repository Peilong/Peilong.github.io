/* Code Word rules: word lengths, number of guesses, the clue marks for a guess, and the daily numbering.
   Pure functions, loaded by both the page and the leaderboard server (workers/games). The answers are NOT here:
   they live only on the server, which checks every guess, so they can't be read from this public file. */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.CodeWordCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_LEN = 4, MAX_LEN = 7;
  var EPOCH = '2026-11-25';            // Code Word #1 (launch day). Changing it changes every day's word.
  var TIME_ZONE = 'America/New_York';  // a new word every midnight, Eastern time

  // Marks: 2 = right letter, right spot; 1 = in the word, but elsewhere; 0 = not in the word (or no copies left).
  var EXACT = 2, ELSEWHERE = 1, ABSENT = 0;

  function triesFor(length) { return length + 1; }

  function clean(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

  // Right-spot letters are marked first; then each remaining letter is "elsewhere" only while the answer still has
  // an unmatched copy of it. So guessing LEVEL for HOTEL marks only one of the two Ls.
  function marks(guess, answer) {
    var out = [], left = {}, i;
    for (i = 0; i < answer.length; i++) {
      if (guess[i] === answer[i]) out[i] = EXACT;
      else { out[i] = ABSENT; left[answer[i]] = (left[answer[i]] || 0) + 1; }
    }
    for (i = 0; i < answer.length; i++) {
      if (out[i] !== EXACT && left[guess[i]]) { out[i] = ELSEWHERE; left[guess[i]]--; }
    }
    return out;
  }

  // Best mark known so far for each letter, from all guesses: { a: 2, e: 0, ... }.
  function letterStates(guesses, markRows) {
    var best = {};
    guesses.forEach(function (g, r) {
      for (var i = 0; i < g.length; i++) {
        var m = markRows[r][i];
        if (best[g[i]] === undefined || m > best[g[i]]) best[g[i]] = m;
      }
    });
    return best;
  }

  function dateKey(now) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now === undefined ? Date.now() : now));
    var get = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }

  function dayNumber(key) {
    var toDays = function (k) { var p = k.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };
    return toDays(key) - toDays(EPOCH) + 1;
  }

  function shiftDay(key, delta) {
    var p = key.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta)).toISOString().slice(0, 10);
  }

  return {
    MIN_LEN: MIN_LEN, MAX_LEN: MAX_LEN, EPOCH: EPOCH, TIME_ZONE: TIME_ZONE, EXACT: EXACT, ELSEWHERE: ELSEWHERE, ABSENT: ABSENT,
    triesFor: triesFor, clean: clean, marks: marks, letterStates: letterStates, dateKey: dateKey, dayNumber: dayNumber,
    shiftDay: shiftDay
  };
}));
