/* Code Word page: typing (on-screen letters or a keyboard), guesses checked by the server, the letter tracker, the
   result with the term's explanation, past-word practice, today's record in this browser, and the leaderboard.
   The answers are never on this page: the server checks each guess and reveals the word when a game ends. */
(function () {
  'use strict';
  var Core = window.CodeWordCore;
  var root = document.getElementById('codeword');
  if (!root || !Core) return;

  var api = (root.getAttribute('data-api') || '').replace(/\/+$/, '');
  var DAYS_KEY = 'codeword.days', NAME_KEY = 'games.name', MINE_KEY = 'codeword.mine';
  var MARK_TEXT = ['–', '○', '●'];                  // absent, elsewhere, right spot
  var MARK_WORD = ['not in the word', 'in the word, elsewhere', 'right spot'];
  var MARK_CLASS = ['is-absent', 'is-else', 'is-exact'];
  var KEY_ROWS = ['abcdefghi', 'jklmnopqr', 'stuvwxyz'];          // alphabetical, so letters are easy to find

  function q(s) { return root.querySelector(s); }
  var ui = {
    title: q('[data-title]'), meta: q('[data-meta]'), clock: q('[data-clock]'), rows: q('[data-rows]'),
    intro: q('[data-intro]'), start: q('[data-start]'), pastlist: q('[data-pastlist]'), pastitems: q('[data-pastitems]'),
    live: q('[data-live]'), msg: q('[data-msg]'), keys: q('[data-keys]'), result: q('[data-result]'),
    resultEyebrow: q('[data-result-eyebrow]'), resultWord: q('[data-result-word]'), resultDetail: q('[data-result-detail]'),
    resultAbout: q('[data-result-about]'), resultExtra: q('[data-result-extra]'), next: q('[data-next]'),
    save: q('[data-save]'), nameInput: q('[data-name]'), saveBtn: q('[data-save-btn]'), saveMsg: q('[data-save-msg]'),
    saveNote: q('[data-save-note]'), modes: Array.prototype.slice.call(document.querySelectorAll('.cw-mode'))
  };
  var board = document.getElementById('codeword-board');

  /* ---------- helpers ---------- */

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: not remembered */ }
  }
  // Server call. The body goes as plain text, so the browser skips the extra CORS preflight request.
  function call(path, body, ms) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, ms || 8000) : 0;
    return fetch(api + path, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        clearTimeout(timer);
        if (!r.ok) { var err = new Error(d.error || 'The game server could not be reached.'); err.data = d; throw err; }
        return d;
      });
    }, function () {
      clearTimeout(timer);
      throw new Error('The game server could not be reached.');
    });
  }
  function fmt(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function fmtTenths(ms) {
    var t = Math.max(0, Math.floor(ms / 100)), s = Math.floor(t / 10);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2) + '.' + (t % 10);
  }
  function shortDate(key) {
    return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function say(text, kind) { ui.msg.textContent = text || ''; ui.msg.className = 'cw-msg' + (kind ? ' is-' + kind : ''); }
  function pop(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  /* ---------- state ---------- */

  function fresh(extra) {
    return Object.assign({ guesses: [], marks: [], typed: '', status: 'play', solved: false, word: '', about: '',
                           length: 0, tries: 0, startedAt: Date.now(), finishedAt: 0 }, extra);
  }
  var states = { daily: null, past: null }, mode = 'daily', cur = null, today = Core.dateKey();
  var busy = false, clockTimer = 0, countdownTimer = 0, pastItems = null;

  function loadDays() { var d = load(DAYS_KEY, {}); return d && typeof d === 'object' ? d : {}; }
  function saveDaily() {
    var s = states.daily;
    if (!s || !s.runId) return;
    var d = loadDays();
    d[s.dateKey] = { runId: s.runId, number: s.number, length: s.length, tries: s.tries, guesses: s.guesses, marks: s.marks,
                     status: s.status, solved: s.solved, word: s.word, about: s.about, startedAt: s.startedAt,
                     finishedAt: s.finishedAt, ms: s.ms || null, saved: s.saved || null };
    var keys = Object.keys(d).sort();
    while (keys.length > 120) delete d[keys.shift()];
    store(DAYS_KEY, d);
  }
  function streak() {
    var d = loadDays(), key = today, n = 0;
    if (!(d[key] && d[key].solved)) key = Core.shiftDay(key, -1);
    while (d[key] && d[key].solved) { n++; key = Core.shiftDay(key, -1); }
    return n;
  }
  function msToMidnight() {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: Core.TIME_ZONE, hour: 'numeric', minute: 'numeric',
      second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    var get = function (t) { return Number(parts.filter(function (p) { return p.type === t; })[0].value); };
    return 86400000 - ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
  }

  function loadDaily() {
    today = Core.dateKey();
    var s = fresh({ dateKey: today, number: Core.dayNumber(today), status: 'intro' }), rec = loadDays()[today];
    if (rec && rec.runId) {
      Object.assign(s, { runId: rec.runId, length: rec.length, tries: rec.tries, guesses: rec.guesses || [], marks: rec.marks || [],
        status: rec.status === 'done' ? 'done' : 'play', solved: !!rec.solved, word: rec.word || '', about: rec.about || '',
        startedAt: rec.startedAt || Date.now(), finishedAt: rec.finishedAt || 0, ms: rec.ms || null, saved: rec.saved || null });
    }
    states.daily = s;
    if (mode === 'daily') show('daily');
  }

  /* ---------- drawing ---------- */

  function buildKeys() {
    ui.keys.textContent = '';
    KEY_ROWS.forEach(function (row) {
      var r = document.createElement('div');
      r.className = 'cw-keyrow';
      row.split('').forEach(function (ch) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'cw-key cw-mono'; b.setAttribute('data-key', ch);
        b.innerHTML = '<span>' + ch.toUpperCase() + '</span><i aria-hidden="true"></i>';
        b.addEventListener('click', function () { type(ch); });
        r.appendChild(b);
      });
      ui.keys.appendChild(r);
    });
    var act = document.createElement('div');
    act.className = 'cw-keyrow cw-actions';
    act.innerHTML = '<button type="button" class="cw-key cw-key-wide" data-del>Delete</button>' +
                    '<button type="button" class="cw-key cw-key-wide cw-key-go" data-go>Guess</button>';
    act.querySelector('[data-del]').addEventListener('click', del);
    act.querySelector('[data-go]').addEventListener('click', submitGuess);
    ui.keys.appendChild(act);
  }

  function renderRows() {
    var s = cur;
    ui.rows.textContent = '';
    if (!s || !s.length) return;
    ui.rows.style.setProperty('--cw-len', s.length);
    var shown = s.status === 'done' ? s.guesses.length : s.tries;     // once over, only the guesses made
    for (var r = 0; r < shown; r++) {
      var row = document.createElement('div'), g = s.guesses[r], mk = s.marks[r], label = [];
      var current = !g && r === s.guesses.length && s.status === 'play';
      row.className = 'cw-row' + (current ? ' is-current' : '');
      for (var i = 0; i < s.length; i++) {
        var cell = document.createElement('span'), ch = '', cls = 'cw-cell';
        if (g) { ch = g[i]; cls += ' ' + MARK_CLASS[mk[i]]; label.push(ch.toUpperCase() + ' ' + MARK_WORD[mk[i]]); }
        else if (current && s.typed[i]) { ch = s.typed[i]; cls += ' is-typed'; }
        else cls += current ? ' is-next' : ' is-empty';
        cell.className = cls;
        var c = document.createElement('span'); c.className = 'cw-ch cw-mono'; c.textContent = ch.toUpperCase(); cell.appendChild(c);
        if (g) { var m = document.createElement('span'); m.className = 'cw-mk'; m.textContent = MARK_TEXT[mk[i]]; m.setAttribute('aria-hidden', 'true'); cell.appendChild(m); }
        row.appendChild(cell);
      }
      if (g) row.setAttribute('aria-label', 'Guess ' + (r + 1) + ', ' + g.toUpperCase() + ': ' + label.join('; '));
      ui.rows.appendChild(row);
    }
  }

  function renderKeys() {
    var s = cur, known = s ? Core.letterStates(s.guesses, s.marks) : {}, playing = !!s && s.status === 'play';
    ui.keys.querySelectorAll('[data-key]').forEach(function (b) {
      var st = known[b.getAttribute('data-key')];
      b.className = 'cw-key cw-mono' + (st === undefined ? '' : ' ' + MARK_CLASS[st]);
      b.querySelector('i').textContent = st === undefined ? '' : MARK_TEXT[st];
      b.setAttribute('aria-label', b.getAttribute('data-key').toUpperCase() + (st === undefined ? '' : ', ' + MARK_WORD[st]));
      b.disabled = !playing || busy;
    });
    ui.keys.querySelectorAll('[data-del], [data-go]').forEach(function (b) { b.disabled = !playing || busy; });
  }

  function renderTop() {
    var s = cur;
    if (mode === 'daily') ui.title.textContent = 'Code Word #' + states.daily.number + ' · ' + shortDate(states.daily.dateKey);
    else ui.title.textContent = s ? 'Past word #' + s.number + ' · ' + shortDate(s.dateKey) : 'Past words';
    ui.meta.textContent = s && s.length ? s.length + ' letters · ' + s.tries + ' guesses' : (mode === 'daily' ? '4 to 7 letters' : '');
    tickClock();
  }

  function render() { renderTop(); renderRows(); renderKeys(); }

  function applyStatus() {
    var s = cur, listing = mode === 'past' && !s;
    root.setAttribute('data-mode', mode);
    root.setAttribute('data-status', listing ? 'list' : s.status);
    ui.intro.hidden = !(s && s.status === 'intro');
    ui.pastlist.hidden = !listing;
    ui.rows.hidden = listing;
    ui.keys.hidden = listing || (s && s.status === 'done');
    ui.result.hidden = !(s && s.status === 'done');
    if (s && s.status === 'play') startClock(); else { stopClock(); tickClock(); }
    if (s && s.status === 'done') showResult(); else clearInterval(countdownTimer);
  }

  /* ---------- clock ---------- */

  function elapsed() {
    var s = cur;
    if (!s || s.status === 'intro') return 0;
    if (s.status === 'done') return s.ms != null ? s.ms : (s.finishedAt || Date.now()) - s.startedAt;
    return Date.now() - s.startedAt;
  }
  function tickClock() { ui.clock.textContent = fmt(elapsed()); }
  function startClock() { stopClock(); tickClock(); clockTimer = setInterval(tickClock, 250); }
  function stopClock() { clearInterval(clockTimer); }

  /* ---------- playing ---------- */

  function playing() { return !!cur && cur.status === 'play' && !busy; }
  function type(ch) {
    if (!playing() || cur.typed.length >= cur.length) return;
    cur.typed += ch;
    say('');
    renderRows();
  }
  function del() {
    if (!playing() || !cur.typed) return;
    cur.typed = cur.typed.slice(0, -1);
    renderRows();
  }
  function nudgeRow() {
    var row = ui.rows.querySelector('.is-current');
    if (row) pop(row, 'is-nudge');
  }
  function setBusy(on) { busy = on; root.classList.toggle('is-busy', on); renderKeys(); }

  function submitGuess() {
    var s = cur;
    if (!playing()) return;
    if (s.typed.length !== s.length) { say('Use ' + s.length + ' letters.', 'warn'); nudgeRow(); return; }
    var guess = s.typed, daily = mode === 'daily';
    setBusy(true);
    var request = daily ? call('/word/guess', { runId: s.runId, guess: guess }, 8000)
                        : call('/word/practice', { dateKey: s.dateKey, guess: guess }, 8000);
    request.then(function (d) {
      s.guesses.push(guess);
      s.marks.push(d.marks);
      s.typed = '';
      if (d.solved) s.solved = true;
      if (d.ms != null) s.ms = d.ms;
      if (d.word) { s.word = d.word; s.about = d.about; }
      var row = s.guesses.length - 1;
      ui.live.textContent = guess.toUpperCase() + ': ' + d.marks.map(function (m, i) { return guess[i].toUpperCase() + ' ' + MARK_WORD[m]; }).join('; ');
      var over = daily ? d.done : (d.solved || s.guesses.length >= s.tries);
      if (over && !s.word && !daily) {
        return call('/word/reveal?date=' + s.dateKey, null, 8000).then(function (r) { s.word = r.word; s.about = r.about; }, function () {})
          .then(function () { finish(); });
      }
      if (over) return finish();
      say(row === s.tries - 2 ? 'Last guess!' : '');
      if (daily) saveDaily();
      render();
    }, function (e) {
      say(e.message, 'warn');
      if (e.data && e.data.field === 'guess') nudgeRow();
      if (e.data && e.data.word && daily) {               // already finished in another tab
        s.word = e.data.word; s.about = e.data.about; finish();
      }
    }).then(function () { setBusy(false); });
  }

  function finish() {
    var s = cur;
    s.status = 'done';
    s.finishedAt = Date.now();
    if (mode === 'daily') saveDaily();
    say('');
    applyStatus();
    render();
    var focus = ui.save.hidden ? ui.next : ui.nameInput;
    if (focus && !('ontouchstart' in window)) focus.focus({ preventScroll: true });
  }

  function showResult() {
    var s = cur, n = s.guesses.length, daily = mode === 'daily';
    ui.resultEyebrow.textContent = s.solved ? (n === 1 ? 'First try!' : 'Solved!') : 'Out of guesses';
    ui.resultWord.textContent = (s.word || '').toUpperCase();
    ui.resultDetail.textContent = s.solved
      ? n + ' of ' + s.tries + ' guesses' + (daily ? ' · ' + (s.ms != null ? fmtTenths(s.ms) : fmt(elapsed())) : '')
      : 'The word was ' + (s.word || '').toUpperCase() + '.';
    ui.resultAbout.textContent = s.about || '';
    ui.next.textContent = daily ? 'Play a past word' : 'Pick another past word';
    clearInterval(countdownTimer);
    if (daily) {
      var update = function () {
        if (Core.dateKey() !== today) { clearInterval(countdownTimer); loadDaily(); return; }
        var left = msToMidnight(), h = Math.floor(left / 3600000), m = Math.ceil((left % 3600000) / 60000);
        if (m === 60) { h++; m = 0; }
        var k = streak();
        ui.resultExtra.textContent = (k ? 'Streak: ' + k + (k === 1 ? ' day' : ' days') + ' · ' : '') +
          'Next word in ' + (h ? h + ' h ' : '') + m + ' min';
      };
      update();
      countdownTimer = setInterval(update, 20000);
    } else {
      ui.resultExtra.textContent = 'Past word #' + s.number + ' · ' + shortDate(s.dateKey);
    }
    showSave();
  }

  /* ---------- today / past words ---------- */

  function show(which) {
    mode = which;
    cur = which === 'daily' ? states.daily : states.past;
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
    call('/word/past', null, 8000).then(function (d) { pastItems = d.past || []; renderPastList(); },
      function (e) { ui.pastitems.textContent = e.message; });
  }
  function renderPastList() {
    ui.pastitems.textContent = '';
    if (!pastItems.length) {
      ui.pastitems.textContent = 'Past words appear here from the day after Code Word starts.';
      return;
    }
    pastItems.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cw-pastitem';
      b.innerHTML = '<b class="cw-mono">#' + it.number + '</b><span>' + shortDate(it.dateKey) + '</span><span>' + it.length + ' letters</span>';
      b.addEventListener('click', function () {
        states.past = fresh({ dateKey: it.dateKey, number: it.number, length: it.length, tries: Core.triesFor(it.length) });
        show('past');
      });
      ui.pastitems.appendChild(b);
    });
  }

  ui.start.addEventListener('click', function () {
    var s = states.daily;
    if (s.status !== 'intro' || ui.start.disabled) return;
    if (!api) { say('This game needs its server, which is not set up here.', 'warn'); return; }
    ui.start.disabled = true;
    ui.start.textContent = 'Starting…';
    call('/word/start', {}, 6000).then(function (d) {
      today = d.dateKey;
      Object.assign(s, { runId: d.runId, dateKey: d.dateKey, number: d.number, length: d.length, tries: d.tries,
                         status: 'play', startedAt: Date.now() });
      saveDaily();
      applyStatus();
      render();
      say('Type a ' + d.length + '-letter word and press Guess.');
    }, function (e) {
      say(e.message + ' Please try again in a moment.', 'warn');
    }).then(function () { ui.start.disabled = false; ui.start.textContent = 'Start'; });
  });

  ui.next.addEventListener('click', function () { states.past = null; show('past'); });
  ui.modes.forEach(function (b, i) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-mode');
      if (which === 'past' && mode === 'past') states.past = null;   // tapping the tab again goes back to the list
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

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (!playing()) return;
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); type(e.key.toLowerCase()); }
    else if (e.key === 'Backspace') { e.preventDefault(); del(); }
    else if (e.key === 'Enter' && tag !== 'button') { e.preventDefault(); submitGuess(); }
  });

  /* ---------- saving today's result ---------- */

  function setNote(text, good) {
    ui.saveNote.textContent = text || '';
    ui.saveNote.hidden = !text;
    ui.saveNote.classList.toggle('is-good', !!good);
  }
  function showSave() {
    var s = cur, daily = mode === 'daily' && s.status === 'done' && s.solved && !!api;
    var canSave = daily && !!s.runId && s.ms != null && !s.saved;
    ui.save.hidden = !canSave;
    if (canSave && !ui.nameInput.value) ui.nameInput.value = load(NAME_KEY, '') || load('bitflip.name', '') || '';
    if (!daily) setNote('');
    else if (s.saved) setNote('Saved as ' + s.saved.name + ' · #' + s.saved.rank + ' today', true);
    else if (s.problem) setNote('This result can’t be saved. ' + s.problem);
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
    var n = cleanName(ui.nameInput.value), seq = ++checkSeq, local = n ? localNameProblem(n) : '';
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
    call('/word/submit', { runId: s.runId, name: n }, 10000).then(function (d) {
      ui.saveBtn.disabled = false;
      ui.saveMsg.textContent = '';
      store(NAME_KEY, d.name);
      var mine = load(MINE_KEY, []);
      if (!Array.isArray(mine)) mine = [];
      mine.push(d.id);
      store(MINE_KEY, mine.slice(-100));
      s.saved = { name: d.name, rank: d.rankToday };
      saveDaily();
      showSave();
      showBoards(d.boards, 'today', d.id);
    }, function (err) {
      ui.saveBtn.disabled = false;
      ui.saveMsg.textContent = err.message;
      if (err.data && err.data.field === 'name') { ui.nameInput.focus(); return; }
      if (err.data && err.data.error) { s.problem = err.message; s.runId = null; saveDaily(); showSave(); }
    });
  });

  /* ---------- leaderboard ---------- */

  var boards = null, tab = 'today', flash = null;
  function showBoards(data, which, highlightId) { boards = data; if (which) tab = which; flash = highlightId || null; renderBoard(); }
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
      var li = document.createElement('li'), me = tab !== 'days' && Array.isArray(mine) && mine.indexOf(r.id) >= 0;
      li.className = 'cw-brow' + (me ? ' is-me' : '') + (r.id === flash && tab === 'today' ? ' is-new' : '');
      var rank = document.createElement('span'); rank.className = 'cw-rank'; rank.textContent = i + 1;
      var nm = document.createElement('span'); nm.className = 'cw-brow-name'; nm.textContent = r.name;
      if (me) { var you = document.createElement('span'); you.className = 'cw-you'; you.textContent = 'you'; nm.appendChild(you); }
      var val = document.createElement('span'); val.className = 'cw-brow-score';
      val.textContent = tab === 'days' ? r.days + (r.days === 1 ? ' day' : ' days')
        : r.guesses + (r.guesses === 1 ? ' guess' : ' guesses') + ' · ' + fmtTenths(r.ms);
      li.appendChild(rank); li.appendChild(nm); li.appendChild(val);
      listEl.appendChild(li);
    });
    empty.hidden = rows.length > 0;
    empty.textContent = !boards ? 'The leaderboard could not be loaded right now.'
      : tab === 'today' ? 'Nobody has solved today’s word yet. Be the first!'
      : tab === 'yesterday' ? 'Nobody saved a result yesterday.' : 'No results yet. Be the first!';
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
    call('/word/leaderboard', null, 8000).then(function (d) { showBoards(d.boards); }, function () { renderBoard(); });
  }

  buildKeys();
  loadDaily();
}());
