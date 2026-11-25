/* Shared by the daily games (Logic Lights, Crack the Cipher, and future ones): server calls, this browser's saved
   results and streak, the name form under a result, and the Today / Yesterday / Most days leaderboard.
   Markup: layouts/partials/games/board.html and save-form.html. Styles: assets/games/shared.css. */
(function () {
  'use strict';

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: not remembered */ }
  }

  // Server call. The body goes as plain text, so the browser skips the extra CORS preflight request.
  function call(api, path, body, ms) {
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
  function shiftDay(key, delta) {
    var p = key.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta)).toISOString().slice(0, 10);
  }
  // "4 h 12 min" until the next Eastern midnight.
  function untilMidnight(timeZone) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date());
    var get = function (t) { return Number(parts.filter(function (p) { return p.type === t; })[0].value); };
    var left = 86400000 - ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
    var h = Math.floor(left / 3600000), m = Math.ceil((left % 3600000) / 60000);
    if (m === 60) { h++; m = 0; }
    return (h ? h + ' h ' : '') + m + ' min';
  }

  // This browser's result for each day, under one storage key.
  function days(storageKey) {
    function all() { var d = load(storageKey, {}); return d && typeof d === 'object' ? d : {}; }
    return {
      get: function (k) { return all()[k] || null; },
      put: function (k, rec) {
        var d = all(); d[k] = rec;
        var keys = Object.keys(d).sort();
        while (keys.length > 120) delete d[keys.shift()];
        store(storageKey, d);
      },
      streak: function (today) {
        var d = all(), key = today, n = 0;
        if (!(d[key] && d[key].solved)) key = shiftDay(key, -1);
        while (d[key] && d[key].solved) { n++; key = shiftDay(key, -1); }
        return n;
      }
    };
  }

  /* Name form (save-form.html) under a daily result.
     o = { api, root, submit(name) -> Promise<{ name, id, rankToday, boards }>, onSaved(data), onGameError(err) } */
  function nameForm(o) {
    var form = o.root.querySelector('[data-save]'), input = form.querySelector('[data-name]'), button = form.querySelector('[data-save-btn]');
    var msg = form.querySelector('[data-save-msg]'), note = o.root.querySelector('[data-save-note]');
    var OK = /./;
    try { OK = new RegExp("^[\\p{L}\\p{N}][\\p{L}\\p{M}\\p{N} '_-]*$", 'u'); } catch (e) { /* old browser: the server checks */ }
    function clean(raw) { return raw.normalize('NFKC').replace(/\s+/g, ' ').trim(); }
    function problem(n) {
      var len = Array.from(n).length;
      if (len < 2) return 'Use at least 2 characters.';
      if (len > 16) return 'Use at most 16 characters.';
      if (!OK.test(n)) return 'Use letters, numbers, spaces, - or _ only.';
      return '';
    }
    var timer = 0, seq = 0;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var n = clean(input.value), mine = ++seq, local = n ? problem(n) : '';
      msg.textContent = local && (n.length > 1 || local.indexOf('letters') >= 0) ? local : '';
      if (!n || local) return;
      timer = setTimeout(function () {
        call(o.api, '/check-name', { name: n }, 5000).then(function (d) { if (mine === seq) msg.textContent = d.ok ? '' : d.error; }, function () {});
      }, 350);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var n = clean(input.value), local = problem(n);
      clearTimeout(timer); seq++;               // a late live check must not overwrite the server's answer
      if (local) { msg.textContent = local; input.focus(); return; }
      button.disabled = true;
      msg.textContent = 'Saving…';
      o.submit(n).then(function (d) {
        button.disabled = false;
        msg.textContent = '';
        store('games.name', d.name);
        o.onSaved(d);
      }, function (err) {
        button.disabled = false;
        msg.textContent = err.message;
        if (err.data && err.data.field === 'name') { input.focus(); return; }
        if (err.data && err.data.error && o.onGameError) o.onGameError(err);
      });
    });
    return {
      // show: 'form' | 'saved' | 'none'; text for the note under it
      set: function (show, text, good) {
        form.hidden = show !== 'form';
        if (show === 'form' && !input.value) input.value = load('games.name', '') || load('bitflip.name', '') || '';
        note.textContent = text || '';
        note.hidden = !text;
        note.classList.toggle('is-good', !!good);
      },
      focus: function () { input.focus({ preventScroll: true }); }
    };
  }

  /* Leaderboard (board.html). o = { api, el, path, mineKey, value(row) -> text, empty: { today, yesterday, days } } */
  function board(o) {
    var el = o.el, data = null, tab = 'today', flash = null;
    if (!el || !o.api) return { show: function () {}, mine: function () {} };
    el.hidden = false;
    var tabs = Array.prototype.slice.call(el.querySelectorAll('[data-board-tab]'));
    function render() {
      tabs.forEach(function (b) {
        var on = b.getAttribute('data-board-tab') === tab;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      var list = el.querySelector('[data-board-list]'), empty = el.querySelector('[data-board-empty]');
      var rows = (data && data[tab]) || [], mine = load(o.mineKey, []);
      list.textContent = '';
      rows.forEach(function (r, i) {
        var li = document.createElement('li'), me = tab !== 'days' && Array.isArray(mine) && mine.indexOf(r.id) >= 0;
        li.className = 'g-brow' + (me ? ' is-me' : '') + (r.id === flash && tab === 'today' ? ' is-new' : '');
        var rank = document.createElement('span'); rank.className = 'g-rank'; rank.textContent = i + 1;
        var nm = document.createElement('span'); nm.className = 'g-brow-name'; nm.textContent = r.name;
        if (me) { var you = document.createElement('span'); you.className = 'g-you'; you.textContent = 'you'; nm.appendChild(you); }
        var val = document.createElement('span'); val.className = 'g-brow-score';
        val.textContent = tab === 'days' ? r.days + (r.days === 1 ? ' day' : ' days') : o.value(r);
        li.appendChild(rank); li.appendChild(nm); li.appendChild(val);
        list.appendChild(li);
      });
      empty.hidden = rows.length > 0;
      empty.textContent = !data ? 'The leaderboard could not be loaded right now.' : o.empty[tab];
    }
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { tab = b.getAttribute('data-board-tab'); flash = null; render(); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var next = tabs[(i + d + tabs.length) % tabs.length];
        next.click(); next.focus();
      });
    });
    call(o.api, o.path, null, 8000).then(function (d) { data = d.boards; render(); }, function () { render(); });
    return {
      show: function (boards, which, id) { data = boards; tab = which || tab; flash = id || null; render(); },
      mine: function (id) { var m = load(o.mineKey, []); if (!Array.isArray(m)) m = []; m.push(id); store(o.mineKey, m.slice(-100)); }
    };
  }

  window.GamesShared = { load: load, store: store, call: call, fmt: fmt, fmtTenths: fmtTenths, shortDate: shortDate,
                         shiftDay: shiftDay, untilMidnight: untilMidnight, days: days, nameForm: nameForm, board: board };
}());
