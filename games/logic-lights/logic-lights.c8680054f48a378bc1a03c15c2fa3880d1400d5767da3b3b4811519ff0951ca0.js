/* Logic Lights page: draws the circuit (left to right on wide screens, top to bottom on phones), flips switches, shows
   where the signal flows, checks the daily answer with the server, practice circuits, and "Watch a computer solve
   it" (trying every combination, counting up in binary). Rules: core.js. Shared parts: ../shared.js. */
(function () {
  'use strict';
  var L = window.LogicLightsCore, G = window.GamesShared;
  var root = document.getElementById('logiclights');
  if (!root || !L || !G) return;

  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var NAMES = 'ABCDEF';
  var record = G.days('logiclights.days');
  function q(s) { return root.querySelector(s); }
  var ui = {
    title: q('[data-title]'), meta: q('[data-meta]'), clock: q('[data-clock]'), svg: q('[data-svg]'), intro: q('[data-intro]'),
    start: q('[data-start]'), msg: q('[data-msg]'), legend: q('[data-legend]'), explain: q('[data-explain]'),
    result: q('[data-result]'), resultBig: q('[data-result-big]'), resultDetail: q('[data-result-detail]'),
    resultExtra: q('[data-result-extra]'), watch: q('[data-watch]'), next: q('[data-next]'), levels: q('[data-levels]'),
    newBtn: q('[data-new]'), modes: Array.prototype.slice.call(document.querySelectorAll('.logic-page > .g-modes .g-mode')),
    levelBtns: Array.prototype.slice.call(root.querySelectorAll('[data-level]'))
  };

  var mode = 'daily', today = L.dateKey(), states = { daily: null, practice: null }, cur = null;
  var landscape = true, els = null, clockTimer = 0, countdownTimer = 0, anim = null, practiceLevel = 'medium';

  function fresh(c) {
    return { circuit: c, bits: c.gates ? new Array(c.inputs).fill(0) : [], status: 'play', startedAt: Date.now(),
             finishedAt: 0, solved: false, ms: null };
  }
  function say(t, kind) { ui.msg.textContent = t || ''; ui.msg.className = 'g-msg' + (kind ? ' is-' + kind : ''); }
  function onCount(bits) { return bits.reduce(function (a, b) { return a + b; }, 0); }
  function names(bits) { return bits.map(function (b, i) { return b ? NAMES[i] : ''; }).filter(Boolean).join(', ') || 'none'; }

  /* ---------- drawing ---------- */

  var U0 = 80, DU = 170, ROW = 96, GL = 74;                      // flow (along the signal) and cross spacing
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // Flow coordinates (u along the signal, v across) to the screen: left-to-right, or top-to-bottom on phones.
  function at(u, v) { return landscape ? { x: u, y: v } : { x: v, y: u }; }
  function off(p, du, dv) { return landscape ? { x: p.x + du, y: p.y + dv } : { x: p.x + dv, y: p.y + du }; }

  function layout(c) {
    var depth = L.layers(c), maxD = Math.max.apply(null, depth), byLayer = [], V = {};
    for (var d = 0; d <= maxD; d++) byLayer.push([]);
    depth.forEach(function (d, s) { byLayer[d].push(s); });
    var rows = Math.max.apply(null, byLayer.map(function (l) { return l.length; }));
    var cross = rows * ROW;
    byLayer.forEach(function (list, d) {
      if (d > 0) list.sort(function (a, b) { return avgIn(a) - avgIn(b); });  // place gates near their inputs
      var top = 20 + (cross - list.length * ROW) / 2;
      list.forEach(function (s, i) { V[s] = top + ROW / 2 + i * ROW; });
    });
    function avgIn(s) { var g = c.gates[s - c.inputs]; return g.in.reduce(function (a, k) { return a + V[k]; }, 0) / g.in.length; }
    var last = depth.length - 1;
    return { depth: depth, V: V, U: function (s) { return U0 + depth[s] * DU; }, bulbU: U0 + (maxD + 1) * DU - 30,
             bulbV: V[last], flow: U0 + (maxD + 1) * DU + 20, cross: cross + 40 };
  }

  var SHAPES = {
    AND: 'M-37 -29H8A29 29 0 0 1 8 29H-37Z',
    OR: 'M-37 -29Q-22 0 -37 29Q10 29 37 0Q10 -29 -37 -29Z',
    XOR: 'M-31 -29Q-16 0 -31 29Q14 29 37 0Q14 -29 -31 -29ZM-41 -29Q-26 0 -41 29',
    NOT: 'M-37 -26L25 0L-37 26Z'
  };
  var OUT_U = 37;                                             // gate output, along the flow, from its center

  function draw() {
    var s = cur, c = s && s.circuit;
    ui.svg.textContent = '';
    els = null;
    if (!c || !c.gates) return;
    var lay = layout(c), W = landscape ? lay.flow : lay.cross, H = landscape ? lay.cross : lay.flow;
    ui.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg('rect', { x: 0, y: 0, width: W, height: H, rx: 24, class: 'll-board' }, ui.svg);
    var gWires = svg('g', {}, ui.svg), gParts = svg('g', {}, ui.svg);
    els = { wires: [], gates: [], switches: [], bulb: null };
    function outPoint(src) {
      var p = at(lay.U(src), lay.V[src]);
      return off(p, src < c.inputs ? 34 : OUT_U, 0);
    }
    function wire(from, to, src) {
      var mid = landscape ? (to.x - from.x) / 2 : (to.y - from.y) / 2;
      var d = landscape
        ? 'M' + from.x + ' ' + from.y + 'C' + (from.x + mid) + ' ' + from.y + ' ' + (to.x - mid) + ' ' + to.y + ' ' + to.x + ' ' + to.y
        : 'M' + from.x + ' ' + from.y + 'C' + from.x + ' ' + (from.y + mid) + ' ' + to.x + ' ' + (to.y - mid) + ' ' + to.x + ' ' + to.y;
      els.wires.push({ el: svg('path', { d: d, class: 'll-wire' }, gWires), src: src });
    }
    c.gates.forEach(function (g, i) {
      var s = c.inputs + i, center = at(lay.U(s), lay.V[s]);
      g.in.forEach(function (src, k) {
        var dv = g.in.length === 1 ? 0 : (k === 0 ? -14 : 14);
        wire(outPoint(src), off(center, g.type === 'XOR' ? -37 : -33, dv), src);
      });
      var grp = svg('g', { class: 'll-gate', transform: 'translate(' + center.x + ' ' + center.y + ')' + (landscape ? '' : ' matrix(0 1 1 0 0 0)') }, gParts);
      svg('path', { d: SHAPES[g.type] }, grp);
      if (g.type === 'NOT') svg('circle', { cx: 31, cy: 0, r: 6 }, grp);
      var label = svg('text', { x: center.x, y: center.y, class: 'll-gate-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, gParts);
      label.textContent = g.type;
      var lp = off(center, g.type === 'NOT' ? -12 : -4, 0);
      label.setAttribute('x', lp.x); label.setAttribute('y', lp.y);
      els.gates.push({ el: grp, label: label, src: s });
    });
    var last = c.inputs + c.gates.length - 1, bulbC = at(lay.bulbU, lay.bulbV);
    wire(outPoint(last), off(bulbC, -30, 0), last);
    var b = svg('g', { class: 'll-bulbg' }, gParts);
    svg('circle', { cx: bulbC.x, cy: bulbC.y, r: 48, class: 'll-halo' }, b);
    svg('circle', { cx: bulbC.x, cy: bulbC.y, r: 28, class: 'll-bulb' }, b);
    svg('path', { d: 'M' + (bulbC.x - 9) + ' ' + (bulbC.y + 6) + 'l4 -12l5 9l5 -9l4 12', class: 'll-filament' }, b);
    els.bulb = b;
    for (var i = 0; i < c.inputs; i++) {
      (function (i) {
        var p = at(U0, lay.V[i]);
        var grp = svg('g', { class: 'll-switch', role: 'switch', tabindex: '0', 'aria-checked': 'false',
                             'aria-label': 'Switch ' + NAMES[i], transform: 'translate(' + p.x + ' ' + p.y + ')' }, gParts);
        var inner = svg('g', landscape ? {} : { transform: 'matrix(0 1 1 0 0 0)' }, grp);
        svg('rect', { x: -46, y: -36, width: 92, height: 72, rx: 20, class: 'll-hit' }, inner);
        svg('rect', { x: -30, y: -17, width: 60, height: 34, rx: 17, class: 'll-track' }, inner);
        var knob = svg('circle', { cx: -13, cy: 0, r: 12, class: 'll-knob' }, inner);
        var lp = landscape ? { x: -46, y: 7, a: 'end' } : { x: 0, y: -40, a: 'middle' };
        svg('text', { x: lp.x, y: lp.y, class: 'll-letter', 'text-anchor': lp.a }, grp).textContent = NAMES[i];
        grp.addEventListener('click', function () { flip(i); });
        grp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(i); } });
        els.switches.push({ el: grp, knob: knob });
      })(i);
    }
    update();
  }

  function update(bitsOverride) {
    var s = cur;
    if (!els || !s) return;
    var bits = bitsOverride || s.bits, v = L.evaluate(s.circuit, bits), lit = v[v.length - 1] === 1;
    els.wires.forEach(function (w) { w.el.classList.toggle('is-on', v[w.src] === 1); });
    els.gates.forEach(function (g) { g.el.classList.toggle('is-on', v[g.src] === 1); g.label.classList.toggle('is-on', v[g.src] === 1); });
    els.switches.forEach(function (sw, i) {
      sw.el.classList.toggle('is-on', !!bits[i]);
      sw.el.setAttribute('aria-checked', bits[i] ? 'true' : 'false');
      sw.knob.setAttribute('cx', bits[i] ? 13 : -13);
      sw.el.setAttribute('tabindex', s.status === 'play' && !anim ? '0' : '-1');
    });
    els.bulb.classList.toggle('is-lit', lit);
    return lit;
  }

  function renderLegend() {
    var s = cur, types = {};
    ui.legend.textContent = '';
    if (!s || !s.circuit.gates) return;
    s.circuit.gates.forEach(function (g) { types[g.type] = true; });
    ['AND', 'OR', 'NOT', 'XOR'].forEach(function (t) {
      if (!types[t]) return;
      var item = document.createElement('span');
      item.className = 'll-legend-item';
      item.innerHTML = '<b class="g-mono"></b> <span></span>';
      item.querySelector('b').textContent = t;
      item.querySelector('span').textContent = L.GATES[t].rule;
      ui.legend.appendChild(item);
    });
  }

  function renderTop() {
    var s = cur, c = s && s.circuit;
    if (mode === 'daily') ui.title.textContent = 'Logic Lights #' + states.daily.circuit.number + ' · ' + G.shortDate(states.daily.circuit.dateKey);
    else ui.title.textContent = 'Practice circuit · ' + practiceLevel[0].toUpperCase() + practiceLevel.slice(1);
    ui.meta.textContent = c ? L.LEVELS[c.level].name.replace(/ \(.*\)/, '') + ' · ' + c.inputs + ' switches · fewest: ' + c.min : '';
    if (mode === 'practice') ui.meta.textContent = c.inputs + ' switches · fewest: ' + c.min;
    tick();
  }

  function applyStatus() {
    var s = cur;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-status', s.status);
    ui.intro.hidden = s.status !== 'intro';
    ui.levels.hidden = mode !== 'practice';
    ui.result.hidden = s.status !== 'done';
    ui.legend.hidden = s.status === 'intro';
    if (s.status === 'play') startClock(); else { stopClock(); tick(); }
    if (s.status === 'done') showResult(); else clearInterval(countdownTimer);
  }

  /* ---------- clock ---------- */

  function elapsed() {
    var s = cur;
    if (!s || s.status === 'intro') return 0;
    if (s.status === 'done') return s.ms != null ? s.ms : s.finishedAt - s.startedAt;
    return Date.now() - s.startedAt;
  }
  function tick() { ui.clock.textContent = G.fmt(elapsed()); }
  function startClock() { stopClock(); tick(); clockTimer = setInterval(tick, 250); }
  function stopClock() { clearInterval(clockTimer); }

  /* ---------- playing ---------- */

  var checking = false;
  function flip(i) {
    var s = cur;
    if (!s || s.status !== 'play' || anim || checking) return;
    s.bits[i] = s.bits[i] ? 0 : 1;
    var lit = update(), n = onCount(s.bits), c = s.circuit;
    if (mode === 'daily') save();
    if (!lit) { say(n ? 'Switches on: ' + names(s.bits) + '. The bulb is off.' : ''); return; }
    if (n > c.min) { say('Lit with ' + n + ' switches! The fewest that can do it is ' + c.min + '. Try turning some off.', 'warn'); return; }
    if (mode === 'practice') return finish(null);
    checking = true;
    say('Lit! Checking…', 'good');
    G.call(api, '/logic/check', { runId: s.runId, switches: s.bits }, 8000).then(function (d) {
      if (d.solved) finish(d.ms);
      else say('The server didn’t accept that answer. Try again.', 'warn');
    }, function (e) {
      say(e.message, 'warn');
      if (e.data && e.data.error) { s.problem = e.message; finish(null); }
    }).then(function () { checking = false; });
  }

  function finish(ms) {
    var s = cur;
    s.status = 'done';
    s.solved = true;
    s.finishedAt = Date.now();
    if (ms != null) s.ms = ms;
    if (mode === 'daily') save();
    say('');
    applyStatus();
    update();
  }

  function showResult() {
    var s = cur, c = s.circuit, daily = mode === 'daily';
    ui.resultBig.textContent = daily && s.ms != null ? G.fmtTenths(s.ms) : G.fmt(elapsed());
    ui.resultDetail.textContent = c.min + ' switches: ' + names(s.bits) + '.';
    ui.next.textContent = daily ? 'Try a practice circuit' : 'New practice circuit';
    ui.watch.textContent = 'Watch a computer solve it';
    clearInterval(countdownTimer);
    if (daily) {
      var upd = function () {
        if (L.dateKey() !== today) { clearInterval(countdownTimer); loadDaily(); return; }
        var k = record.streak(today);
        ui.resultExtra.textContent = (k ? 'Streak: ' + k + (k === 1 ? ' day' : ' days') + ' · ' : '') +
          'Next circuit in ' + G.untilMidnight(L.TIME_ZONE);
      };
      upd();
      countdownTimer = setInterval(upd, 20000);
    } else {
      ui.resultExtra.textContent = 'Practice · ' + practiceLevel;
    }
    showSave();
  }

  /* ---------- today's circuit / practice ---------- */

  function save() {
    var s = states.daily;
    if (!s || !s.runId) return;
    record.put(s.circuit.dateKey, { runId: s.runId, status: s.status, bits: s.bits, startedAt: s.startedAt,
      finishedAt: s.finishedAt, solved: s.solved, ms: s.ms, saved: s.saved || null, problem: s.problem || '' });
  }

  function loadDaily() {
    today = L.dateKey();
    var c = L.dailyCircuit(today), s = fresh(c), rec = record.get(today);
    s.status = 'intro';
    if (rec && rec.runId) {
      s.runId = rec.runId; s.status = rec.status === 'done' ? 'done' : 'play'; s.bits = rec.bits || s.bits;
      s.startedAt = rec.startedAt || Date.now(); s.finishedAt = rec.finishedAt || 0; s.solved = !!rec.solved;
      s.ms = rec.ms != null ? rec.ms : null; s.saved = rec.saved || null; s.problem = rec.problem || '';
    }
    states.daily = s;
    if (mode === 'daily') show('daily');
  }

  function newPractice() {
    var seed = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    states.practice = fresh(L.makeCircuit(seed, L.PRACTICE[practiceLevel]));
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
    ui.levelBtns.forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-level') === practiceLevel ? 'true' : 'false'); });
    say('');
    fit(true);
    renderLegend();
    renderTop();
    applyStatus();
  }

  /* ---------- watch a computer solve it ---------- */

  function watch() {
    if (anim) { finishAnimation(); return; }
    var s = cur, c = s.circuit, total = 1 << c.inputs, found = [], best = Infinity;
    anim = { n: 0, timer: 0, total: total, found: found };
    ui.watch.textContent = 'Skip to the end';
    ui.explain.hidden = false;
    var stepMs = Math.max(60, Math.min(450, Math.round(5000 / total)));
    (function step() {
      if (!anim) return;
      if (anim.n >= total) return finishAnimation();
      var bits = L.toBits(anim.n, c.inputs), lit = update(bits), n = onCount(bits);
      if (lit) { found.push(anim.n); best = Math.min(best, n); }
      var binary = bits.slice().reverse().join('');
      ui.explain.textContent = 'Trying combination ' + (anim.n + 1) + ' of ' + total + ': ' +
        NAMES.slice(0, c.inputs).split('').reverse().join('') + ' = ' + binary + '. ' +
        (lit ? 'The bulb lights with ' + n + (n === 1 ? ' switch' : ' switches') + '.' : 'The bulb stays off.') +
        (best < Infinity ? ' Fewest so far: ' + best + '.' : '');
      anim.n++;
      anim.timer = setTimeout(step, lit ? stepMs * 3 : stepMs);
    })();
  }
  function finishAnimation() {
    if (!anim) return;
    var s = cur, c = s.circuit, r = L.search(c), litCount = r.lit.length;
    clearTimeout(anim.timer);
    anim = null;
    update();
    ui.watch.textContent = 'Watch again';
    ui.explain.textContent = 'Done: the computer tried all ' + r.total + ' combinations, counting up in binary like Bit Flip. ' +
      litCount + (litCount === 1 ? ' lights' : ' light') + ' the bulb, and the fewest switches needed is ' + r.min +
      '. Each extra switch doubles the work: with 30 switches there would be over a billion combinations to try.';
  }
  function stopAnimation() {
    if (anim) { clearTimeout(anim.timer); anim = null; }
    ui.explain.hidden = true;
  }

  /* ---------- saving today's result ---------- */

  var form = G.nameForm({
    api: api, root: root,
    submit: function (name) { return G.call(api, '/logic/submit', { runId: states.daily.runId, name: name }, 10000); },
    onSaved: function (d) {
      var s = states.daily;
      s.saved = { name: d.name, rank: d.rankToday };
      save();
      board.mine(d.id);
      showSave();
      board.show(d.boards, 'today', d.id);
    },
    onGameError: function (err) { var s = states.daily; s.problem = err.message; s.runId = null; save(); showSave(); }
  });
  function showSave() {
    var s = cur, daily = mode === 'daily' && s.status === 'done' && !!api;
    if (!daily) return form.set('none');
    if (s.saved) return form.set('saved', 'Saved as ' + s.saved.name + ' · #' + s.saved.rank + ' today', true);
    if (s.runId && s.ms != null) return form.set('form');
    form.set('none', s.problem ? 'This result can’t be saved. ' + s.problem : '');
  }
  var board = G.board({
    api: api, el: document.getElementById('logiclights-board'), path: '/logic/leaderboard', mineKey: 'logiclights.mine',
    value: function (r) { return G.fmtTenths(r.ms); },
    empty: { today: 'Nobody has lit today’s bulb yet. Be the first!', yesterday: 'Nobody saved a result yesterday.', days: 'No results yet. Be the first!' }
  });

  /* ---------- wiring ---------- */

  ui.start.addEventListener('click', function () {
    var s = states.daily;
    if (s.status !== 'intro' || ui.start.disabled) return;
    if (!api) { s.status = 'play'; s.startedAt = Date.now(); applyStatus(); draw(); return; }
    ui.start.disabled = true;
    ui.start.textContent = 'Starting…';
    G.call(api, '/logic/start', {}, 6000).then(function (d) {
      if (d.dateKey !== today) { today = d.dateKey; s.circuit = L.dailyCircuit(today); s.bits = new Array(s.circuit.inputs).fill(0); }
      s.runId = d.runId;
      s.status = 'play';
      s.startedAt = Date.now();
      save();
      show('daily');
      say('Tap a switch to turn it on or off.');
    }, function (e) {
      say(e.message + ' Please try again in a moment.', 'warn');
    }).then(function () { ui.start.disabled = false; ui.start.textContent = 'Start'; });
  });
  ui.watch.addEventListener('click', watch);
  ui.next.addEventListener('click', function () {
    if (mode === 'daily') { if (!states.practice || states.practice.status === 'done') newPractice(); show('practice'); }
    else newPractice();
  });
  ui.newBtn.addEventListener('click', newPractice);
  ui.levelBtns.forEach(function (b) {
    b.addEventListener('click', function () { practiceLevel = b.getAttribute('data-level'); newPractice(); });
  });
  ui.modes.forEach(function (b) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-mode');
      if (which === 'practice' && !states.practice) newPractice();
      show(which);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    var k = e.key.toUpperCase(), i = NAMES.indexOf(k);
    if (i < 0 && /^[1-6]$/.test(e.key)) i = Number(e.key) - 1;
    if (i >= 0 && cur && cur.circuit.gates && i < cur.circuit.inputs && cur.status === 'play') { e.preventDefault(); flip(i); }
  });

  // Top to bottom on narrow screens, so switches and gates stay large enough to tap and read.
  function fit(force) {
    var wide = root.clientWidth >= 640;
    if (!force && wide === landscape) return;
    landscape = wide;
    if (anim) finishAnimation();
    draw();
  }
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { fit(false); }, 150); });

  loadDaily();
}());
