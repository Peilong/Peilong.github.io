/* Campus Route rules: the campus map, the daily puzzle, route checking, and the shortest-path method (Dijkstra).
   Pure functions with no page code: the leaderboard server (workers/games) loads this same file to check answers. */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.CampusRouteCore = core;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Elizabethtown College, simplified from the campus map: real buildings in roughly their real positions (north is
  // up, College Avenue along the bottom), spread out so they are easy to tap. x/y are map units in a 1000 x 680 layout.
  var MAP = {
    width: 1000, height: 680,
    water: { x: 190, y: 615, rx: 135, ry: 48 },     // Lake Placida
    trees: [[110, 250], [130, 275], [380, 70], [405, 88], [640, 55], [990, 260], [970, 285], [985, 600], [600, 650], [625, 640]]
  };
  var PLACES = [
    { id: 'young',      name: 'Young Center',   x: 85,  y: 405, icon: 'columns' },
    { id: 'lake',       name: 'Lake Placida',   x: 215, y: 575, icon: 'waves' },
    { id: 'chapel',     name: 'Leffler Chapel', x: 240, y: 395, icon: 'chapel' },
    { id: 'hackman',    name: 'Hackman Apts',   x: 240, y: 110, icon: 'house' },
    { id: 'gym',        name: 'Thompson Gym',   x: 400, y: 290, icon: 'dumbbell' },
    { id: 'founders',   name: 'Founders',       x: 520, y: 100, icon: 'house' },
    { id: 'esbenshade', name: 'Esbenshade',     x: 390, y: 560, icon: 'columns' },
    { id: 'masters',    name: 'Masters Center', x: 545, y: 450, icon: 'columns' },
    { id: 'baugher',    name: 'Baugher Center', x: 575, y: 280, icon: 'people' },
    { id: 'library',    name: 'High Library',   x: 720, y: 190, icon: 'book' },
    { id: 'hoover',     name: 'Hoover',         x: 690, y: 420, icon: 'columns' },
    { id: 'nicarry',    name: 'Nicarry',        x: 760, y: 575, icon: 'columns' },
    { id: 'alpha',      name: 'Alpha Hall',     x: 850, y: 320, icon: 'columns' },
    { id: 'myer',       name: 'Myer',           x: 900, y: 110, icon: 'house' },
    { id: 'dell',       name: 'The Dell',       x: 910, y: 470, icon: 'tree' }
  ];
  // Walkways between neighboring buildings (no two cross on the map).
  var PATHS = [
    ['young', 'chapel'], ['young', 'lake'], ['chapel', 'lake'], ['chapel', 'hackman'], ['chapel', 'gym'],
    ['hackman', 'gym'], ['hackman', 'founders'], ['founders', 'gym'], ['founders', 'baugher'], ['founders', 'library'],
    ['founders', 'myer'], ['gym', 'baugher'], ['gym', 'esbenshade'], ['gym', 'masters'], ['lake', 'esbenshade'],
    ['esbenshade', 'masters'], ['esbenshade', 'nicarry'], ['masters', 'baugher'], ['masters', 'hoover'],
    ['masters', 'nicarry'], ['baugher', 'library'], ['baugher', 'hoover'], ['library', 'alpha'], ['library', 'myer'],
    ['library', 'hoover'], ['hoover', 'alpha'], ['hoover', 'nicarry'], ['alpha', 'myer'], ['alpha', 'dell'],
    ['nicarry', 'dell'], ['hoover', 'dell']
  ];
  var MIN_MINUTES = 1, MAX_MINUTES = 9;
  var EPOCH = '2026-11-25';            // daily puzzle #1 (launch day)
  var TIME_ZONE = 'America/New_York';  // a new puzzle every midnight, Eastern time

  var INDEX = {};
  PLACES.forEach(function (p, i) { INDEX[p.id] = i; });
  var EDGES = PATHS.map(function (e) { return [INDEX[e[0]], INDEX[e[1]]]; });
  var N = PLACES.length;
  var NEIGHBORS = PLACES.map(function () { return []; });   // [{ to, edge }]
  EDGES.forEach(function (e, k) {
    NEIGHBORS[e[0]].push({ to: e[1], edge: k });
    NEIGHBORS[e[1]].push({ to: e[0], edge: k });
  });

  function edgeBetween(a, b) {
    var list = NEIGHBORS[a] || [];
    for (var i = 0; i < list.length; i++) if (list[i].to === b) return list[i].edge;
    return -1;
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(s) {                 // FNV-1a, 32-bit
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }

  // Fewest paths needed to get from a to every place (ignoring minutes).
  function hopsFrom(a) {
    var hops = PLACES.map(function () { return Infinity; }), queue = [a];
    hops[a] = 0;
    while (queue.length) {
      var u = queue.shift();
      NEIGHBORS[u].forEach(function (n) { if (hops[n.to] === Infinity) { hops[n.to] = hops[u] + 1; queue.push(n.to); } });
    }
    return hops;
  }

  // Every route from a to b that never visits a place twice, with its minutes and number of paths.
  function allRoutes(weights, a, b) {
    var out = [], seen = [], route = [a];
    seen[a] = true;
    (function walk(u, cost) {
      if (u === b) { out.push({ cost: cost, hops: route.length - 1, route: route.slice() }); return; }
      NEIGHBORS[u].forEach(function (n) {
        if (seen[n.to]) return;
        seen[n.to] = true; route.push(n.to);
        walk(n.to, cost + weights[n.edge]);
        seen[n.to] = false; route.pop();
      });
    })(a, 0);
    return out;
  }

  // Fastest route from a to b, optionally avoiding some places and one path. Returns { cost, route } or null.
  function fastest(weights, a, b, blockedPlaces, blockedEdge) {
    var dist = PLACES.map(function () { return Infinity; }), prev = PLACES.map(function () { return -1; }), done = [];
    dist[a] = 0;
    for (;;) {
      var u = -1;
      for (var i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b) break;
      done[u] = true;
      NEIGHBORS[u].forEach(function (n) {
        if (n.edge === blockedEdge || (blockedPlaces && blockedPlaces[n.to])) return;
        var d = dist[u] + weights[n.edge];
        if (d < dist[n.to]) { dist[n.to] = d; prev[n.to] = u; }
      });
    }
    if (dist[b] === Infinity) return null;
    var route = [], at = b;
    while (at >= 0) { route.unshift(at); at = prev[at]; }
    return { cost: dist[b], route: route };
  }

  // The cheapest route that differs from `best` (Yen's method for the 2nd-shortest route): for each stop on the best
  // route, leave it by a different path and take the fastest way on without revisiting earlier stops.
  function secondBest(weights, best) {
    var to = best.route[best.route.length - 1], rootCost = 0, min = Infinity;
    for (var i = 0; i < best.route.length - 1; i++) {
      var blocked = {};
      for (var j = 0; j < i; j++) blocked[best.route[j]] = true;
      var spur = fastest(weights, best.route[i], to, blocked, edgeBetween(best.route[i], best.route[i + 1]));
      if (spur && rootCost + spur.cost < min) min = rootCost + spur.cost;
      rootCost += weights[edgeBetween(best.route[i], best.route[i + 1])];
    }
    return min;
  }

  /* A puzzle: from, to, minutes on every path. Accepted only if
     - the fastest route is the only fastest route (no ties),
     - it is not the route with the fewest stops (so the obvious route is a trap),
     - the next-best route is within 2 minutes (so near misses exist),
     - and it uses at least 3 paths. */
  function makePuzzle(seed) {
    var rand = mulberry32(seed >>> 0);
    for (var attempt = 0; attempt < 5000; attempt++) {
      var from = Math.floor(rand() * N), to = Math.floor(rand() * N);
      var weights = EDGES.map(function () { return MIN_MINUTES + Math.floor(rand() * (MAX_MINUTES - MIN_MINUTES + 1)); });
      if (from === to) continue;
      var fewestHops = hopsFrom(from)[to];
      if (fewestHops < 2) continue;
      var best = fastest(weights, from, to);
      var hops = best.route.length - 1;
      if (hops < 3 || hops === fewestHops) continue;
      var second = secondBest(weights, best);
      if (second === best.cost || second - best.cost > 2) continue;
      return { seed: seed >>> 0, from: from, to: to, weights: weights, best: best.cost, route: best.route, second: second };
    }
    throw new Error('no puzzle for seed ' + seed);
  }

  // "YYYY-MM-DD" for a moment in time, in Eastern time.
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

  function dailyPuzzle(key) {
    var p = makePuzzle(hashString('campus-route:' + key));
    p.dateKey = key;
    p.number = dayNumber(key);
    return p;
  }

  // Minutes for a route given as place indexes, or null if it is not a walkable route from the start.
  function routeCost(puzzle, route) {
    if (!Array.isArray(route) || route.length < 1 || route[0] !== puzzle.from) return null;
    var seen = {}, cost = 0;
    seen[route[0]] = true;
    for (var i = 1; i < route.length; i++) {
      var e = edgeBetween(route[i - 1], route[i]);
      if (e < 0 || seen[route[i]]) return null;
      seen[route[i]] = true;
      cost += puzzle.weights[e];
    }
    return cost;
  }

  function checkRoute(puzzle, route) {
    var cost = routeCost(puzzle, route);
    var complete = cost !== null && route[route.length - 1] === puzzle.to;
    return { valid: cost !== null, complete: complete, cost: cost, fastest: complete && cost === puzzle.best };
  }

  // Dijkstra's method, step by step, for the "watch a computer solve it" animation.
  // Each step settles the closest unsettled place and lists the better times it found for its neighbors.
  function dijkstraSteps(puzzle) {
    var dist = PLACES.map(function () { return Infinity; }), prev = PLACES.map(function () { return -1; });
    var done = [], steps = [];
    dist[puzzle.from] = 0;
    for (;;) {
      var u = -1;
      for (var i = 0; i < N; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      var updates = [];
      NEIGHBORS[u].forEach(function (n) {
        var d = dist[u] + puzzle.weights[n.edge];
        if (!done[n.to] && d < dist[n.to]) { dist[n.to] = d; prev[n.to] = u; updates.push({ place: n.to, dist: d }); }
      });
      steps.push({ place: u, dist: dist[u], updates: updates });
      if (u === puzzle.to) break;
    }
    var route = [], at = puzzle.to;
    while (at >= 0) { route.unshift(at); at = prev[at]; }
    return { steps: steps, route: route, dist: dist[puzzle.to] };
  }

  return {
    MAP: MAP, PLACES: PLACES, EDGES: EDGES, NEIGHBORS: NEIGHBORS, TIME_ZONE: TIME_ZONE, EPOCH: EPOCH,
    fastest: fastest, secondBest: secondBest,
    edgeBetween: edgeBetween, hashString: hashString, makePuzzle: makePuzzle, dateKey: dateKey,
    dayNumber: dayNumber, dailyPuzzle: dailyPuzzle, routeCost: routeCost, checkRoute: checkRoute,
    dijkstraSteps: dijkstraSteps, allRoutes: allRoutes
  };
}));
