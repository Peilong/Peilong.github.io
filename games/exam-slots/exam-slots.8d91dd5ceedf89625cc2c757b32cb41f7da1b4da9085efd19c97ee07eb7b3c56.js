/* Exam Slots page: draws the courses and their shared-student lines (wide on big screens, tall on phones), lets the
   player paint exam slots onto courses, shows clashes, checks the daily answer with the server, practice puzzles, and
   "Watch a computer solve it" (backtracking, step by step). Rules: core.js. Shared parts: ../shared.js. */
(function () {
  'use strict';
  var X = window.ExamSlotsCore, G = window.GamesShared;
  var root = document.getElementById('examslots');
  if (!root || !X || !G) return;

  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var record = G.days('examslots.days');
  function q(s) { return root.querySelector(s); }
  var ui = {
    title: q('[data-title]'), meta: q('[data-meta]'), clock: q('[data-clock]'), svg: q('[data-svg]'), intro: q('[data-intro]'),
    start: q('[data-start]'), msg: q('[data-msg]'), palette: q('[data-palette]'), clear: q('[data-clear]'), tools: q('[data-tools]'),
    hint: q('[data-hint]'), explain: q('[data-explain]'), result: q('[data-result]'), resultBig: q('[data-result-big]'),
    resultDetail: q('[data-result-detail]'), resultExtra: q('[data-result-extra]'), watch: q('[data-watch]'), next: q('[data-next]'),
    levels: q('[data-levels]'), newBtn: q('[data-new]'),
    modes: Array.prototype.slice.call(document.querySelectorAll('.slots-page > .g-modes .g-mode')),
    levelBtns: Array.prototype.slice.call(root.querySelectorAll('[data-level]'))
  };

  var mode = 'daily', today = X.dateKey(), states = { daily: null, practice: null }, cur = null;
  var wide = true, els = null, clockTimer = 0, countdownTimer = 0, anim = null, practiceLevel = 'medium', brush = 0;

  function fresh(p) {
    return { puzzle: p, slots: new Array(p.n).fill(null), status: 'play', startedAt: Date.now(), finishedAt: 0, solved: false, ms: null };
  }
  function say(t, kind) { ui.msg.textContent = t || ''; ui.msg.className = 'g-msg' + (kind ? ' is-' + kind : ''); }
  function slotName(s) { return X.SLOTS[s]; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ---------- drawing ---------- */

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Grid units to the screen: columns across on wide screens; on phones the grid turns so its 3 rows run across.
  function frame(p) {
    if (wide) {
      var W = 760, sx = Math.min(165, (W - 150) / (p.cols - 1)), sy = 118, H = 84 + (p.rows - 1) * sy;
      var x0 = (W - (p.cols - 1) * sx) / 2;
      return { W: W, H: H, at: function (n) { return { x: x0 + n.x * sx, y: 42 + n.y * sy }; } };
    }
    var W2 = 376, sx2 = (W2 - 128) / (p.rows - 1), sy2 = 94, H2 = 80 + (p.cols - 1) * sy2;
    return { W: W2, H: H2, at: function (n) { return { x: 64 + n.y * sx2, y: 40 + n.x * sy2 }; } };
  }

  function draw() {
    var s = cur, p = s && s.puzzle;
    ui.svg.textContent = '';
    els = null;
    if (!p) return;
    var f = frame(p);
    ui.svg.setAttribute('viewBox', '0 0 ' + f.W + ' ' + f.H);
    svg('rect', { x: 0, y: 0, width: f.W, height: f.H, rx: 24, class: 'es-board' }, ui.svg);
    var gLines = svg('g', {}, ui.svg), gNodes = svg('g', {}, ui.svg);
    var pts = p.nodes.map(f.at);
    els = { lines: [], nodes: [] };
    p.edges.forEach(function (e) {
      els.lines.push(svg('line', { x1: pts[e[0]].x, y1: pts[e[0]].y, x2: pts[e[1]].x, y2: pts[e[1]].y, class: 'es-line' }, gLines));
    });
    p.nodes.forEach(function (node, i) {
      var g = svg('g', { class: 'es-course', role: 'button', tabindex: '0', transform: 'translate(' + pts[i].x + ' ' + pts[i].y + ')' }, gNodes);
      var hit = svg('rect', { class: 'es-hit' }, g);
      var pill = svg('rect', { class: 'es-pill' }, g);
      var text = svg('text', { class: 'es-name', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 1 }, g);
      text.textContent = node.name;
      var w = Math.max(56, Math.ceil(text.getBBox().width) + 24), h = wide ? 34 : 30;
      pill.setAttribute('x', -w / 2); pill.setAttribute('y', -h / 2); pill.setAttribute('width', w); pill.setAttribute('height', h);
      pill.setAttribute('rx', h / 2);
      hit.setAttribute('x', -w / 2 - 6); hit.setAttribute('y', -h / 2 - 8); hit.setAttribute('width', w + 12); hit.setAttribute('height', h + 16);
      var badge = svg('g', { class: 'es-badge', transform: 'translate(' + (-w / 2 + 3) + ' ' + (-h / 2 + 1) + ')' }, g);
      svg('circle', { r: 9.5 }, badge);
      var num = svg('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 }, badge);
      g.addEventListener('click', function () { paint(i); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); paint(i); }
        else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { e.preventDefault(); paint(i, null); }
      });
      // Highlight a course's lines under the mouse or keyboard focus (not after a tap, where nothing would clear it).
      g.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') focusLines(i, true); });
      g.addEventListener('pointerleave', function () { focusLines(i, false); });
      g.addEventListener('focus', function () { var v = false; try { v = g.matches(':focus-visible'); } catch (err) {} if (v) focusLines(i, true); });
      g.addEventListener('blur', function () { focusLines(i, false); });
      els.nodes.push({ el: g, num: num });
    });
    update();
  }

  function focusLines(i, on) {
    if (!els) return;
    cur.puzzle.edges.forEach(function (e, k) { if (e[0] === i || e[1] === i) els.lines[k].classList.toggle('is-near', on); });
  }

  function update(slotsOverride) {
    var s = cur;
    if (!els || !s) return [];
    var p = s.puzzle, slots = slotsOverride || s.slots, bad = X.clashes(p, slots), badNode = {};
    els.lines.forEach(function (l) { l.classList.remove('is-clash'); });
    bad.forEach(function (k) { els.lines[k].classList.add('is-clash'); badNode[p.edges[k][0]] = badNode[p.edges[k][1]] = true; });
    var playing = s.status === 'play' && !anim;
    els.nodes.forEach(function (n, i) {
      var v = slots[i];
      n.el.setAttribute('class', 'es-course' + (v !== null ? ' is-s' + v : '') + (badNode[i] ? ' is-clash' : ''));
      n.num.textContent = v !== null ? v + 1 : '';
      n.el.setAttribute('aria-label', p.nodes[i].name + ': ' + (v !== null ? slotName(v) : 'no slot yet') + (badNode[i] ? ', clash' : ''));
      n.el.setAttribute('tabindex', playing ? '0' : '-1');
    });
    return bad;
  }

  function renderPalette() {
    var s = cur, p = s && s.puzzle;
    ui.palette.textContent = '';
    if (!p) return;
    if (brush >= p.k) brush = 0;
    for (var k = 0; k < p.k; k++) {
      (function (k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'es-chip is-s' + k;
        b.setAttribute('aria-pressed', k === brush ? 'true' : 'false');
        b.innerHTML = '<span class="es-dot g-mono"></span><span class="es-chip-name"></span>';
        b.querySelector('.es-dot').textContent = k + 1;
        b.querySelector('.es-chip-name').textContent = slotName(k);
        b.addEventListener('click', function () { setBrush(k); });
        ui.palette.appendChild(b);
      })(k);
    }
  }
  function setBrush(k) {
    brush = k;
    Array.prototype.forEach.call(ui.palette.children, function (b, i) { b.setAttribute('aria-pressed', i === k ? 'true' : 'false'); });
  }

  function renderTop() {
    var s = cur, p = s && s.puzzle;
    if (mode === 'daily') ui.title.textContent = 'Exam Slots #' + states.daily.puzzle.number + ' · ' + G.shortDate(states.daily.puzzle.dateKey);
    else ui.title.textContent = 'Practice · ' + practiceLevel[0].toUpperCase() + practiceLevel.slice(1);
    ui.meta.textContent = p ? (mode === 'daily' ? X.LEVELS[p.level].name + ' · ' : '') + p.n + ' exams · ' + p.k + ' slots' : '';
    tick();
  }

  function applyStatus() {
    var s = cur;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-status', s.status);
    ui.intro.hidden = s.status !== 'intro';
    ui.levels.hidden = mode !== 'practice';
    ui.result.hidden = s.status !== 'done';
    ui.tools.hidden = s.status !== 'play';
    ui.hint.hidden = s.status === 'intro';
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
  // Put course i in the chosen slot (tapping it again with the same slot takes it out). to: a slot, or null to clear.
  function paint(i, to) {
    var s = cur;
    if (!s || s.status !== 'play' || anim || checking) return;
    var next = to === undefined ? (s.slots[i] === brush ? null : brush) : to;
    s.slots[i] = next;
    afterChange();
  }

  function afterChange() {
    var s = cur, p = s.puzzle, bad = update(), done = X.placed(p, s.slots);
    if (mode === 'daily') save();
    if (bad.length) {
      var e = p.edges[bad[0]];
      say('Clash: ' + p.nodes[e[0]].name + ' and ' + p.nodes[e[1]].name + ' share students, and both are in ' +
          slotName(s.slots[e[0]]) + '.' + (bad.length > 1 ? ' (' + bad.length + ' clashes)' : ''), 'warn');
      return;
    }
    if (done < p.n) { say(done ? 'Placed ' + done + ' of ' + p.n + ' exams. No clashes.' : ''); return; }
    if (mode === 'practice') return finish(null);
    checking = true;
    say('Every exam fits! Checking…', 'good');
    G.call(api, '/slots/check', { runId: s.runId, slots: s.slots }, 8000).then(function (d) {
      if (d.solved) finish(d.ms);
      else say('The server didn’t accept that schedule. Try again.', 'warn');
    }, function (e) {
      say(e.message, 'warn');
      if (e.data && e.data.error) { s.problem = e.message; finish(null); }
    }).then(function () { checking = false; });
  }

  function clearAll() {
    var s = cur;
    if (!s || s.status !== 'play' || anim || checking) return;
    s.slots = new Array(s.puzzle.n).fill(null);
    afterChange();
    say('Cleared. Start again whenever you like; the clock keeps running.');
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
    var s = cur, p = s.puzzle, daily = mode === 'daily';
    ui.resultBig.textContent = daily && s.ms != null ? G.fmtTenths(s.ms) : G.fmt(elapsed());
    ui.resultDetail.textContent = 'All ' + p.n + ' exams in ' + p.k + ' slots, and no student has two exams at once.';
    ui.next.textContent = daily ? 'Try a practice puzzle' : 'New practice puzzle';
    ui.watch.textContent = 'Watch a computer solve it';
    clearInterval(countdownTimer);
    if (daily) {
      var upd = function () {
        if (X.dateKey() !== today) { clearInterval(countdownTimer); loadDaily(); return; }
        var k = record.streak(today);
        ui.resultExtra.textContent = (k ? 'Streak: ' + plural(k, 'day', 'days') + ' · ' : '') + 'Next puzzle in ' + G.untilMidnight(X.TIME_ZONE);
      };
      upd();
      countdownTimer = setInterval(upd, 20000);
    } else {
      ui.resultExtra.textContent = 'Practice · ' + practiceLevel;
    }
    showSave();
  }

  /* ---------- today's puzzle / practice ---------- */

  function save() {
    var s = states.daily;
    if (!s || !s.runId) return;
    record.put(s.puzzle.dateKey, { runId: s.runId, status: s.status, slots: s.slots, startedAt: s.startedAt,
      finishedAt: s.finishedAt, solved: s.solved, ms: s.ms, saved: s.saved || null, problem: s.problem || '' });
  }

  function loadDaily() {
    today = X.dateKey();
    var p = X.dailyPuzzle(today), s = fresh(p), rec = record.get(today);
    s.status = 'intro';
    if (rec && rec.runId) {
      s.runId = rec.runId; s.status = rec.status === 'done' ? 'done' : 'play';
      if (Array.isArray(rec.slots) && rec.slots.length === p.n) s.slots = rec.slots;
      s.startedAt = rec.startedAt || Date.now(); s.finishedAt = rec.finishedAt || 0; s.solved = !!rec.solved;
      s.ms = rec.ms != null ? rec.ms : null; s.saved = rec.saved || null; s.problem = rec.problem || '';
    }
    states.daily = s;
    if (mode === 'daily') show('daily');
  }

  function newPractice() {
    var seed = window.crypto && crypto.getRandomValues ? crypto.getRandomValues(new Uint32Array(1))[0] : Math.floor(Math.random() * 4294967296);
    states.practice = fresh(X.makePuzzle(seed, X.PRACTICE[practiceLevel]));
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
    applyStatus();
    fit(true);
    renderPalette();
    renderTop();
    if (cur.status === 'play') afterChangeQuiet();
  }
  // After loading a game in progress: show clashes or progress without checking with the server again.
  function afterChangeQuiet() {
    var s = cur, p = s.puzzle, bad = X.clashes(p, s.slots), done = X.placed(p, s.slots);
    if (bad.length) say('There is a clash: look for the red dashed line.', 'warn');
    else if (done === p.n && mode === 'daily') afterChange();
    else if (done) say('Placed ' + done + ' of ' + p.n + ' exams. No clashes.');
  }

  /* ---------- watch a computer solve it ---------- */

  function watch() {
    if (anim) { finishAnimation(); return; }
    var s = cur, p = s.puzzle, r = X.search(p, 4000), shown = new Array(p.n).fill(null);
    anim = { i: 0, timer: 0, r: r };
    ui.watch.textContent = 'Skip to the end';
    ui.explain.hidden = false;
    update(shown);
    var box = ui.svg.getBoundingClientRect();                  // bring the map into view to watch it fill in
    if (box.top < 0 || box.bottom > window.innerHeight) ui.svg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var stepMs = Math.max(140, Math.min(650, Math.round(9000 / r.steps.length)));
    (function step() {
      if (!anim) return;
      if (anim.i >= r.steps.length) return finishAnimation();
      var st = r.steps[anim.i], name = p.nodes[st.v].name, wait = stepMs;
      if (st.dead) {
        ui.explain.textContent = 'Step ' + (anim.i + 1) + ': dead end. Every slot clashes for ' + name + ', so the computer backs up.';
        wait = stepMs * 3;
      } else if (st.s === null) {
        var was = shown[st.v];
        shown[st.v] = null;
        ui.explain.textContent = 'Step ' + (anim.i + 1) + ': backing up. ' + name + ' comes out of ' + slotName(was) + ' to try a later slot.';
        wait = stepMs * 2;
      } else {
        var prev = r.steps[anim.i - 1], retry = prev && prev.v === st.v && prev.s === null && !prev.dead;
        shown[st.v] = st.s;
        ui.explain.textContent = 'Step ' + (anim.i + 1) + ': ' + name + ' goes in ' + slotName(st.s) + ', the ' + (retry ? 'next' : 'first') + ' slot with no clash.';
      }
      update(shown);
      anim.i++;
      anim.timer = setTimeout(step, wait);
    })();
  }
  function finishAnimation() {
    if (!anim) return;
    var p = cur.puzzle, r = anim.r;
    clearTimeout(anim.timer);
    anim = null;
    update(r.slots);
    ui.watch.textContent = 'Watch again';
    ui.explain.textContent = 'Done in ' + plural(r.steps.length, 'step', 'steps') + ', backing up ' + plural(r.backs, 'time', 'times') +
      '. The computer placed exams column by column, always trying the earliest slot first. Trying every possible ' +
      'schedule instead would mean checking ' + r.everything.toLocaleString('en-US') + ' of them (' + p.k + ' choices for each of ' +
      p.n + ' exams). With a few hundred exams, no computer could try them all, and finding the fewest slots is one of ' +
      'computing’s famous hard problems.';
  }
  function stopAnimation() {
    if (anim) { clearTimeout(anim.timer); anim = null; }
    ui.explain.hidden = true;
  }

  /* ---------- saving today's result ---------- */

  var form = G.nameForm({
    api: api, root: root,
    submit: function (name) { return G.call(api, '/slots/submit', { runId: states.daily.runId, name: name }, 10000); },
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
    api: api, el: document.getElementById('examslots-board'), path: '/slots/leaderboard', mineKey: 'examslots.mine',
    value: function (r) { return G.fmtTenths(r.ms); },
    empty: { today: 'Nobody has scheduled today’s exams yet. Be the first!', yesterday: 'Nobody saved a result yesterday.', days: 'No results yet. Be the first!' }
  });

  /* ---------- wiring ---------- */

  ui.start.addEventListener('click', function () {
    var s = states.daily;
    if (s.status !== 'intro' || ui.start.disabled) return;
    if (!api) { s.status = 'play'; s.startedAt = Date.now(); show('daily'); return; }
    ui.start.disabled = true;
    ui.start.textContent = 'Starting…';
    G.call(api, '/slots/start', {}, 6000).then(function (d) {
      if (d.dateKey !== today) { today = d.dateKey; s.puzzle = X.dailyPuzzle(today); s.slots = new Array(s.puzzle.n).fill(null); }
      s.runId = d.runId;
      s.status = 'play';
      s.startedAt = Date.now();
      save();
      show('daily');
    }, function (e) {
      say(e.message + ' Please try again in a moment.', 'warn');
    }).then(function () { ui.start.disabled = false; ui.start.textContent = 'Start'; });
  });
  ui.clear.addEventListener('click', clearAll);
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
  // Number keys pick a slot; with a course focused, they also put it there.
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey || !cur || cur.status !== 'play') return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (!/^[1-4]$/.test(e.key) || Number(e.key) > cur.puzzle.k) return;
    e.preventDefault();
    setBrush(Number(e.key) - 1);
    var i = els ? els.nodes.map(function (n) { return n.el; }).indexOf(document.activeElement) : -1, keyboard = false;
    try { keyboard = i >= 0 && document.activeElement.matches(':focus-visible'); } catch (err) { /* old browser */ }
    if (keyboard) paint(i, brush);                // a course reached with Tab, not one just clicked
  });

  // Wide layout on big screens; on phones the grid turns so courses stay large enough to read and tap.
  function fit(force) {
    var w = root.clientWidth >= 600;
    if (!force && w === wide) return;
    wide = w;
    if (anim) finishAnimation();
    draw();
  }
  var resizeTimer = 0;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { fit(false); }, 150); });

  loadDaily();
}());
