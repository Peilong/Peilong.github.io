/* Logic Lights rules: gates, the daily circuit (easy on Monday, hardest on Sunday), practice circuits, evaluating
   switches, the fewest switches that light the bulb, and the try-everything search for "Watch a computer solve it".
   Pure functions, loaded by both the page and the leaderboard server (workers/games). */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.LogicLightsCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPOCH = '2026-11-25';            // Logic Lights #1 (launch day). The circuit itself comes from the date.
  var TIME_ZONE = 'America/New_York';

  var GATES = {
    AND: { arity: 2, rule: 'on only when both inputs are on', fn: function (a, b) { return a & b; } },
    OR:  { arity: 2, rule: 'on when at least one input is on', fn: function (a, b) { return a | b; } },
    XOR: { arity: 2, rule: 'on when exactly one input is on', fn: function (a, b) { return a ^ b; } },
    NOT: { arity: 1, rule: 'flips its input: on becomes off, off becomes on', fn: function (a) { return 1 - a; } }
  };

  // Difficulty. A circuit has `inputs` switches and `gates` gates; the last gate lights the bulb.
  var LEVELS = {
    mon: { name: 'Monday (easiest)', inputs: 3, gates: 3, types: ['AND', 'OR', 'NOT'] },
    tue: { name: 'Tuesday', inputs: 4, gates: 4, types: ['AND', 'OR', 'NOT'] },
    wed: { name: 'Wednesday', inputs: 4, gates: 5, types: ['AND', 'OR', 'NOT'] },
    thu: { name: 'Thursday', inputs: 5, gates: 5, types: ['AND', 'OR', 'NOT'] },
    fri: { name: 'Friday', inputs: 5, gates: 6, types: ['AND', 'OR', 'NOT', 'XOR'] },
    sat: { name: 'Saturday', inputs: 6, gates: 6, types: ['AND', 'OR', 'NOT', 'XOR'] },
    sun: { name: 'Sunday (hardest)', inputs: 6, gates: 7, types: ['AND', 'OR', 'NOT', 'XOR'] }
  };
  var WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var PRACTICE = { easy: 'tue', medium: 'thu', hard: 'sun' };

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function bitCount(n) { var c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }

  // Sources are numbered: 0..inputs-1 are the switches, then one per gate, in order.
  // evaluate(circuit, bits) -> values for every source; bits is an array of 0/1 (one per switch).
  function evaluate(c, bits) {
    var v = bits.slice(0, c.inputs).map(function (b) { return b ? 1 : 0; });
    c.gates.forEach(function (g) {
      var a = v[g.in[0]], b = g.in.length > 1 ? v[g.in[1]] : 0;
      v.push(GATES[g.type].fn(a, b));
    });
    return v;
  }
  function lights(c, bits) { var v = evaluate(c, bits); return v[v.length - 1] === 1; }
  function toBits(n, inputs) { var b = []; for (var i = 0; i < inputs; i++) b.push((n >> i) & 1); return b; }

  // Every switch combination, counted up in binary, with whether it lights the bulb.
  function search(c) {
    var total = 1 << c.inputs, lit = [], min = Infinity;
    for (var n = 0; n < total; n++) {
      if (lights(c, toBits(n, c.inputs))) { lit.push(n); min = Math.min(min, bitCount(n)); }
    }
    return { total: total, lit: lit, min: min };
  }

  // Which layer each gate sits in (1 = fed only by switches), for drawing.
  function layers(c) {
    var depth = [];
    for (var i = 0; i < c.inputs; i++) depth.push(0);
    c.gates.forEach(function (g) { depth.push(1 + Math.max.apply(null, g.in.map(function (s) { return depth[s]; }))); });
    return depth;
  }

  /* A circuit is accepted only if: every switch and every gate output is used; no gate takes the same wire twice
     and there is no NOT of a NOT; it is at least 2 gates deep; every switch matters; the bulb lights for some but at
     most 40% of combinations; it needs at least 2 switches; and (from 4 switches up) turning everything on fails. */
  function makeCircuit(seed, levelKey) {
    var L = LEVELS[levelKey], rand = mulberry32(seed >>> 0);
    function pick(a) { return a[Math.floor(rand() * a.length)]; }
    for (var attempt = 0; attempt < 20000; attempt++) {
      var c = { inputs: L.inputs, gates: [], level: levelKey }, used = [], ok = true;
      for (var g = 0; g < L.gates && ok; g++) {
        var avail = L.inputs + g, last = g === L.gates - 1;
        var type = rand() < 0.18 ? 'NOT' : pick(L.types.filter(function (t) { return t !== 'NOT'; }));
        var unused = [];
        for (var s = 0; s < avail; s++) if (!used[s]) unused.push(s);
        var ins = [], need = GATES[type].arity;
        while (ins.length < need) {
          var pool = unused.filter(function (s) { return ins.indexOf(s) < 0; });
          var src = pool.length && (last || rand() < 0.75) ? pick(pool) : Math.floor(rand() * avail);
          if (ins.indexOf(src) < 0) ins.push(src);
          if (ins.length < need && avail - ins.length <= 0) { ok = false; break; }
        }
        if (type === 'NOT' && ins[0] >= L.inputs && c.gates[ins[0] - L.inputs].type === 'NOT') ok = false;
        ins.forEach(function (s) { used[s] = true; });
        c.gates.push({ type: type, in: ins.sort(function (a, b) { return a - b; }) });
      }
      if (!ok) continue;
      var total = L.inputs + L.gates;
      for (var u = 0; u < total - 1; u++) if (!used[u]) { ok = false; break; }
      if (!ok) continue;
      var depth = layers(c);
      if (depth[depth.length - 1] < 2) continue;
      var r = search(c);
      if (!r.lit.length || r.lit.length > r.total * 0.4 || r.min < 2) continue;
      if (L.inputs >= 4 && r.lit.indexOf(r.total - 1) >= 0) continue;
      var matters = true;
      for (var k = 0; k < L.inputs && matters; k++) {
        var changes = false;
        for (var n = 0; n < r.total && !changes; n++) {
          if (lights(c, toBits(n, L.inputs)) !== lights(c, toBits(n ^ (1 << k), L.inputs))) changes = true;
        }
        matters = changes;
      }
      if (!matters) continue;
      c.min = r.min;
      c.seed = seed >>> 0;
      return c;
    }
    throw new Error('no circuit for seed ' + seed);
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
  function levelFor(key) {
    var p = key.split('-').map(Number);
    return WEEK[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }
  function dailyCircuit(key) {
    var c = makeCircuit(hashString('logic-lights:' + key), levelFor(key));
    c.dateKey = key;
    c.number = dayNumber(key);
    return c;
  }
  // A fully correct answer: lights the bulb with the fewest possible switches on.
  function isSolution(c, bits) {
    return Array.isArray(bits) && bits.length === c.inputs && lights(c, bits) &&
           bits.reduce(function (a, b) { return a + (b ? 1 : 0); }, 0) === c.min;
  }

  return {
    EPOCH: EPOCH, TIME_ZONE: TIME_ZONE, GATES: GATES, LEVELS: LEVELS, PRACTICE: PRACTICE,
    evaluate: evaluate, lights: lights, toBits: toBits, bitCount: bitCount, search: search, layers: layers,
    makeCircuit: makeCircuit, dateKey: dateKey, dayNumber: dayNumber, shiftDay: shiftDay, levelFor: levelFor, dailyCircuit: dailyCircuit,
    isSolution: isSolution, hashString: hashString
  };
}));
