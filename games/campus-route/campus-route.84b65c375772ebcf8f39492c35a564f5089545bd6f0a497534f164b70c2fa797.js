/* Campus Route page: draws the map, builds a route as the player taps buildings, checks it, keeps today's result and
   streak in this browser, and animates Dijkstra's method ("Watch a computer solve it"). Rules come from core.js. */
(function () {
  'use strict';
  var Core = window.CampusRouteCore;
  var root = document.getElementById('campusroute');
  if (!root || !Core) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var PENALTY_MS = 30000;
  var DAYS_KEY = 'campusroute.days';
  var STEP_MS = 1500;                 // animation: time per step

  function q(s) { return root.querySelector(s); }
  var ui = {
    map: q('[data-map]'), title: q('[data-title]'), from: q('[data-from]'), to: q('[data-to]'), clock: q('[data-clock]'),
    intro: q('[data-intro]'), introEyebrow: q('[data-intro-eyebrow]'), introFrom: q('[data-intro-from]'),
    introTo: q('[data-intro-to]'), start: q('[data-start]'),
    routeText: q('[data-route-text]'), routeTotal: q('[data-route-total]'), msg: q('[data-msg]'),
    actions: q('[data-actions]'), undo: q('[data-undo]'), clear: q('[data-clear]'), check: q('[data-check]'),
    result: q('[data-result]'), resultEyebrow: q('[data-result-eyebrow]'), resultBig: q('[data-result-big]'),
    resultDetail: q('[data-result-detail]'), resultExtra: q('[data-result-extra]'), watch: q('[data-watch]'),
    next: q('[data-next]'), explain: q('[data-explain]'), giveup: q('[data-giveup]'), reveal: q('[data-reveal]'),
    save: q('[data-save]'), nameInput: q('[data-name]'), saveBtn: q('[data-save-btn]'), saveMsg: q('[data-save-msg]'),
    saveNote: q('[data-save-note]'),
    modes: Array.prototype.slice.call(document.querySelectorAll('.cr-mode'))
  };
  var board = document.getElementById('campusroute-board');
  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var NAME_KEY = 'games.name', MINE_KEY = 'campusroute.mine';

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: not remembered */ }
  }

  // Leaderboard server call. The body goes as plain text, so the browser skips the extra CORS preflight request.
  function call(path, body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : 0;
    return fetch(api + path, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        clearTimeout(timer);
        if (!r.ok) { var err = new Error(d.error || 'The leaderboard could not be reached.'); err.data = d; throw err; }
        return d;
      });
    }, function () {
      clearTimeout(timer);
      throw new Error('The leaderboard could not be reached.');
    });
  }

  // 24 x 24 line icons, drawn with round strokes.
  var ICONS = {
    gate: 'M5 20V10a7 7 0 0 1 14 0v10M9 20v-6h6v6M3 20h18',
    info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5v.5',
    chapel: 'M12 2v4M10 4h4M6 21V11l6-5 6 5v10M10 21v-4a2 2 0 0 1 4 0v4',
    book: 'M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H3zM21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7z',
    tree: 'M12 3a6 6 0 0 0-6 6c0 3.3 2.7 6 6 6s6-2.7 6-6a6 6 0 0 0-6-6zM12 15v6M9 21h6',
    people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16.5 11a3 3 0 1 0 0-6M17.5 14.5a5.5 5.5 0 0 1 4 5.5',
    dining: 'M6 3v7a2 2 0 0 0 4 0V3M8 3v18M17 21V3c-2.2 1.2-3.5 3.8-3.5 7.5V13H17',
    flask: 'M9 3h6M10 3v6.5L4.6 18.4A1.8 1.8 0 0 0 6.1 21h11.8a1.8 1.8 0 0 0 1.5-2.6L14 9.5V3M7.2 15h9.6',
    music: 'M9 18V5l11-2v13M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11',
    house: 'M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
    waves: 'M2 9c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.6 5-.8M2 15c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.6 5-.8',
    columns: 'M3 20.5h18M5.5 20.5v-9M10 20.5v-9M14 20.5v-9M18.5 20.5v-9M2.5 9 12 3.5 21.5 9z'
  };
  var MAP = Core.MAP;   // size, lake water and tree clusters, in landscape map units

  /* ---------- state ---------- */

  function freshState(puzzle) {
    return { puzzle: puzzle, route: [puzzle.from], status: 'play', startedAt: 0, penalty: 0, tries: 0,
             finishedMs: 0, solved: false, showBest: false,
             // today's route only: the server's game id, why there is none, its official time, and the saved entry
             runId: null, runProblem: '', officialMs: null, saved: null, chain: null };
  }
  var states = { daily: null, practice: null };
  var mode = 'daily', cur = null, today = '';
  var clockTimer = 0, countdownTimer = 0, anim = null;
  var landscape = true;
  var els = { nodes: [], bodies: [], walks: [], pills: [], badges: [] };

  function name(i) { return Core.PLACES[i].name; }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmtTenths(ms) {                     // official times: 0:31.4
    var t = Math.max(0, Math.floor(ms / 100)), s = Math.floor(t / 10);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + '.' + (t % 10);
  }
  function say(text, kind) {
    ui.msg.textContent = text || '';
    ui.msg.className = 'cr-msg' + (kind ? ' is-' + kind : '');
  }
  function pop(el, cls) { el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); }

  /* ---------- this browser's daily record ---------- */

  function loadDays() {
    try { var d = JSON.parse(localStorage.getItem(DAYS_KEY)); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
  }
  function saveToday(rec) {
    var d = loadDays();
    d[today] = rec;
    var keys = Object.keys(d).sort();
    while (keys.length > 120) delete d[keys.shift()];
    try { localStorage.setItem(DAYS_KEY, JSON.stringify(d)); } catch (e) { /* private mode: not remembered */ }
  }
  function saveDailyProgress() {
    var s = states.daily;
    if (!s || s.status === 'intro') return;
    saveToday({ startedAt: s.startedAt, penalty: s.penalty, tries: s.tries, route: s.route,
                solved: s.status === 'done' && s.solved, revealed: s.status === 'done' && !s.solved,
                ms: s.status === 'done' && s.solved ? s.finishedMs : null,
                runId: s.runId, runProblem: s.runProblem, officialMs: s.officialMs, saved: s.saved });
  }
  function shiftDay(key, delta) {
    var p = key.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta)).toISOString().slice(0, 10);
  }
  function streak() {
    var d = loadDays(), key = today, n = 0;
    if (!(d[key] && d[key].solved)) key = shiftDay(key, -1);
    while (d[key] && d[key].solved) { n++; key = shiftDay(key, -1); }
    return n;
  }
  function msToMidnight() {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: Core.TIME_ZONE, hour: 'numeric', minute: 'numeric',
      second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    var get = function (t) { return Number(parts.filter(function (p) { return p.type === t; })[0].value); };
    return 86400000 - ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
  }

  /* ---------- drawing the map ---------- */

  // Narrow screens turn the map a quarter turn clockwise (north points right; the compass shows it),
  // so it fills a tall phone screen without mirroring the campus.
  function pos(x, y) { return landscape ? { x: x, y: y } : { x: MAP.height - y, y: x }; }
  function place(i) { var p = Core.PLACES[i]; return pos(p.x, p.y); }
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  var LABEL_FONT = 24;                                   // matches .cr-name in campus-route.css
  // A name's real width in map units, measured with the page's font (cleared once the web font has loaded).
  var widthCache = {};
  function textWidth(s) {
    if (widthCache[s]) return widthCache[s];
    var t = svg('text', { class: 'cr-name', x: -9999, y: -9999 }, ui.map), w = 0;
    t.textContent = s;
    try { w = t.getComputedTextLength(); } catch (e) { /* not rendered yet */ }
    ui.map.removeChild(t);
    if (!w) return s.length * LABEL_FONT * 0.6 + 6;
    return (widthCache[s] = w + 6);    // + room for the halo
  }
  function overlaps(a, b, pad) { return a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad; }

  // Where a name can go around its building: four sides, then four corners. dx/dy = the direction it sits in.
  var SIDES = [
    { side: 'below', dx: 0, dy: 1 }, { side: 'above', dx: 0, dy: -1 }, { side: 'right', dx: 1, dy: 0 }, { side: 'left', dx: -1, dy: 0 },
    { side: 'below-right', dx: 0.6, dy: 0.8 }, { side: 'below-left', dx: -0.6, dy: 0.8 },
    { side: 'above-right', dx: 0.6, dy: -0.8 }, { side: 'above-left', dx: -0.6, dy: -0.8 }
  ];
  function labelBox(s, c, w) {
    var h = LABEL_FONT * 1.25, gap = 38, x1, y1, anchor, tx;   // real text, with its halo, is ~1.25x the font size tall
    if (s.dx === 0) { x1 = c.x - w / 2; tx = c.x; anchor = 'middle'; }
    else if (s.dy === 0) { x1 = s.dx > 0 ? c.x + gap : c.x - gap - w; tx = s.dx > 0 ? x1 : x1 + w; anchor = s.dx > 0 ? 'start' : 'end'; }
    else { x1 = s.dx > 0 ? c.x + 18 : c.x - 18 - w; tx = s.dx > 0 ? x1 : x1 + w; anchor = s.dx > 0 ? 'start' : 'end'; }
    if (s.dy === 0) y1 = c.y - h / 2;
    else if (s.dx === 0) y1 = s.dy > 0 ? c.y + gap : c.y - gap - h;
    else y1 = s.dy > 0 ? c.y + 30 : c.y - 30 - h;
    return { x1: x1, x2: x1 + w, y1: y1, y2: y1 + h, tx: tx, ty: y1 + h * 0.75, anchor: anchor };
  }

  // Each name goes where it points away from its paths, stays inside the map, and avoids buildings, other names,
  // paths and the minutes numbers (pillBoxes, from the previous placement pass).
  function labelSpots(pts, W, H, compass, pillBoxes) {
    var nodes = pts.map(function (c) { return { x1: c.x - 34, x2: c.x + 34, y1: c.y - 34, y2: c.y + 34 }; });
    var placed = [];
    // Number of paths that run through a box (ignoring the stretch right next to building i).
    function roadsThrough(box, i) {
      var n = 0;
      Core.EDGES.forEach(function (e) {
        var a = pts[e[0]], b = pts[e[1]];
        for (var t = 0; t <= 1.0001; t += 0.04) {
          var x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
          if (Math.abs(x - pts[i].x) < 42 && Math.abs(y - pts[i].y) < 42) continue;
          if (x > box.x1 - 3 && x < box.x2 + 3 && y > box.y1 - 3 && y < box.y2 + 3) { n++; return; }
        }
      });
      return n;
    }
    return pts.map(function (c, i) {
      var w = textWidth(Core.PLACES[i].name), best = null;
      var dirs = Core.NEIGHBORS[i].map(function (n) {
        var o = pts[n.to], dx = o.x - c.x, dy = o.y - c.y, L = Math.sqrt(dx * dx + dy * dy);
        return [dx / L, dy / L];
      });
      SIDES.forEach(function (s, order) {
        var box = labelBox(s, c, w);
        var penalty = (box.x1 < 6 || box.x2 > W - 6 || box.y1 < 6 || box.y2 > H - 6) ? 10 : 0;
        if (overlaps(box, compass, 4)) penalty += 10;
        nodes.forEach(function (nb, j) { if (j !== i && overlaps(box, nb, 2)) penalty += 5; });
        placed.forEach(function (pb) { if (overlaps(box, pb, 10)) penalty += 5; });     // keep a visible gap between names
        (pillBoxes || []).forEach(function (pb) { if (overlaps(box, pb, 6)) penalty += 3; });
        penalty += 1.5 * roadsThrough(box, i);
        // How far the nearest path direction is from this side: 0 = along a path, 2 = straight away from all paths.
        var clear = Math.min.apply(null, dirs.map(function (d) { return 1 - (d[0] * s.dx + d[1] * s.dy); }));
        var score = clear - penalty - order * 0.1;
        if (!best || score > best.score) best = { side: s, score: score, box: box };
      });
      placed.push(best.box);
      return best;
    });
  }

  // Each minutes number slides along its path until it clears buildings, names and other numbers.
  function pillSpots(pts, labels, compass) {
    var nodes = pts.map(function (c) { return { x1: c.x - 34, x2: c.x + 34, y1: c.y - 34, y2: c.y + 34 }; });
    var placed = [];
    return Core.EDGES.map(function (e) {
      var a = pts[e[0]], b = pts[e[1]], best = null;
      [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74].forEach(function (t, order) {
        var x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        var box = { x1: x - 20, x2: x + 20, y1: y - 16, y2: y + 16 }, hits = 0;
        nodes.forEach(function (nb) { if (overlaps(box, nb, 0)) hits += 3; });
        labels.forEach(function (l) { if (overlaps(box, l.box, 6)) hits += 2; });
        placed.forEach(function (pb) { if (overlaps(box, pb, 4)) hits += 2; });
        if (overlaps(box, compass, 4)) hits += 2;
        var score = hits * 10 + order;
        if (!best || score < best.score) best = { score: score, x: x, y: y, box: box };
      });
      placed.push(best.box);
      return best;
    });
  }

  function drawMap() {
    var map = ui.map, W = landscape ? MAP.width : MAP.height, H = landscape ? MAP.height : MAP.width;
    map.textContent = '';
    map.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg('rect', { x: 0, y: 0, width: W, height: H, rx: 28, class: 'cr-lawn' }, map);
    var wt = MAP.water, w = pos(wt.x, wt.y);
    svg('ellipse', { cx: w.x, cy: w.y, rx: landscape ? wt.rx : wt.ry, ry: landscape ? wt.ry : wt.rx, class: 'cr-water' }, map);
    MAP.trees.forEach(function (t) { var c = pos(t[0], t[1]); svg('circle', { cx: c.x, cy: c.y, r: 15, class: 'cr-tree' }, map); });

    var pts = Core.PLACES.map(function (p, i) { return place(i); });
    var compass = { x1: 8, x2: 112, y1: 8, y2: 72 };                    // top-left corner
    // Names and numbers are placed in a few alternating passes, each avoiding where the other went.
    var labels = labelSpots(pts, W, H, compass, []), pills;
    for (var pass = 0; pass < 4; pass++) {
      pills = pillSpots(pts, labels, compass);
      labels = labelSpots(pts, W, H, compass, pills.map(function (p) { return p.box; }));
    }
    pills = pillSpots(pts, labels, compass);

    // Minutes go on top of the names, so a number is never hidden; taps pass through them to the buildings.
    var gRoads = svg('g', {}, map), gWalks = svg('g', {}, map), gNodes = svg('g', {}, map),
        gPills = svg('g', { class: 'cr-pills' }, map);
    Core.EDGES.forEach(function (e, k) {
      var a = pts[e[0]], b = pts[e[1]];
      var line = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      svg('line', Object.assign({ class: 'cr-road' }, line), gRoads);
      els.walks[k] = svg('line', Object.assign({ class: 'cr-walk' }, line), gWalks);
      var pill = svg('g', { class: 'cr-pill', transform: 'translate(' + pills[k].x + ' ' + pills[k].y + ')' }, gPills);
      svg('rect', { x: -20, y: -16, width: 40, height: 32, rx: 16 }, pill);
      els.pills[k] = { g: pill, text: svg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, pill) };
    });

    // Compass: the arrow points north (up in the wide layout, right in the phone layout).
    var cg = svg('g', { class: 'cr-compass', transform: 'translate(60 40)' }, map);
    svg('rect', { x: -44, y: -22, width: 88, height: 44, rx: 22 }, cg);
    var arrow = svg('g', { transform: 'translate(-16 0) rotate(' + (landscape ? 0 : 90) + ')' }, cg);
    svg('path', { d: 'M0 -13 L8 9 L0 4 L-8 9 Z' }, arrow);
    svg('text', { x: 14, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, cg).textContent = 'N';

    Core.PLACES.forEach(function (p, i) {
      var c = pts[i], lb = labels[i];
      var g = svg('g', { class: 'cr-node', transform: 'translate(' + c.x + ' ' + c.y + ')', role: 'button', tabindex: '-1' }, gNodes);
      var body = svg('g', { class: 'cr-body' }, g);
      svg('circle', { r: 52, class: 'cr-hit' }, body);
      svg('circle', { r: 43, class: 'cr-halo' }, body);
      svg('circle', { r: 31, class: 'cr-dot' }, body);
      var icon = svg('g', { class: 'cr-icon', transform: 'translate(-16.8 -16.8) scale(1.4)' }, body);
      svg('path', { d: ICONS[p.icon] }, icon);
      // Tapping the name works too: an invisible tap area covers it (taps between letters would otherwise miss).
      svg('rect', { x: lb.box.x1 - c.x, y: lb.box.y1 - c.y, width: lb.box.x2 - lb.box.x1, height: lb.box.y2 - lb.box.y1,
                    class: 'cr-hit' }, body);
      svg('text', { x: lb.box.tx - c.x, y: lb.box.ty - c.y, class: 'cr-name', 'text-anchor': lb.box.anchor }, body).textContent = p.name;
      // Dijkstra badge: on a corner away from the name.
      var corner = (lb.side.dx > 0.1 ? -31 : 31) + ' ' + (lb.side.dy < -0.1 ? 30 : -30);
      var badge = svg('g', { class: 'cr-badge', transform: 'translate(' + corner + ')' }, body);
      svg('rect', { x: -24, y: -16, width: 48, height: 32, rx: 16 }, badge);
      els.badges[i] = { g: badge, text: svg('text', { x: 0, y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, badge) };
      els.nodes[i] = g;
      els.bodies[i] = body;
      g.addEventListener('click', function () { tap(i); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(i); }
      });
    });
  }

  function render() {
    var s = cur, p = s.puzzle, route = s.route, end = route[route.length - 1];
    ui.from.textContent = name(p.from);
    ui.to.textContent = name(p.to);
    var onRoute = {}, onBest = {};
    for (var i = 1; i < route.length; i++) onRoute[Core.edgeBetween(route[i - 1], route[i])] = true;
    if (s.showBest) for (var j = 1; j < p.route.length; j++) onBest[Core.edgeBetween(p.route[j - 1], p.route[j])] = true;
    Core.EDGES.forEach(function (e, k) {
      els.pills[k].text.textContent = p.weights[k];
      els.walks[k].classList.toggle('is-route', !!onRoute[k]);
      els.walks[k].classList.toggle('is-best', !!onBest[k]);
      els.pills[k].g.classList.toggle('is-route', !!onRoute[k] || !!onBest[k]);
      els.pills[k].g.classList.toggle('is-best', !!onBest[k]);
    });
    var playing = s.status === 'play' && !anim;
    Core.PLACES.forEach(function (pl, i) {
      var n = els.nodes[i], inRoute = route.indexOf(i) >= 0;
      var edge = Core.edgeBetween(end, i);
      var canGo = playing && end !== p.to && !inRoute && edge >= 0;
      n.classList.toggle('is-start', i === p.from);
      n.classList.toggle('is-goal', i === p.to);
      n.classList.toggle('is-route', inRoute);
      n.classList.toggle('is-end', playing && i === end);
      n.classList.toggle('is-next', canGo);
      n.setAttribute('tabindex', playing && (canGo || (inRoute && route.length > 1)) ? '0' : '-1');
      n.setAttribute('aria-label', pl.name + (i === p.from ? ', start' : '') + (i === p.to ? ', goal' : '') +
        (canGo ? ', ' + p.weights[edge] + ' minutes from ' + name(end) : '') + (inRoute ? ', on your route' : ''));
    });
    ui.routeText.textContent = route.map(name).join(' → ');
    ui.routeTotal.textContent = Core.routeCost(p, route) + ' min';
    ui.check.disabled = !(playing && end === p.to);
    ui.undo.disabled = ui.clear.disabled = !(playing && route.length > 1);
    tickClock();
  }

  function applyStatus() {
    var s = cur;
    root.setAttribute('data-status', s.status);
    root.setAttribute('data-mode', mode);
    ui.intro.hidden = s.status !== 'intro';
    ui.actions.hidden = s.status === 'done';
    ui.giveup.hidden = s.status !== 'play';
    ui.result.hidden = s.status !== 'done';
    if (s.status === 'play') startClock(); else stopClock();
    if (s.status === 'done') showResult(); else clearInterval(countdownTimer);
  }

  /* ---------- clock ---------- */

  function elapsed() {
    var s = cur;
    if (s.status === 'done') return s.finishedMs;
    if (s.status !== 'play') return 0;
    return Date.now() - s.startedAt + s.penalty;
  }
  function tickClock() { ui.clock.textContent = fmt(elapsed()); }
  function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 250); }
  function stopClock() { clearInterval(clockTimer); }

  /* ---------- playing ---------- */

  function tap(i) {
    var s = cur, p = s.puzzle;
    if (s.status !== 'play' || anim) return;
    var route = s.route, end = route[route.length - 1], at = route.indexOf(i);
    if (at >= 0) {                                    // tapping your route goes back to that stop
      if (i === end) { if (route.length > 1) route.pop(); } else s.route = route.slice(0, at + 1);
      say('');
    } else if (end === p.to) {
      say('You’re at ' + name(p.to) + '. Check your route, or tap an earlier stop to change it.');
      pop(els.bodies[i], 'is-nudge');
      return;
    } else if (Core.edgeBetween(end, i) < 0) {
      say('There’s no path from ' + name(end) + ' to ' + name(i) + '. Pick a building connected to ' + name(end) + '.');
      pop(els.bodies[i], 'is-nudge');
      return;
    } else {
      route.push(i);
      say(i === p.to ? 'You reached ' + name(i) + ' in ' + Core.routeCost(p, route) + ' minutes. Check your route, or change it first.' : '');
    }
    if (mode === 'daily') saveDailyProgress();
    render();
    if (s.route[s.route.length - 1] === p.to) ui.check.focus({ preventScroll: true });
  }

  // Today's route: every check also goes to the server (in order), which keeps the official time.
  function report(s, route, fastest) {
    if (mode !== 'daily' || !api || !s.runId) return;
    s.chain = (s.chain || Promise.resolve()).then(function () {
      return call('/route/check', { runId: s.runId, route: route }, 8000);
    }).then(function (d) {
      if (d.fastest && d.ms != null) s.officialMs = d.ms;
      else if (fastest) s.runProblem = 'The server could not confirm this route.';
    }, function (e) {
      if (fastest) s.runProblem = e.message;
    }).then(function () {
      if (fastest) { saveDailyProgress(); if (cur === s && s.status === 'done') showSave(); }
    });
  }

  function check() {
    var s = cur, r = Core.checkRoute(s.puzzle, s.route);
    if (s.status !== 'play' || !r.complete) return;
    s.tries++;
    report(s, s.route.slice(), r.fastest);
    if (r.fastest) return finish(true);
    if (mode === 'daily') s.penalty += PENALTY_MS;
    say('That route takes ' + r.cost + ' minutes. There’s a faster one. Keep looking!' +
        (mode === 'daily' ? ' (+30 seconds)' : ''), 'warn');
    pop(ui.check, 'is-nudge');
    if (mode === 'daily') saveDailyProgress();
    tickClock();
  }

  function finish(solved) {
    var s = cur;
    s.finishedMs = Date.now() - s.startedAt + s.penalty;
    s.status = 'done';
    s.solved = solved;
    s.showBest = true;
    if (!solved) s.route = s.puzzle.route.slice();
    if (mode === 'daily') saveDailyProgress();
    say('');
    applyStatus();
    render();
    if (solved) ui.watch.focus({ preventScroll: true });
  }

  function showResult() {
    var s = cur, p = s.puzzle;
    ui.resultEyebrow.textContent = s.solved ? 'Fastest route!' : 'The fastest route';
    ui.resultBig.textContent = s.solved ? fmt(s.finishedMs) : p.best + ' min';
    ui.resultDetail.textContent = s.solved
      ? p.best + ' minutes of walking, found in ' + s.tries + (s.tries === 1 ? ' try' : ' tries') +
        (s.penalty ? ' (includes ' + s.penalty / 1000 + ' seconds for wrong guesses)' : '') + '.'
      : p.route.map(name).join(' → ') + '.';
    ui.next.textContent = mode === 'daily' ? 'Try a practice route' : 'New practice route';
    ui.watch.textContent = 'Watch a computer solve it';
    clearInterval(countdownTimer);
    if (mode === 'daily') {
      var update = function () {
        if (Core.dateKey() !== today) { clearInterval(countdownTimer); loadDaily(); return; }
        var left = msToMidnight(), h = Math.floor(left / 3600000), m = Math.ceil((left % 3600000) / 60000);
        if (m === 60) { h++; m = 0; }
        var n = streak();
        ui.resultExtra.textContent = (n ? 'Streak: ' + n + (n === 1 ? ' day' : ' days') + ' · ' : '') +
          'Next route in ' + (h ? h + ' h ' : '') + m + ' min';
      };
      update();
      countdownTimer = setInterval(update, 20000);
    } else {
      ui.resultExtra.textContent = '';
    }
    showSave();
  }

  /* ---------- saving today's time ---------- */

  function setNote(text, good) {
    ui.saveNote.textContent = text || '';
    ui.saveNote.hidden = !text;
    ui.saveNote.classList.toggle('is-good', !!good);
  }

  // The name form (or a note about it) under today's result.
  function showSave() {
    var s = cur, daily = mode === 'daily' && s.status === 'done' && s.solved && !!api;
    var canSave = daily && !!s.runId && s.officialMs != null && !s.saved;
    if (daily && s.officialMs != null) {
      ui.resultBig.textContent = fmtTenths(s.officialMs);
      ui.resultBig.title = 'Official time, measured by the leaderboard server';
    }
    ui.save.hidden = !canSave;
    if (canSave && !ui.nameInput.value) ui.nameInput.value = load(NAME_KEY, '') || load('bitflip.name', '') || '';
    if (!daily) setNote('');
    else if (s.saved) setNote('Saved as ' + s.saved.name + ' · #' + s.saved.rank + ' today', true);
    else if (!s.runId) setNote(s.runProblem ? 'This time can’t be saved. ' + s.runProblem : '');
    else if (s.officialMs == null) setNote(s.runProblem ? 'This time can’t be saved. ' + s.runProblem : 'Checking your time…');
    else setNote('');
  }

  var NAME_OK = /./;                       // very old browsers lack \p{...}; the server still checks
  try { NAME_OK = new RegExp("^[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} '_-]*$", 'u'); } catch (e) { /* keep fallback */ }
  function cleanName(raw) { return raw.normalize('NFKC').replace(/\s+/g, ' ').trim(); }
  function localNameProblem(n) {
    var len = Array.from(n).length;
    if (len < 2) return 'Use at least 2 characters.';
    if (len > 16) return 'Use at most 16 characters.';
    if (!NAME_OK.test(n)) return 'Use letters, numbers, spaces, - or _ only.';
    return '';
  }

  var checkTimer = 0, checkSeq = 0;
  ui.nameInput.addEventListener('input', function () {
    clearTimeout(checkTimer);
    var n = cleanName(ui.nameInput.value), seq = ++checkSeq;
    var local = n ? localNameProblem(n) : '';
    ui.saveMsg.textContent = local && (n.length > 1 || local.indexOf('letters') >= 0) ? local : '';
    if (!n || local) return;
    checkTimer = setTimeout(function () {
      call('/check-name', { name: n }, 5000).then(function (d) {
        if (seq === checkSeq) ui.saveMsg.textContent = d.ok ? '' : d.error;
      }, function () { /* saving reports any problem */ });
    }, 350);
  });

  ui.save.addEventListener('submit', function (e) {
    e.preventDefault();
    var s = states.daily, n = cleanName(ui.nameInput.value), local = localNameProblem(n);
    clearTimeout(checkTimer); checkSeq++;      // a late live check must not overwrite the server's answer
    if (local) { ui.saveMsg.textContent = local; ui.nameInput.focus(); return; }
    ui.saveBtn.disabled = true;
    ui.saveMsg.textContent = 'Saving…';
    call('/route/submit', { runId: s.runId, name: n }, 10000).then(function (d) {
      ui.saveBtn.disabled = false;
      ui.saveMsg.textContent = '';
      store(NAME_KEY, d.name);
      var mine = load(MINE_KEY, []);
      if (!Array.isArray(mine)) mine = [];
      mine.push(d.id);
      store(MINE_KEY, mine.slice(-100));
      s.saved = { name: d.name, rank: d.rankToday };
      saveDailyProgress();
      showSave();
      showBoards(d.boards, 'today', d.id);
    }, function (err) {
      ui.saveBtn.disabled = false;
      ui.saveMsg.textContent = err.message;
      if (err.data && err.data.field === 'name') { ui.nameInput.focus(); return; }
      if (err.data && err.data.error) { s.runProblem = err.message; s.runId = null; saveDailyProgress(); showSave(); }
    });
  });

  /* ---------- leaderboard ---------- */

  var boards = null, tab = 'today', flash = null;

  function showBoards(data, which, highlightId) {
    boards = data;
    if (which) tab = which;
    flash = highlightId || null;
    renderBoard();
  }

  function renderBoard() {
    if (!board) return;
    board.querySelectorAll('[data-board-tab]').forEach(function (b) {
      var on = b.getAttribute('data-board-tab') === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    var listEl = board.querySelector('[data-board-list]'), empty = board.querySelector('[data-board-empty]');
    var rows = (boards && boards[tab]) || [], mine = load(MINE_KEY, []);
    listEl.textContent = '';
    rows.forEach(function (r, i) {
      var li = document.createElement('li');
      li.className = 'cr-row';
      var me = tab !== 'days' && Array.isArray(mine) && mine.indexOf(r.id) >= 0;
      if (me) li.classList.add('is-me');
      if (r.id === flash && tab === 'today') li.classList.add('is-new');
      var rank = document.createElement('span'); rank.className = 'cr-rank'; rank.textContent = i + 1;
      var nm = document.createElement('span'); nm.className = 'cr-row-name'; nm.textContent = r.name;
      if (me) { var you = document.createElement('span'); you.className = 'cr-you'; you.textContent = 'you'; nm.appendChild(you); }
      var val = document.createElement('span'); val.className = 'cr-row-score';
      val.textContent = tab === 'days' ? r.days + (r.days === 1 ? ' day' : ' days') : fmtTenths(r.ms);
      li.appendChild(rank); li.appendChild(nm); li.appendChild(val);
      listEl.appendChild(li);
    });
    empty.hidden = rows.length > 0;
    empty.textContent = !boards ? 'The leaderboard could not be loaded right now.'
      : tab === 'today' ? 'No times yet today. Be the first!'
      : tab === 'yesterday' ? 'Nobody saved a time yesterday.' : 'No times yet. Be the first!';
  }

  if (board && api) {
    board.hidden = false;
    var tabs = Array.prototype.slice.call(board.querySelectorAll('[data-board-tab]'));
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-board-tab'); flash = null; renderBoard(); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(i + d + tabs.length) % tabs.length];
        next.click(); next.focus();
      });
    });
    call('/route/leaderboard', null, 8000).then(function (d) { showBoards(d.boards); }, function () { renderBoard(); });
  }

  /* ---------- puzzles ---------- */

  function loadDaily() {
    today = Core.dateKey();
    var p = Core.dailyPuzzle(today), s = freshState(p), rec = loadDays()[today];
    var savedRoute = rec && Core.routeCost(p, rec.route) !== null ? rec.route : null;
    if (rec && (rec.solved || rec.revealed)) {
      s.status = 'done'; s.solved = !!rec.solved; s.tries = rec.tries || 0; s.penalty = rec.penalty || 0;
      s.finishedMs = rec.ms || 0; s.route = rec.solved && savedRoute ? savedRoute : p.route.slice(); s.showBest = true;
    } else if (rec && rec.startedAt) {
      s.status = 'play'; s.startedAt = rec.startedAt; s.penalty = rec.penalty || 0; s.tries = rec.tries || 0;
      if (savedRoute) s.route = savedRoute;
    } else {
      s.status = 'intro';
    }
    if (rec) {
      s.runId = rec.runId || null; s.runProblem = rec.runProblem || ''; s.officialMs = rec.officialMs || null;
      s.saved = rec.saved || null;
    }
    states.daily = s;
    if (mode === 'daily') show('daily');
  }

  function newPractice() {
    var seed = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0]
                                                        : Math.floor(Math.random() * 4294967296);
    var s = freshState(Core.makePuzzle(seed));
    s.startedAt = Date.now();
    states.practice = s;
    if (mode === 'practice') show('practice');
  }

  function show(which) {
    stopAnimation();
    mode = which;
    cur = states[which];
    ui.modes.forEach(function (b) {
      var on = b.getAttribute('data-mode') === which;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    var p = cur.puzzle;
    if (which === 'daily') {
      var d = new Date(today + 'T12:00:00Z');
      ui.title.textContent = 'Route #' + p.number + ' · ' +
        d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    } else {
      ui.title.textContent = 'Practice route';
    }
    ui.introFrom.textContent = name(p.from);
    ui.introTo.textContent = name(p.to);
    say('');
    applyStatus();
    render();
  }

  /* ---------- watch a computer solve it (Dijkstra) ---------- */

  function list(updates) {
    return updates.map(function (u) { return name(u.place) + ' (' + u.dist + ' min)'; }).join(', ');
  }
  function clearMarks() {
    Core.PLACES.forEach(function (pl, i) {
      els.nodes[i].classList.remove('is-settled', 'is-current');
      els.badges[i].g.classList.remove('is-shown', 'is-final');
    });
    els.walks.forEach(function (w) { w.classList.remove('is-checked'); });
  }
  function setBadge(i, d, final) {
    els.badges[i].text.textContent = d;
    els.badges[i].g.classList.add('is-shown');
    els.badges[i].g.classList.toggle('is-final', !!final);
  }

  function watch() {
    if (anim) { finishAnimation(); return; }
    var s = cur, p = s.puzzle, run = Core.dijkstraSteps(p);
    anim = { run: run, k: 0, timers: [], saved: { route: s.route, showBest: s.showBest } };
    s.route = [p.from];
    s.showBest = false;
    clearMarks();
    root.classList.add('is-watching');
    ui.watch.textContent = 'Skip to the end';
    ui.explain.hidden = false;
    render();
    setBadge(p.from, 0, false);
    // On narrow screens, bring the map and the explanation under it into view (the menu bar is ~70px tall).
    if (window.innerWidth < 992) {
      var top = root.querySelector('.cr-mapwrap').getBoundingClientRect().top;
      if (top < 70 || top > window.innerHeight * 0.4) window.scrollTo({ top: window.pageYOffset + top - 80, behavior: 'smooth' });
    }
    step();
  }

  function step() {
    var p = cur.puzzle, k = anim.k, st = anim.run.steps[k];
    if (!st) return finishAnimation();
    els.walks.forEach(function (w) { w.classList.remove('is-checked'); });
    Core.PLACES.forEach(function (pl, i) { els.nodes[i].classList.remove('is-current'); });
    els.nodes[st.place].classList.add('is-current', 'is-settled');
    setBadge(st.place, st.dist, true);
    var goal = st.place === p.to;
    var text = 'Step ' + (k + 1) + '. ';
    if (k === 0) {
      text += 'Start at ' + name(p.from) + ': 0 minutes. Each neighbor gets a first time: ' + list(st.updates) + '.';
    } else if (goal) {
      text += 'The closest place not yet final is the goal, ' + name(p.to) + ', at ' + st.dist + ' minutes. ' +
              'Every other route would pass through a place that is already farther away, so nothing can be faster.';
    } else {
      text += 'The closest place not yet final is ' + name(st.place) + ', at ' + st.dist + ' minutes. Its time is now final. ' +
              (st.updates.length ? 'Going through it is faster for: ' + list(st.updates) + '.' : 'Going through it doesn’t make any neighbor faster.');
    }
    ui.explain.textContent = text;
    anim.timers.push(setTimeout(function () {
      st.updates.forEach(function (u) {
        setBadge(u.place, u.dist, false);
        var e = Core.edgeBetween(st.place, u.place);
        if (e >= 0) els.walks[e].classList.add('is-checked');
      });
    }, STEP_MS * 0.35));
    anim.k++;
    anim.timers.push(setTimeout(goal ? finishAnimation : step, goal ? STEP_MS * 1.2 : STEP_MS));
  }

  function finishAnimation() {
    if (!anim) return;
    var s = cur, p = s.puzzle, run = anim.run;
    anim.timers.forEach(clearTimeout);
    els.walks.forEach(function (w) { w.classList.remove('is-checked'); });
    Core.PLACES.forEach(function (pl, i) { els.nodes[i].classList.remove('is-current'); });
    run.steps.forEach(function (st) {               // show every step's outcome at once
      els.nodes[st.place].classList.add('is-settled');
      setBadge(st.place, st.dist, true);
      st.updates.forEach(function (u) { if (!els.badges[u.place].g.classList.contains('is-final')) setBadge(u.place, u.dist, false); });
    });
    s.route = anim.saved.route;
    s.showBest = true;
    anim = null;
    render();
    ui.explain.textContent = 'Done: ' + name(p.to) + ' is ' + run.dist + ' minutes away. Tracing back through the place ' +
      'that gave each stop its best time gives the fastest route, shown in green: ' + run.route.map(name).join(' → ') + '.';
    ui.watch.textContent = 'Watch again';
    root.classList.remove('is-watching');
  }

  function stopAnimation() {
    if (anim) { anim.timers.forEach(clearTimeout); cur.route = anim.saved.route; cur.showBest = anim.saved.showBest; anim = null; }
    clearMarks();
    root.classList.remove('is-watching');
    ui.explain.hidden = true;
  }

  /* ---------- wiring ---------- */

  ui.start.addEventListener('click', function () {
    var s = states.daily;
    if (s.status !== 'intro' || ui.start.disabled) return;
    function go() {
      ui.start.disabled = false;
      ui.start.textContent = 'Start';
      s.status = 'play';
      s.startedAt = Date.now();
      saveDailyProgress();
      applyStatus();
      render();
      say('Tap a building connected to ' + name(s.puzzle.from) + ' to start walking.');
    }
    if (!api) return go();
    // The server starts the official clock; if it can't be reached, play anyway (the time just can't be saved).
    ui.start.disabled = true;
    ui.start.textContent = 'Starting…';
    call('/route/start', {}, 3000).then(function (d) {
      s.runId = d.runId;
      if (d.dateKey && d.dateKey !== today) {          // the day just changed: play the server's puzzle
        today = d.dateKey;
        var p = Core.dailyPuzzle(today);
        s.puzzle = p; s.route = [p.from];
        show('daily');
      }
    }, function (e) {
      s.runProblem = e.message;
    }).then(go);
  });
  ui.undo.addEventListener('click', function () {
    if (cur.route.length > 1) { cur.route.pop(); if (mode === 'daily') saveDailyProgress(); say(''); render(); }
  });
  ui.clear.addEventListener('click', function () {
    cur.route = [cur.puzzle.from]; if (mode === 'daily') saveDailyProgress(); say(''); render();
  });
  ui.check.addEventListener('click', check);
  ui.watch.addEventListener('click', watch);
  ui.next.addEventListener('click', function () {
    if (mode === 'daily') {
      if (!states.practice || states.practice.status === 'done') newPractice();
      show('practice');
    } else {
      newPractice();
    }
  });
  ui.reveal.addEventListener('click', function () {
    if (mode === 'daily' && !window.confirm('Show the answer? Today’s route will end without a time.')) return;
    finish(false);
  });
  ui.modes.forEach(function (b, i) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-mode');
      if (which === 'practice' && !states.practice) newPractice();
      show(which);
    });
    b.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var other = ui.modes[(i + d + ui.modes.length) % ui.modes.length];
      other.click(); other.focus();
    });
  });

  // Portrait map on narrow screens, so buildings and labels stay large enough to tap and read.
  function fitMap(force) {
    var wide = root.clientWidth >= 600;
    if (!force && wide === landscape && ui.map.childNodes.length) return;
    if (anim) finishAnimation();
    landscape = wide;
    drawMap();
    clearMarks();
    if (cur) render();
  }
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(fitMap, 150); });
  // Names were measured with a fallback font until IBM Plex arrives; lay the map out again with the real widths.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { widthCache = {}; fitMap(true); });

  fitMap();
  loadDaily();
  if (mode === 'daily' && !cur) show('daily');
}());
