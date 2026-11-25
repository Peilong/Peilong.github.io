/* Bit Flip rules and scoring. Pure functions with no page code, so the leaderboard server can load this same
   file and re-score a submitted run exactly: a run is (seed, solve times), and everything else follows from it. */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.BitFlipCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GAME_MS = 60000;                 // one round
  var VALUES = [128, 64, 32, 16, 8, 4, 2, 1];
  var POINTS_PER_SWITCH = 10;          // a number is worth 10 points per switch it needs
  var FAST_MS = 5000;                  // solving within this keeps the streak going
  var STREAK_STEP = 3;                 // every 3 fast solves in a row add 1 to the multiplier
  var MAX_MULTIPLIER = 4;
  var ADVANCE_MS = 200;                // pause between a solve and the next number (counted in the next solve's time)
  var MIN_MS_BASE = 150;               // fastest believable solve: 150 ms + 100 ms per switch, plus the pause
  var MIN_MS_PER_SWITCH = 100;
  var MAX_SOLVES = 150;

  // Difficulty rises with the number of numbers already solved.
  var LEVELS = [
    { from: 0,  min: 1,   max: 15,  minBits: 1, maxBits: 2 },
    { from: 3,  min: 3,   max: 63,  minBits: 2, maxBits: 3 },
    { from: 7,  min: 17,  max: 255, minBits: 3, maxBits: 4 },
    { from: 12, min: 64,  max: 255, minBits: 4, maxBits: 5 },
    { from: 18, min: 128, max: 255, minBits: 5, maxBits: 7 }
  ];

  function bitCount(n) {
    var c = 0;
    while (n) { c += n & 1; n >>>= 1; }
    return c;
  }

  function toBinary(n) {
    return ('00000000' + (n >>> 0).toString(2)).slice(-8);
  }

  function levelAt(index) {
    var level = LEVELS[0];
    for (var i = 0; i < LEVELS.length; i++) if (index >= LEVELS[i].from) level = LEVELS[i];
    return level;
  }

  // Small seeded random generator (mulberry32): the same seed always deals the same numbers.
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Returns next(): the target numbers of one run, in order.
  function createDeck(seed) {
    var rand = mulberry32(seed >>> 0), prev = -1, index = 0;
    return function next() {
      var L = levelAt(index++), n, b;
      do {
        n = L.min + Math.floor(rand() * (L.max - L.min + 1));
        b = bitCount(n);
      } while (n === prev || b < L.minBits || b > L.maxBits);
      prev = n;
      return n;
    };
  }

  function multiplierFor(streak) {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_STEP));
  }

  // Score one solve. ms = time since the previous solve (or since the start).
  function scoreSolve(target, ms, streakBefore) {
    var streak = ms <= FAST_MS ? streakBefore + 1 : 0;
    var multiplier = multiplierFor(streak);
    return { streak: streak, multiplier: multiplier, points: bitCount(target) * POINTS_PER_SWITCH * multiplier };
  }

  // Score a whole run from its seed and solve times (whole ms since the start, increasing).
  function scoreRun(seed, solveTimes) {
    var next = createDeck(seed), last = 0, streak = 0, score = 0, bestStreak = 0;
    for (var i = 0; i < solveTimes.length; i++) {
      var s = scoreSolve(next(), solveTimes[i] - last, streak);
      streak = s.streak;
      score += s.points;
      if (streak > bestStreak) bestStreak = streak;
      last = solveTimes[i];
    }
    return { score: score, solved: solveTimes.length, bestStreak: bestStreak };
  }

  // For the server: null if the run is believable, otherwise the reason it is not.
  function validateRun(seed, solveTimes) {
    if (typeof seed !== 'number' || seed !== seed >>> 0) return 'bad seed';
    if (!Array.isArray(solveTimes) || solveTimes.length > MAX_SOLVES) return 'bad solve list';
    var next = createDeck(seed), last = 0;
    for (var i = 0; i < solveTimes.length; i++) {
      var t = solveTimes[i];
      if (typeof t !== 'number' || t !== Math.floor(t) || t <= last || t >= GAME_MS) return 'bad time at ' + i;
      var min = MIN_MS_BASE + MIN_MS_PER_SWITCH * bitCount(next()) + (i > 0 ? ADVANCE_MS : 0);
      if (t - last < min) return 'too fast at ' + i;
      last = t;
    }
    return null;
  }

  return {
    GAME_MS: GAME_MS, VALUES: VALUES, FAST_MS: FAST_MS, STREAK_STEP: STREAK_STEP,
    MAX_MULTIPLIER: MAX_MULTIPLIER, ADVANCE_MS: ADVANCE_MS,
    bitCount: bitCount, toBinary: toBinary, createDeck: createDeck, multiplierFor: multiplierFor,
    scoreSolve: scoreSolve, scoreRun: scoreRun, validateRun: validateRun
  };
}));
