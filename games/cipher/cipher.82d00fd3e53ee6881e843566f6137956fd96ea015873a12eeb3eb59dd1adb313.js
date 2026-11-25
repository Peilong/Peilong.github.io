/* Crack the Cipher page: shows the scrambled quotation, lets the player assign letters (tap a code letter, then type or
   tap a letter), flags letters used twice, shows letter counts, checks complete answers and gives hints through the
   server (today's quote) or locally (past quotes), and saves the result. Rules: core.js. Shared parts: ../shared.js. */
(function () {
  'use strict';
  var C = window.CipherCore, G = window.GamesShared;
  var root = document.getElementById('cipher');
  if (!root || !C || !G) return;

  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var record = G.days('cipher.days');
  var KEY_ROWS = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ'];
  function q(s) { return root.querySelector(s); }
  var ui = {
    title: q('[data-title]'), meta: q('[data-meta]'), clock: q('[data-clock]'), puzzle: q('[data-puzzle]'), intro: q('[data-intro]'),
    start: q('[data-start]'), pastlist: q('[data-pastlist]'), pastitems: q('[data-pastitems]'), msg: q('[data-msg]'),
    tools: q('[data-tools]'), counts: q('[data-counts]'), keys: q('[data-keys]'), result: q('[data-result]'),
    resultBig: q('[data-result-big]'), resultQuote: q('[data-result-quote]'), resultSource: q('[data-result-source]'),
    resultDetail: q('[data-result-detail]'), resultExtra: q('[data-result-extra]'), next: q('[data-next]'),
    modes: Array.prototype.slice.call(document.querySelectorAll('.cipher-page > .g-modes .g-mode'))
  };

  var mode = 'daily', today = C.dateKey(), states = { daily: null, past: null }, cur = null, sel = null, busy = false;
  var clockTimer = 0, countdownTimer = 0, pastItems = null;

  function say(t, kind) { ui.msg.textContent = t || ''; ui.msg.className = 'g-msg' + (kind ? ' is-' + kind : ''); }
  function fresh(extra) {
    return Object.assign({ cipher: '', guess: {}, given: {}, hints: 0, misses: 0, status: 'play', startedAt: Date.now(),
                           finishedAt: 0, solved: false, ms: null, text: '', source: '' }, extra);
  }
  function codeLetters(s) { return C.letterCounts(s.cipher).map(function (x) { return x.letter; }); }
  // Code letters in reading order (for moving the selection along).
  function readingOrder(s) {
    var seen = {}, out = [];
    for (var i = 0; i < s.cipher.length; i++) { var ch = s.cipher[i]; if (C.isLetter(ch) && !seen[ch]) { seen[ch] = 1; out.push(ch); } }
    return out;
  }
  // Plain letters used for more than one code letter (a substitution can't do that).
  function duplicates(s) {
    var by = {}, dup = {};
    Object.keys(s.guess).forEach(function (c) { var p = s.guess[c]; if (p) (by[p] = by[p] || []).push(c); });
    Object.keys(by).forEach(function (p) { if (by[p].length > 1) by[p].forEach(function (c) { dup[c] = true; }); });
    return dup;
  }

  /* ---------- drawing ---------- */

  function renderPuzzle() {
    var s = cur;
    ui.puzzle.textContent = '';
    if (!s || !s.cipher) return;
    var dup = duplicates(s), words = s.cipher.split(' ');
    words.forEach(function (w) {
      var word = document.createElement('span');
      word.className = 'cx-word';
      for (var i = 0; i < w.length; i++) {
        var ch = w[i];
        if (C.isLetter(ch)) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'cx-cell' + (ch === sel ? ' is-sel' : '') + (dup[ch] ? ' is-dup' : '') + (s.given[ch] ? ' is-given' : '') +
                        (s.guess[ch] ? ' is-filled' : '');
          b.setAttribute('data-code', ch);
          b.setAttribute('aria-label', 'Code letter ' + ch + (s.guess[ch] ? ', you have ' + s.guess[ch] : ', empty'));
          b.innerHTML = '<span class="cx-guess g-mono"></span><span class="cx-code g-mono"></span>';
          b.firstChild.textContent = s.status === 'done' ? (s.solution ? s.solution[ch] : s.guess[ch] || '') : (s.guess[ch] || '');
          b.lastChild.textContent = ch;
          b.disabled = s.status !== 'play';
          b.addEventListener('click', function () { select(this.getAttribute('data-code')); });
          word.appendChild(b);
        } else {
          var p = document.createElement('span');
          p.className = 'cx-punct g-mono';
          p.textContent = ch;
          word.appendChild(p);
        }
      }
      ui.puzzle.appendChild(word);
    });
  }

  function renderCounts() {
    var s = cur;
    ui.counts.textContent = '';
    if (!s || !s.cipher) return;
    var head = document.createElement('p');
    head.className = 'cx-counts-head';
    head.textContent = 'Letter counts. In English, the most common letters are E, T, A, O, I, N.';
    ui.counts.appendChild(head);
    var row = document.createElement('div');
    row.className = 'cx-count-row';
    C.letterCounts(s.cipher).forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cx-count' + (x.letter === sel ? ' is-sel' : '') + (s.guess[x.letter] ? ' is-filled' : '');
      b.innerHTML = '<b class="g-mono"></b><span class="g-mono"></span><i class="g-mono"></i>';
      b.children[0].textContent = x.letter;
      b.children[1].textContent = x.count;
      b.children[2].textContent = s.guess[x.letter] ? '→ ' + s.guess[x.letter] : '';
      b.setAttribute('aria-label', x.letter + ' appears ' + x.count + ' times' + (s.guess[x.letter] ? ', you have ' + s.guess[x.letter] : ''));
      b.disabled = s.status !== 'play';
      b.addEventListener('click', function () { select(x.letter); });
      row.appendChild(b);
    });
    ui.counts.appendChild(row);
  }

  function buildKeys() {
    ui.keys.textContent = '';
    KEY_ROWS.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'cx-keyrow';
      r.split('').forEach(function (ch) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'cx-key g-mono'; b.textContent = ch; b.setAttribute('data-key', ch);
        b.addEventListener('click', function () { assign(ch); });
        row.appendChild(b);
      });
      ui.keys.appendChild(row);
    });
    var act = document.createElement('div');
    act.className = 'cx-keyrow';
    act.innerHTML = '<button type="button" class="cx-key cx-key-wide" data-clear>Clear</button>' +
                    '<button type="button" class="cx-key cx-key-wide cx-key-hint" data-hint>Reveal a letter (+30 s)</button>';
    act.querySelector('[data-clear]').addEventListener('click', function () { assign(''); });
    act.querySelector('[data-hint]').addEventListener('click', hint);
    ui.keys.appendChild(act);
  }
  function renderKeys() {
    var s = cur, used = {};
    if (s) Object.keys(s.guess).forEach(function (c) { used[s.guess[c]] = true; });
    ui.keys.querySelectorAll('[data-key]').forEach(function (b) {
      b.classList.toggle('is-used', !!used[b.getAttribute('data-key')]);
      b.disabled = !s || s.status !== 'play' || busy;
    });
    ui.keys.querySelectorAll('[data-clear], [data-hint]').forEach(function (b) { b.disabled = !s || s.status !== 'play' || busy; });
  }

  function renderTop() {
    var s = cur;
    if (mode === 'daily') ui.title.textContent = 'Crack the Cipher #' + states.daily.number + ' · ' + G.shortDate(states.daily.dateKey);
    else ui.title.textContent = s ? 'Past quote #' + s.number + ' · ' + G.shortDate(s.dateKey) : 'Past quotes';
    ui.meta.textContent = s && s.cipher ? codeLetters(s).length + ' different letters' + (s.hints ? ' · ' + s.hints + (s.hints === 1 ? ' hint' : ' hints') : '') : '';
    tick();
  }
  function render() { renderTop(); renderPuzzle(); renderCounts(); renderKeys(); }

  function applyStatus() {
    var s = cur, listing = mode === 'past' && !s;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-status', listing ? 'list' : s.status);
    ui.intro.hidden = !(s && s.status === 'intro');
    ui.pastlist.hidden = !listing;
    ui.puzzle.hidden = listing || (s && s.status === 'intro');
    ui.tools.hidden = ui.keys.hidden = listing || !s || s.status !== 'play';
    ui.result.hidden = !(s && s.status === 'done');
    if (s && s.status === 'play') startClock(); else { stopClock(); tick(); }
    if (s && s.status === 'done') showResult(); else clearInterval(countdownTimer);
  }

  /* ---------- clock (includes time added for hints and wrong answers) ---------- */

  function elapsed() {
    var s = cur;
    if (!s || s.status === 'intro') return 0;
    if (s.status === 'done') return s.ms != null ? s.ms : s.finishedAt - s.startedAt + s.hints * C.HINT_MS + s.misses * C.MISS_MS;
    return Date.now() - s.startedAt + s.hints * C.HINT_MS + s.misses * C.MISS_MS;
  }
  function tick() { ui.clock.textContent = G.fmt(elapsed()); }
  function startClock() { stopClock(); tick(); clockTimer = setInterval(tick, 250); }
  function stopClock() { clearInterval(clockTimer); }

  /* ---------- playing ---------- */

  function select(code) {
    if (!cur || cur.status !== 'play') return;
    sel = code;
    say(cur.given[code] ? code + ' is ' + cur.guess[code] + ' (revealed).' : 'Code letter ' + code + ': type the letter you think it stands for.');
    renderPuzzle(); renderCounts();
  }
  function moveSel(step) {
    var s = cur, order = readingOrder(s);
    if (!order.length) return;
    var i = sel ? order.indexOf(sel) : -1;
    sel = order[(i + step + order.length) % order.length];
    renderPuzzle(); renderCounts();
  }
  function nextEmpty() {
    var s = cur, order = readingOrder(s), i = order.indexOf(sel);
    for (var k = 1; k <= order.length; k++) {
      var c = order[(i + k) % order.length];
      if (!s.guess[c]) return c;
    }
    return sel;
  }

  function assign(letter) {
    var s = cur;
    if (!s || s.status !== 'play' || busy) return;
    if (!sel) { say('First tap a code letter in the puzzle.', 'warn'); return; }
    if (s.given[sel]) { say(sel + ' was revealed, so it stays ' + s.guess[sel] + '.'); return; }
    if (letter) s.guess[sel] = letter; else delete s.guess[sel];
    if (letter) sel = nextEmpty();
    say('');
    save();
    render();
    if (letter) maybeCheck();
  }

  function complete(s) {
    return codeLetters(s).every(function (c) { return s.guess[c]; }) && !Object.keys(duplicates(s)).length;
  }

  function maybeCheck() {
    var s = cur;
    if (!complete(s)) {
      if (Object.keys(duplicates(s)).length) say('Two code letters can’t stand for the same letter. Change one of the orange ones.', 'warn');
      return;
    }
    if (mode === 'past') {
      var wrong = C.wrongLetters(s.cipher, s.plain, s.guess);
      if (!wrong) return finish(null);
      s.misses++;
      return say(wrong + (wrong === 1 ? ' letter is' : ' letters are') + ' wrong. (+15 seconds)', 'warn');
    }
    busy = true; renderKeys();
    say('Checking…');
    G.call(api, '/cipher/check', { runId: s.runId, guess: s.guess }, 8000).then(function (d) {
      if (d.solved) { s.text = d.text; s.source = d.source; return finish(d.ms); }
      s.misses++;
      save();
      say(d.wrong + (d.wrong === 1 ? ' letter is' : ' letters are') + ' wrong. (+15 seconds)', 'warn');
      tick();
    }, function (e) {
      say(e.message, 'warn');
      if (e.data && e.data.error && /verified/.test(e.message)) { s.problem = e.message; finish(null); }
    }).then(function () { busy = false; renderKeys(); });
  }

  function hint() {
    var s = cur;
    if (!s || s.status !== 'play' || busy) return;
    function reveal(c, p) {
      Object.keys(s.guess).forEach(function (k) { if (s.guess[k] === p && k !== c) delete s.guess[k]; });
      s.guess[c] = p; s.given[c] = true; s.hints++;
      sel = c;
      say('Revealed: ' + c + ' stands for ' + p + '. (+30 seconds)', 'warn');
      save(); render();
      maybeCheck();
    }
    if (mode === 'past') {
      var pick = C.letterCounts(s.cipher).map(function (x) { return x.letter; }).filter(function (c) { return s.guess[c] !== s.solution[c]; })[0];
      if (pick) reveal(pick, s.solution[pick]);
      return;
    }
    busy = true; renderKeys();
    G.call(api, '/cipher/hint', { runId: s.runId, guess: s.guess }, 8000).then(function (d) { busy = false; reveal(d.cipher, d.plain); },
      function (e) { busy = false; renderKeys(); say(e.message, 'warn'); });
  }

  function finish(ms) {
    var s = cur;
    s.status = 'done';
    s.solved = true;
    s.finishedAt = Date.now();
    if (ms != null) s.ms = ms;
    s.solution = s.solution || Object.assign({}, s.guess);
    sel = null;
    save();
    say('');
    applyStatus();
    render();
  }

  function showResult() {
    var s = cur, daily = mode === 'daily';
    ui.resultBig.textContent = daily && s.ms != null ? G.fmtTenths(s.ms) : G.fmt(elapsed());
    ui.resultQuote.textContent = s.text;
    ui.resultSource.textContent = s.source;
    ui.resultDetail.textContent = (s.hints ? s.hints + (s.hints === 1 ? ' letter revealed' : ' letters revealed') : 'No letters revealed') +
      (s.misses ? ' · ' + s.misses + (s.misses === 1 ? ' wrong answer' : ' wrong answers') : '') + '.';
    ui.next.textContent = daily ? 'Try a past quote' : 'Pick another past quote';
    clearInterval(countdownTimer);
    if (daily) {
      var upd = function () {
        if (C.dateKey() !== today) { clearInterval(countdownTimer); loadDaily(); return; }
        var k = record.streak(today);
        ui.resultExtra.textContent = (k ? 'Streak: ' + k + (k === 1 ? ' day' : ' days') + ' · ' : '') + 'Next quote in ' + G.untilMidnight(C.TIME_ZONE);
      };
      upd();
      countdownTimer = setInterval(upd, 20000);
    } else {
      ui.resultExtra.textContent = 'Past quote #' + s.number + ' · ' + G.shortDate(s.dateKey);
    }
    showSave();
  }

  /* ---------- today's quote / past quotes ---------- */

  function save() {
    var s = states.daily;
    if (mode !== 'daily' || !s || !s.runId) return;
    record.put(s.dateKey, { runId: s.runId, number: s.number, cipher: s.cipher, guess: s.guess, given: s.given, hints: s.hints,
      misses: s.misses, status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, solved: s.solved, ms: s.ms,
      text: s.text, source: s.source, solution: s.solution || null, saved: s.saved || null, problem: s.problem || '' });
  }

  function loadDaily() {
    today = C.dateKey();
    var s = fresh({ dateKey: today, number: C.dayNumber(today), status: 'intro' }), rec = record.get(today);
    if (rec && rec.runId) {
      Object.assign(s, rec);
      s.status = rec.status === 'done' ? 'done' : 'play';
    }
    states.daily = s;
    if (mode === 'daily') show('daily');
  }

  function show(which) {
    mode = which;
    cur = which === 'daily' ? states.daily : states.past;
    sel = null;
    ui.modes.forEach(function (b) {
      var on = b.getAttribute('data-mode') === which;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    say('');
    applyStatus();
    render();
    if (which === 'past' && !cur) loadPastList();
  }

  function loadPastList() {
    if (pastItems) return renderPastList();
    ui.pastitems.textContent = 'Loading…';
    G.call(api, '/cipher/past', null, 8000).then(function (d) { pastItems = d.past || []; renderPastList(); },
      function (e) { ui.pastitems.textContent = e.message; });
  }
  function renderPastList() {
    ui.pastitems.textContent = '';
    if (!pastItems.length) { ui.pastitems.textContent = 'Past quotes appear here from the day after Crack the Cipher starts.'; return; }
    pastItems.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cx-pastitem';
      b.innerHTML = '<b class="g-mono">#' + it.number + '</b><span>' + G.shortDate(it.dateKey) + '</span>';
      b.addEventListener('click', function () {
        b.disabled = true;
        G.call(api, '/cipher/reveal?date=' + it.dateKey, null, 8000).then(function (d) {
          var sol = {};
          for (var i = 0; i < d.cipher.length; i++) if (C.isLetter(d.cipher[i])) sol[d.cipher[i]] = d.plain[i];
          states.past = fresh({ dateKey: d.dateKey, number: d.number, cipher: d.cipher, plain: d.plain, text: d.text,
                                source: d.source, solution: sol });
          show('past');
        }, function (e) { b.disabled = false; say(e.message, 'warn'); });
      });
      ui.pastitems.appendChild(b);
    });
  }

  /* ---------- saving today's result ---------- */

  var form = G.nameForm({
    api: api, root: root,
    submit: function (name) { return G.call(api, '/cipher/submit', { runId: states.daily.runId, name: name }, 10000); },
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
    api: api, el: document.getElementById('cipher-board'), path: '/cipher/leaderboard', mineKey: 'cipher.mine',
    value: function (r) { return G.fmtTenths(r.ms) + (r.hints ? ' · ' + r.hints + (r.hints === 1 ? ' hint' : ' hints') : ''); },
    empty: { today: 'Nobody has cracked today’s quote yet. Be the first!', yesterday: 'Nobody saved a result yesterday.', days: 'No results yet. Be the first!' }
  });

  /* ---------- wiring ---------- */

  ui.start.addEventListener('click', function () {
    var s = states.daily;
    if (s.status !== 'intro' || ui.start.disabled) return;
    if (!api) { say('This game needs its server, which is not set up here.', 'warn'); return; }
    ui.start.disabled = true;
    ui.start.textContent = 'Starting…';
    G.call(api, '/cipher/start', {}, 6000).then(function (d) {
      today = d.dateKey;
      Object.assign(s, { runId: d.runId, dateKey: d.dateKey, number: d.number, cipher: d.cipher, status: 'play', startedAt: Date.now() });
      save();
      show('daily');
      select(readingOrder(s)[0]);
    }, function (e) {
      say(e.message + ' Please try again in a moment.', 'warn');
    }).then(function () { ui.start.disabled = false; ui.start.textContent = 'Start'; });
  });
  ui.next.addEventListener('click', function () { states.past = null; show('past'); });
  ui.modes.forEach(function (b) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-mode');
      if (which === 'past' && mode === 'past') states.past = null;
      show(which);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (!cur || cur.status !== 'play') return;
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); assign(e.key.toUpperCase()); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); assign(''); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveSel(-1); }
  });

  buildKeys();
  loadDaily();
}());
