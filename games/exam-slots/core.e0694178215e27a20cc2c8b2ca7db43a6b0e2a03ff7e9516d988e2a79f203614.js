/* Exam Slots rules: the daily exam-conflict puzzle (easiest Monday, hardest Sunday), practice puzzles, clash checks,
   and the step-by-step search for "Watch a computer solve it". A puzzle is a graph: courses are dots, and a line joins
   two courses that share students, so their exams need different time slots (graph coloring).
   Pure functions, loaded by both the page and the leaderboard server (workers/games). */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.ExamSlotsCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPOCH = '2026-11-25';            // Exam Slots #1. The puzzle itself comes from the date.
  var TIME_ZONE = 'America/New_York';

  var SLOTS = ['Mon 9 AM', 'Mon 2 PM', 'Tue 9 AM', 'Tue 2 PM'];
  var COURSES = ['Algebra', 'Anatomy', 'Art', 'Biology', 'Calculus', 'Chemistry', 'Chinese', 'Comp Sci', 'Dance', 'Drama',
    'Ecology', 'Economics', 'English', 'Ethics', 'Film', 'Finance', 'French', 'Genetics', 'Geology', 'German', 'History',
    'Latin', 'Logic', 'Music', 'Nursing', 'Physics', 'Poetry', 'Politics', 'Sociology', 'Spanish', 'Writing'];

  /* Difficulty. Courses sit on a cols x rows grid (n of its cells used) and k slots are needed (always the fewest
     possible). keep = share of possible lines kept. rate = how often someone who places exams in a random order with
     a random allowed slot finishes without getting stuck (lower is harder); steady = the same for someone who always
     places the most boxed-in course next (only checked where set). */
  var LEVELS = {
    mon: { name: 'Monday', cols: 3, rows: 3, n: 7, k: 3, keep: 0.75, rate: [0.5, 1] },
    tue: { name: 'Tuesday', cols: 3, rows: 3, n: 8, k: 3, keep: 0.8, rate: [0.3, 0.6] },
    wed: { name: 'Wednesday', cols: 4, rows: 3, n: 10, k: 3, keep: 0.85, rate: [0.12, 0.3] },
    thu: { name: 'Thursday', cols: 5, rows: 3, n: 13, k: 4, keep: 1, rate: [0, 0.4] },
    fri: { name: 'Friday', cols: 4, rows: 3, n: 12, k: 3, keep: 0.85, rate: [0, 0.1] },
    sat: { name: 'Saturday', cols: 5, rows: 3, n: 14, k: 3, keep: 0.85, rate: [0, 0.06], steady: 0.95 },
    sun: { name: 'Sunday', cols: 5, rows: 3, n: 15, k: 3, keep: 0.85, rate: [0, 0.04], steady: 0.9 }
  };
  var WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var PRACTICE = { easy: 'tue', medium: 'fri', hard: 'sun' };
  var TRIALS = 300;

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
  function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- geometry (grid units) ---------- */

  function side(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  function crosses(p1, p2, p3, p4) {
    var d1 = side(p3, p4, p1), d2 = side(p3, p4, p2), d3 = side(p1, p2, p3), d4 = side(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function distToSegment(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    var x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return Math.sqrt(x * x + y * y);
  }

  /* ---------- the graph ---------- */

  function neighbors(n, edges) {
    var A = [];
    for (var i = 0; i < n; i++) A.push([]);
    edges.forEach(function (e) { A[e[0]].push(e[1]); A[e[1]].push(e[0]); });
    return A;
  }
  function connected(A) {
    var seen = [true], stack = [0], count = 1;
    while (stack.length) {
      A[stack.pop()].forEach(function (u) { if (!seen[u]) { seen[u] = true; count++; stack.push(u); } });
    }
    return count === A.length;
  }
  // Can the graph be scheduled in k slots? (Most-connected courses first.)
  function fits(A, k) {
    var n = A.length, slot = new Array(n).fill(-1);
    var order = A.map(function (_, i) { return i; }).sort(function (a, b) { return A[b].length - A[a].length || a - b; });
    function go(i) {
      if (i === n) return true;
      var v = order[i];
      for (var s = 0; s < k; s++) {
        if (A[v].every(function (u) { return slot[u] !== s; })) { slot[v] = s; if (go(i + 1)) return true; slot[v] = -1; }
      }
      return false;
    }
    return go(0);
  }
  function fewestSlots(A) { for (var k = 1; k < 8; k++) if (fits(A, k)) return k; return 8; }

  /* Share of TRIALS attempts that finish without getting stuck, placing one course at a time with a random allowed
     slot and never undoing. steady = always take the most boxed-in course next (most slots ruled out); otherwise a
     random course. */
  function finishRate(A, k, rand, steady) {
    var n = A.length, ok = 0;
    for (var t = 0; t < TRIALS; t++) {
      var slot = new Array(n).fill(-1), stuck = false;
      for (var step = 0; step < n && !stuck; step++) {
        var pick = [], most = -1;
        for (var v = 0; v < n; v++) {
          if (slot[v] >= 0) continue;
          var ruled = 0;
          if (steady) { var mask = 0; A[v].forEach(function (u) { if (slot[u] >= 0) mask |= 1 << slot[u]; }); while (mask) { ruled += mask & 1; mask >>= 1; } }
          if (ruled > most) { most = ruled; pick = [v]; } else if (ruled === most) pick.push(v);
        }
        var c = pick[Math.floor(rand() * pick.length)], free = [];
        for (var s = 0; s < k; s++) if (A[c].every(function (u) { return slot[u] !== s; })) free.push(s);
        if (!free.length) stuck = true; else slot[c] = free[Math.floor(rand() * free.length)];
      }
      if (!stuck) ok++;
    }
    return ok / TRIALS;
  }

  /* A puzzle: courses on a slightly jittered grid, joined by short lines that never cross and never pass close to
     another course; then some lines are removed (every course keeps at least 2). Accepted only if it is connected,
     needs exactly the level's k slots, and its difficulty (finishRate) is in the level's range. */
  function makePuzzle(seed, levelKey) {
    var L = LEVELS[levelKey], rand = mulberry32(seed >>> 0);
    for (var attempt = 0; attempt < 3000; attempt++) {
      var cells = [];
      for (var r = 0; r < L.rows; r++) for (var c = 0; c < L.cols; c++) cells.push({ c: c, r: r });
      while (cells.length > L.n) cells.splice(Math.floor(rand() * cells.length), 1);
      var P = cells.map(function (q) {
        return { x: Math.round((q.c + (rand() - 0.5) * 0.24) * 1000) / 1000, y: Math.round((q.r + (rand() - 0.5) * 0.24) * 1000) / 1000 };
      });
      var n = P.length, cand = [];
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d = Math.sqrt(dx * dx + dy * dy);
          if (d > 2.3) continue;
          var clear = true;
          for (var m = 0; m < n && clear; m++) if (m !== i && m !== j && distToSegment(P[m], P[i], P[j]) < 0.42) clear = false;
          if (clear) cand.push({ i: i, j: j, d: d + rand() * 0.15 });
        }
      }
      cand.sort(function (a, b) { return a.d - b.d || a.i - b.i || a.j - b.j; });
      var E = [];
      cand.forEach(function (e) {
        for (var q = 0; q < E.length; q++) {
          var f = E[q];
          if (f[0] === e.i || f[0] === e.j || f[1] === e.i || f[1] === e.j) continue;
          if (crosses(P[e.i], P[e.j], P[f[0]], P[f[1]])) return;
        }
        E.push([e.i, e.j]);
      });
      var target = Math.round(E.length * L.keep), keep = E.slice();
      var order = shuffle(E.map(function (_, i) { return i; }), rand);
      for (var o = 0; o < order.length && keep.length > target; o++) {
        var e = E[order[o]], trial = keep.filter(function (f) { return f !== e; }), A0 = neighbors(n, trial);
        if (A0[e[0]].length >= 2 && A0[e[1]].length >= 2) keep = trial;
      }
      var A = neighbors(n, keep);
      if (!connected(A) || fewestSlots(A) !== L.k) continue;
      var rate = finishRate(A, L.k, rand, false);
      if (rate < L.rate[0] || rate > L.rate[1]) continue;
      if (L.steady && finishRate(A, L.k, rand, true) > L.steady) continue;
      var names = shuffle(COURSES.slice(), rand).slice(0, n);
      return {
        level: levelKey, seed: seed >>> 0, k: L.k, n: n, cols: L.cols, rows: L.rows,
        nodes: P.map(function (p, i) { return { name: names[i], x: p.x, y: p.y }; }),
        edges: keep.map(function (e) { return e.slice().sort(function (a, b) { return a - b; }); })
      };
    }
    throw new Error('no puzzle for seed ' + seed);
  }

  /* ---------- playing ---------- */

  // Lines whose two courses are in the same slot (indexes into p.edges). slots[i] is 0..k-1, or null if unplaced.
  function clashes(p, slots) {
    var out = [];
    p.edges.forEach(function (e, i) {
      var a = slots[e[0]], b = slots[e[1]];
      if (a !== null && a !== undefined && a === b) out.push(i);
    });
    return out;
  }
  function placed(p, slots) {
    var c = 0;
    for (var i = 0; i < p.n; i++) if (Number.isInteger(slots[i]) && slots[i] >= 0 && slots[i] < p.k) c++;
    return c;
  }
  // A full answer: every course in one of the k slots, and no line joins two courses in the same slot.
  function isSolution(p, slots) {
    return Array.isArray(slots) && slots.length === p.n && placed(p, slots) === p.n && clashes(p, slots).length === 0;
  }

  /* How a computer solves it: place courses in order, trying slot 1, 2, ... and backing up at a dead end
     (backtracking), column by column. Returns every step for the animation: { v, s } places course v in slot s,
     { v, dead: true } means every slot clashes for course v, { v, s: null } takes v out again to try its next slot.
     Gives up after `limit` steps. */
  function search(p, limit) {
    var A = neighbors(p.n, p.edges), slot = new Array(p.n).fill(null), steps = [], backs = 0, max = limit || 100000;
    var order = p.nodes.map(function (_, i) { return i; }).sort(function (a, b) {
      return Math.round(p.nodes[a].x) - Math.round(p.nodes[b].x) || p.nodes[a].y - p.nodes[b].y;
    });
    function go(i) {
      if (i === p.n) return true;
      var v = order[i], tried = false;
      for (var s = 0; s < p.k; s++) {
        if (steps.length >= max) return false;
        if (A[v].every(function (u) { return slot[u] !== s; })) {
          tried = true;
          slot[v] = s; steps.push({ v: v, s: s });
          if (go(i + 1)) return true;
          slot[v] = null; steps.push({ v: v, s: null }); backs++;
        }
      }
      if (!tried) steps.push({ v: v, dead: true });
      return false;
    }
    var solved = go(0);
    return { steps: steps, backs: backs, solved: solved, slots: slot.slice(), everything: Math.pow(p.k, p.n) };
  }

  /* ---------- days ---------- */

  function dateKey(now) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now === undefined ? Date.now() : now));
    var get = function (t) { return parts.filter(function (x) { return x.type === t; })[0].value; };
    return get('year') + '-' + get('month') + '-' + get('day');
  }
  function dayNumber(key) {
    var toDays = function (k) { var x = k.split('-').map(Number); return Date.UTC(x[0], x[1] - 1, x[2]) / 86400000; };
    return toDays(key) - toDays(EPOCH) + 1;
  }
  function shiftDay(key, delta) {
    var x = key.split('-').map(Number);
    return new Date(Date.UTC(x[0], x[1] - 1, x[2] + delta)).toISOString().slice(0, 10);
  }
  function levelFor(key) {
    var x = key.split('-').map(Number);
    return WEEK[new Date(Date.UTC(x[0], x[1] - 1, x[2])).getUTCDay()];
  }
  function dailyPuzzle(key) {
    var p = makePuzzle(hashString('exam-slots:' + key), levelFor(key));
    p.dateKey = key;
    p.number = dayNumber(key);
    return p;
  }

  return {
    EPOCH: EPOCH, TIME_ZONE: TIME_ZONE, SLOTS: SLOTS, COURSES: COURSES, LEVELS: LEVELS, PRACTICE: PRACTICE,
    makePuzzle: makePuzzle, neighbors: neighbors, fewestSlots: fewestSlots, clashes: clashes, placed: placed,
    isSolution: isSolution, search: search, dateKey: dateKey, dayNumber: dayNumber, shiftDay: shiftDay,
    levelFor: levelFor, dailyPuzzle: dailyPuzzle, hashString: hashString
  };
}));
