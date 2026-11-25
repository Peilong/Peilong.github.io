/* Crack the Cipher rules: letter handling, letter counts, English letter frequency order, penalties and the daily
   numbering. The quotations and each day's letter swap live only on the server (workers/games), which checks answers,
   so neither can be read from this public file. */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.CipherCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPOCH = '2026-11-25';            // Crack the Cipher #1 (launch day). Changing it changes every day's quote.
  var TIME_ZONE = 'America/New_York';
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var ENGLISH_ORDER = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';   // letters from most to least common in English text
  var HINT_MS = 30000;                 // revealing a letter adds 30 s
  var MISS_MS = 15000;                 // a full answer with wrong letters adds 15 s

  function isLetter(ch) { return ch >= 'A' && ch <= 'Z'; }

  // The distinct letters in a ciphertext, most frequent first, with their counts.
  function letterCounts(text) {
    var counts = {};
    for (var i = 0; i < text.length; i++) if (isLetter(text[i])) counts[text[i]] = (counts[text[i]] || 0) + 1;
    return Object.keys(counts).map(function (k) { return { letter: k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || (a.letter < b.letter ? -1 : 1); });
  }

  // Replace each letter using a { A: 'Q', ... } map; other characters stay. Unknown letters become `blank`.
  function apply(text, map, blank) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      out += isLetter(ch) ? (map[ch] || (blank === undefined ? ch : blank)) : ch;
    }
    return out;
  }

  // A random letter swap where no letter stays itself, from a random() source.
  function derangement(random) {
    var letters = ALPHABET.split('');
    for (;;) {
      for (var i = letters.length - 1; i > 0; i--) {
        var j = Math.floor(random() * (i + 1)), t = letters[i]; letters[i] = letters[j]; letters[j] = t;
      }
      var ok = true;
      for (var k = 0; k < 26; k++) if (letters[k] === ALPHABET[k]) { ok = false; break; }
      if (ok) {
        var key = {};
        for (var m = 0; m < 26; m++) key[ALPHABET[m]] = letters[m];
        return key;                      // plain letter -> cipher letter
      }
    }
  }

  function invert(key) { var inv = {}; Object.keys(key).forEach(function (k) { inv[key[k]] = k; }); return inv; }

  // How many distinct cipher letters are wrong or missing in a guess { cipherLetter: plainLetter }.
  function wrongLetters(cipherText, plainText, guess) {
    var truth = {}, wrong = 0;
    for (var i = 0; i < cipherText.length; i++) if (isLetter(cipherText[i])) truth[cipherText[i]] = plainText[i];
    Object.keys(truth).forEach(function (c) { if (!guess || guess[c] !== truth[c]) wrong++; });
    return wrong;
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
    EPOCH: EPOCH, TIME_ZONE: TIME_ZONE, ALPHABET: ALPHABET, ENGLISH_ORDER: ENGLISH_ORDER, HINT_MS: HINT_MS, MISS_MS: MISS_MS,
    isLetter: isLetter, letterCounts: letterCounts, apply: apply, derangement: derangement, invert: invert,
    wrongLetters: wrongLetters, dateKey: dateKey, dayNumber: dayNumber, shiftDay: shiftDay
  };
}));
