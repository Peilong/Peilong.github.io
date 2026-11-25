/* Bit Flip page: screens, switches, timer, personal best and the leaderboard. Rules and scoring come from core.js.
   Leaderboard: when #bitflip has data-api (params.toml [games] bitflip_api), each game is dealt by the server
   (POST /start), and a finished game can be saved with a name (POST /submit). The server re-scores it with core.js. */
(function () {
  'use strict';
  var Core = window.BitFlipCore;
  var root = document.getElementById('bitflip');
  if (!root || !Core) return;

  function q(sel) { return root.querySelector(sel); }
  var ui = {
    score: q('[data-score]'), mult: q('[data-mult]'), pips: root.querySelectorAll('[data-pip]'),
    time: q('[data-time]'), bar: q('[data-timebar]'),
    target: q('[data-goal]'), sumLine: q('[data-sumline]'), binary: q('[data-binary]'), sum: q('[data-sum]'),
    floater: q('[data-float]'), live: q('[data-live]'),
    ready: q('[data-screen="ready"]'), count: q('[data-screen="count"]'), over: q('[data-screen="over"]'),
    countNum: q('[data-count]'), finalScore: q('[data-final-score]'), finalStats: q('[data-final-stats]'),
    best: q('[data-best]'), again: q('[data-again]'),
    save: q('[data-save]'), nameInput: q('[data-name]'), saveBtn: q('[data-save-btn]'), saveMsg: q('[data-save-msg]'),
    saveNote: q('[data-save-note]'),
    switches: Array.prototype.slice.call(root.querySelectorAll('.bf-switch'))
  };
  var board = document.getElementById('bitflip-board');
  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var BEST_KEY = 'bitflip.best', NAME_KEY = 'bitflip.name', MINE_KEY = 'bitflip.mine';

  var phase = 'ready', seed = 0, deck = null, target = 0, bits = 0, startAt = 0, lastSolve = 0;
  var solves = [], streak = 0, score = 0, accepting = false, frame = 0, timers = [];
  var usingKeyboard = false;               // move focus after a round only for keyboard players
  var game = 0;                            // counts rounds, so a late server reply for an old round is ignored
  var runId = null, runProblem = '';       // the server's id for this round, or why there is none

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  // Restart a CSS animation by removing and re-adding its class.
  function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  function newSeed() {
    if (window.crypto && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0];
    return Math.floor(Math.random() * 4294967296);
  }

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: not remembered */ }
  }

  /* ---------- server calls ---------- */

  // Body is sent as plain text so the browser skips the extra CORS preflight request.
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

  /* ---------- game ---------- */

  function show(name) {
    phase = name;
    root.setAttribute('data-phase', name);
    ui.ready.hidden = name !== 'ready';
    ui.count.hidden = name !== 'count';
    ui.over.hidden = name !== 'over';
    ui.switches.forEach(function (b) { b.disabled = name !== 'play'; });
  }

  function setSwitches(mask) {
    bits = mask;
    ui.switches.forEach(function (b) {
      var on = (mask & Number(b.getAttribute('data-value'))) !== 0;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.querySelector('.bf-bit').textContent = on ? '1' : '0';
    });
    ui.binary.textContent = Core.toBinary(mask);
    ui.sum.textContent = mask;           // the switches are powers of two, so the sum is the mask itself
    ui.sumLine.classList.toggle('is-high', phase === 'play' && mask > target);
  }

  function renderHud() {
    ui.score.textContent = score;
    var m = Core.multiplierFor(streak);
    ui.mult.textContent = '×' + m;
    var filled = m >= Core.MAX_MULTIPLIER ? Core.STREAK_STEP : streak % Core.STREAK_STEP;
    Array.prototype.forEach.call(ui.pips, function (p, i) { p.classList.toggle('is-on', i < filled); });
  }

  function renderTime(left) {
    ui.time.textContent = Math.ceil(left / 1000);
    ui.bar.style.transform = 'scaleX(' + Math.max(0, left / Core.GAME_MS) + ')';
    root.classList.toggle('is-low', phase === 'play' && left <= 10000);
  }

  function start() {
    clearTimers();
    cancelAnimationFrame(frame);
    var mine = ++game;
    solves = []; streak = 0; score = 0; lastSolve = 0; target = 0;
    runId = null; runProblem = '';
    ui.target.textContent = '';
    show('count');
    setSwitches(0);
    renderHud();
    renderTime(Core.GAME_MS);

    // Ask the server to deal this round while the countdown runs. If it is slow or down, play anyway.
    var dealt = !api ? Promise.resolve(null) : call('/start', {}, 2500).catch(function (e) {
      runProblem = e.message;
      return null;
    });
    var n = 3;
    (function step() {
      if (n === 0) {
        return dealt.then(function (d) { if (mine === game && phase === 'count') begin(d); });
      }
      ui.countNum.textContent = n--;
      pop(ui.countNum, 'is-tick');
      later(step, 650);
    })();
  }

  function begin(dealtRun) {
    seed = dealtRun ? dealtRun.seed >>> 0 : newSeed();
    runId = dealtRun ? dealtRun.runId : null;
    deck = Core.createDeck(seed);
    show('play');
    startAt = performance.now();
    nextTarget();
    frame = requestAnimationFrame(tick);
  }

  function nextTarget() {
    target = deck();
    ui.target.textContent = target;
    ui.target.classList.remove('is-solved');
    pop(ui.target, 'is-new');
    setSwitches(0);
    accepting = true;
    ui.live.textContent = 'Make ' + target + '.';
  }

  function flip(i) {
    if (phase !== 'play' || !accepting) return;
    setSwitches(bits ^ Core.VALUES[i]);
    if (bits === target) solved();
  }

  function solved() {
    var t = Math.round(performance.now() - startAt);
    if (t >= Core.GAME_MS) return;       // too late; tick() is about to end the round
    accepting = false;
    var s = Core.scoreSolve(target, t - lastSolve, streak);
    solves.push(t);
    lastSolve = t;
    streak = s.streak;
    score += s.points;
    renderHud();
    ui.target.classList.add('is-solved');
    ui.floater.textContent = '+' + s.points;
    pop(ui.floater, 'is-show');
    later(nextTarget, Core.ADVANCE_MS);
  }

  function tick() {
    var left = Core.GAME_MS - (performance.now() - startAt);
    if (left <= 0) return end();
    renderTime(left);
    frame = requestAnimationFrame(tick);
  }

  function end() {
    accepting = false;
    clearTimers();
    var run = Core.scoreRun(seed, solves);   // the same scoring the leaderboard server runs
    var best = load(BEST_KEY, 0) || 0;
    var isBest = run.score > best;
    if (isBest) store(BEST_KEY, run.score);
    show('over');
    renderTime(0);
    ui.finalScore.textContent = run.score;
    ui.finalStats.textContent = run.solved + (run.solved === 1 ? ' number' : ' numbers') +
      ' · best streak ' + run.bestStreak;
    ui.best.textContent = isBest ? 'New personal best!' : 'Your best: ' + best;
    ui.best.classList.toggle('is-new', isBest);
    ui.live.textContent = 'Time is up. Your score is ' + run.score + '.';
    offerSave(run.score);
  }

  /* ---------- saving a score ---------- */

  function setNote(text, good) {
    ui.saveNote.textContent = text || '';
    ui.saveNote.hidden = !text;
    ui.saveNote.classList.toggle('is-good', !!good);
  }

  function offerSave(points) {
    var canSave = !!(api && runId && points > 0);
    ui.save.hidden = !canSave;
    ui.again.classList.toggle('bf-btn-ghost', canSave);
    ui.saveMsg.textContent = '';
    ui.saveBtn.disabled = false;
    setNote('');
    if (api && points > 0 && !runId) setNote('This score can’t be saved. ' + (runProblem || ''));
    if (canSave) {
      ui.nameInput.value = load(NAME_KEY, '') || '';
      if (usingKeyboard) later(function () { ui.nameInput.focus({ preventScroll: true }); }, 50);
    } else if (usingKeyboard) {
      later(function () { ui.again.focus({ preventScroll: true }); }, 50);
    }
  }

  // Quick checks in the browser; the server makes the final decision, including the bad-word check.
  var NAME_OK = /./;                       // very old browsers lack \p{...}; the server still checks
  try { NAME_OK = new RegExp("^[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} '_-]*$", 'u'); } catch (e) { /* keep fallback */ }
  function localNameProblem(name) {
    var len = Array.from(name).length;
    if (len < 2) return 'Use at least 2 characters.';
    if (len > 16) return 'Use at most 16 characters.';
    if (!NAME_OK.test(name)) return 'Use letters, numbers, spaces, - or _ only.';
    return '';
  }
  function cleanName(raw) { return raw.normalize('NFKC').replace(/\s+/g, ' ').trim(); }

  var checkTimer = 0, checkSeq = 0;
  ui.nameInput.addEventListener('input', function () {
    clearTimeout(checkTimer);
    var name = cleanName(ui.nameInput.value);
    var seq = ++checkSeq;
    if (!name) { ui.saveMsg.textContent = ''; return; }
    var local = localNameProblem(name);
    if (local) { ui.saveMsg.textContent = name.length > 1 || local.indexOf('letters') >= 0 ? local : ''; return; }
    ui.saveMsg.textContent = '';
    checkTimer = setTimeout(function () {
      call('/check-name', { name: name }, 5000).then(function (d) {
        if (seq === checkSeq) ui.saveMsg.textContent = d.ok ? '' : d.error;
      }, function () { /* the save itself will report problems */ });
    }, 350);
  });

  ui.save.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = cleanName(ui.nameInput.value);
    var local = localNameProblem(name);
    clearTimeout(checkTimer); checkSeq++;      // a late live check must not overwrite the server's answer
    if (local) { ui.saveMsg.textContent = local; ui.nameInput.focus(); return; }
    var thisRun = runId;
    ui.saveBtn.disabled = true;
    ui.saveMsg.textContent = 'Saving…';
    call('/submit', { runId: thisRun, times: solves, name: name }, 10000).then(function (d) {
      if (thisRun !== runId) return;
      store(NAME_KEY, d.name);
      var mine = load(MINE_KEY, []);
      if (!Array.isArray(mine)) mine = [];
      mine.push(d.id);
      store(MINE_KEY, mine.slice(-100));
      ui.save.hidden = true;
      ui.again.classList.remove('bf-btn-ghost');
      setNote('Saved! You’re #' + d.rankToday + ' today.', true);
      ui.live.textContent = 'Saved. You are number ' + d.rankToday + ' today.';
      showBoards(d.boards, 'today', d.id);
      if (usingKeyboard) ui.again.focus({ preventScroll: true });
    }, function (err) {
      if (thisRun !== runId) return;
      ui.saveBtn.disabled = false;
      ui.saveMsg.textContent = err.message;
      if (err.data && err.data.field === 'name') { ui.nameInput.focus(); return; }
      if (err.data && err.data.error) {            // the game itself can't be saved (too old, already saved, ...)
        ui.save.hidden = true;
        ui.again.classList.remove('bf-btn-ghost');
        setNote(err.message);
      }
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
    var list = board.querySelector('[data-board-list]');
    var empty = board.querySelector('[data-board-empty]');
    var rows = (boards && boards[tab]) || [];
    var mine = load(MINE_KEY, []);
    list.textContent = '';
    rows.forEach(function (r, i) {
      var li = document.createElement('li');
      li.className = 'bf-row';
      if (Array.isArray(mine) && mine.indexOf(r.id) >= 0) li.classList.add('is-me');
      if (r.id === flash) li.classList.add('is-new');
      var rank = document.createElement('span'); rank.className = 'bf-rank'; rank.textContent = i + 1;
      var name = document.createElement('span'); name.className = 'bf-row-name'; name.textContent = r.name;
      if (li.classList.contains('is-me')) {
        var you = document.createElement('span'); you.className = 'bf-you'; you.textContent = 'you'; name.appendChild(you);
      }
      var pts = document.createElement('span'); pts.className = 'bf-row-score'; pts.textContent = r.score;
      li.appendChild(rank); li.appendChild(name); li.appendChild(pts);
      list.appendChild(li);
    });
    empty.hidden = rows.length > 0;
    empty.textContent = !boards ? 'The leaderboard could not be loaded right now.'
      : tab === 'today' ? 'No scores yet today. Be the first!' : 'No scores yet. Be the first!';
  }

  if (board && api) {
    board.hidden = false;
    var tabs = Array.prototype.slice.call(board.querySelectorAll('[data-board-tab]'));
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-board-tab'); flash = null; renderBoard(); });
      b.addEventListener('keydown', function (e) {             // arrow keys move between tabs
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var nextTab = tabs[(i + d + tabs.length) % tabs.length];
        nextTab.click(); nextTab.focus();
      });
    });
    call('/leaderboard', null, 8000).then(function (d) { showBoards(d.boards); }, function () { renderBoard(); });
  }

  /* ---------- input ---------- */

  ui.switches.forEach(function (b, i) { b.addEventListener('click', function () { flip(i); }); });
  root.querySelectorAll('[data-start]').forEach(function (b) { b.addEventListener('click', start); });

  document.addEventListener('pointerdown', function () { usingKeyboard = false; }, true);
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    usingKeyboard = true;
    var el = e.target, tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return;
    if (phase === 'play' && e.key >= '1' && e.key <= '8') {
      e.preventDefault();
      flip(Number(e.key) - 1);
    } else if ((phase === 'ready' || phase === 'over') && e.key === 'Enter' && tag !== 'button' && tag !== 'a' &&
               (el === document.body || root.contains(el))) {
      e.preventDefault();
      start();
    }
  });

  show('ready');
  setSwitches(0);
  renderHud();
  renderTime(Core.GAME_MS);
}());
