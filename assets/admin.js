/* ============================================================
   admin.js — статичная админ-панель (билдер) под мастер-логином.
   Загружает текущий index.html, мастер-паролем расшифровывает cfg
   (источник правды по пользователям), даёт CRUD пользователей,
   паролей, ролей, доступов и сроков, затем пересобирает
   зашифрованный манифест и отдаёт новый index.html на скачивание.
   Всё в браузере; на сервер ничего не уходит.
   ============================================================ */
(function () {
  'use strict';
  var enc = new TextEncoder(), dec = new TextDecoder();
  var ITER = 200000;
  var b64 = function (b) { var u = new Uint8Array(b), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  var unb64 = function (s) { var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  var rand = function (n) { return crypto.getRandomValues(new Uint8Array(n)); };
  function genPassword() { var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', x = rand(12), o = ''; for (var i = 0; i < 12; i++) { if (i && i % 4 === 0) o += '-'; o += abc[x[i] % abc.length]; } return o; }
  function passphrase(login, pw) { return String(login).toLowerCase().trim() + '\n' + pw; }
  async function pbkdf2(pass, salt, usage) {
    var km = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ITER, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, usage);
  }
  var rawKey = function (b, usage) { return crypto.subtle.importKey('raw', b, { name: 'AES-GCM' }, false, usage); };
  async function gEnc(key, u8) { var iv = rand(12); var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, u8); return { iv: b64(iv), ct: b64(ct) }; }
  async function gDec(key, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct))); }

  /* ---- состояние ---- */
  var S = { text: '', manifest: null, scenarios: {}, users: [], ceks: {} /* id->b64 */ };

  /* ---- загрузка текущего index.html ---- */
  function extractManifest(text) {
    var m = text.match(/window\.__VAULT__=({[\s\S]*?});<\/script>/);
    return m ? JSON.parse(m[1]) : null;
  }
  async function fetchSite() {
    try { var r = await fetch('../index.html', { cache: 'no-store' }); if (!r.ok) return null; var t = await r.text(); return { text: t, manifest: extractManifest(t) }; }
    catch (e) { return null; }
  }

  /* ---- вход мастер-логином: расшифровать cfg + достать CEK ---- */
  async function adminLogin(login, password) {
    var pass = passphrase(login, password);
    var V = S.manifest;
    for (var i = 0; i < V.rcp.length; i++) {
      var e = V.rcp[i];
      if (!e.w || !e.w.__cfg) continue;
      try {
        var kek = await pbkdf2(pass, unb64(e.salt), ['decrypt']);
        var wrap = JSON.parse(dec.decode(await gDec(kek, e.w.__cfg)));
        var ckey = await rawKey(unb64(wrap.k), ['decrypt']);
        var cfg = JSON.parse(dec.decode(await gDec(ckey, V.cfg)));
        // достаём CEK всех доступных сценариев из этой же записи
        var ceks = {};
        for (var id in e.w) {
          if (id.indexOf('__') === 0) continue;
          try { var w2 = JSON.parse(dec.decode(await gDec(kek, e.w[id]))); ceks[id] = w2.k; } catch (x) { }
        }
        return { cfg: cfg, ceks: ceks };
      } catch (x) { /* не админ */ }
    }
    return null;
  }

  /* ---- пересборка манифеста из state.users ---- */
  async function rebuild() {
    var V = S.manifest;
    var CONFIG_KEY = rand(32);
    var cfgKey = await rawKey(CONFIG_KEY, ['encrypt']);
    var cfgBlob = await gEnc(cfgKey, enc.encode(JSON.stringify({ scenarios: S.scenarios, users: S.users })));
    var rcp = [];
    for (var u = 0; u < S.users.length; u++) {
      var user = S.users[u];
      var exp = user.expires ? (Date.parse(user.expires) || null) : null;
      var pws = (user.passwords && user.passwords.length) ? user.passwords : [genPassword()];
      for (var p = 0; p < pws.length; p++) {
        var salt = rand(16);
        var kek = await pbkdf2(passphrase(user.login, pws[p]), salt, ['encrypt']);
        var w = {};
        for (var s = 0; s < user.scenarios.length; s++) {
          var id = user.scenarios[s];
          if (!S.ceks[id]) continue;
          w[id] = await gEnc(kek, enc.encode(JSON.stringify({ k: S.ceks[id], l: id === user.landing, exp: exp })));
        }
        if (user.role === 'admin') w.__cfg = await gEnc(kek, enc.encode(JSON.stringify({ k: b64(CONFIG_KEY) })));
        rcp.push({ salt: b64(salt), w: w });
      }
    }
    var manifest = { iter: ITER, scn: V.scn, cfg: cfgBlob, rcp: rcp };
    return JSON.stringify(manifest);
  }

  function validate() {
    var errs = [];
    var admins = 0;
    var logins = {};
    S.users.forEach(function (u, i) {
      var who = u.login || ('#' + (i + 1));
      if (!u.login || !u.login.trim()) errs.push('Пользователь #' + (i + 1) + ': пустой логин');
      else { var lk = u.login.toLowerCase().trim(); if (logins[lk]) errs.push('Дублирующийся логин: ' + u.login); logins[lk] = 1; }
      if (!u.passwords || !u.passwords.filter(Boolean).length) errs.push(who + ': нет паролей');
      if (!u.scenarios || !u.scenarios.length) errs.push(who + ': не выбран доступ к исследованиям');
      else if (u.scenarios.indexOf(u.landing) < 0) errs.push(who + ': стартовая страница вне доступа');
      if (u.role === 'admin') admins++;
    });
    if (!admins) errs.push('Нужен хотя бы один пользователь с ролью admin (иначе вход в админку будет потерян)');
    return errs;
  }

  /* ============ UI ============ */
  var el = function (tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  function render() {
    var app = document.getElementById('adminapp');
    app.innerHTML = '';
    var wrap = el('div', 'wrap');

    var head = el('div', 'adm-head');
    var h = el('h2', null, 'Пользователи и доступы');
    head.appendChild(h);
    var addBtn = el('button', 'btn-turq', '+ Пользователь'); addBtn.type = 'button';
    addBtn.onclick = function () {
      var firstScn = Object.keys(S.scenarios)[0];
      S.users.push({ login: '', role: 'partner', scenarios: firstScn ? [firstScn] : [], landing: firstScn || '', passwords: [genPassword()], expires: '', note: '' });
      render();
    };
    head.appendChild(addBtn);
    var out = el('button', 'gate-logout', 'Выйти'); out.type = 'button';
    out.onclick = function () { location.reload(); };
    head.appendChild(out);
    wrap.appendChild(head);

    S.users.forEach(function (user, i) { wrap.appendChild(userCard(user, i)); });

    // action bar
    var bar = el('div', 'adm-bar');
    var save = el('button', 'btn-turq', 'Сохранить и скачать index.html'); save.type = 'button';
    save.onclick = onSave;
    var status = el('div', 'adm-status'); status.id = 'adm-status';
    bar.appendChild(save); bar.appendChild(status);
    wrap.appendChild(bar);

    app.appendChild(wrap);
  }

  function userCard(user, i) {
    var card = el('div', 'adm-user');
    // строка 1: логин + роль + удалить
    var row = el('div', 'adm-row');
    var login = el('input', 'adm-in'); login.placeholder = 'Логин'; login.value = user.login || '';
    login.oninput = function () { user.login = login.value; };
    var role = el('select', 'adm-in adm-sel');
    [['partner', 'партнёр'], ['admin', 'админ']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if (user.role === o[0]) op.selected = true; role.appendChild(op); });
    role.onchange = function () { user.role = role.value; };
    var del = el('button', 'adm-del', 'Удалить'); del.type = 'button';
    del.onclick = function () { S.users.splice(i, 1); render(); };
    row.appendChild(login); row.appendChild(role); row.appendChild(del);
    card.appendChild(row);

    // доступы (сценарии)
    var scn = el('div', 'adm-field');
    scn.appendChild(el('label', 'adm-lbl', 'Доступ к исследованиям'));
    var chips = el('div', 'adm-chips');
    Object.keys(S.scenarios).forEach(function (id) {
      var meta = S.scenarios[id];
      var lab = el('label', 'adm-chip');
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = user.scenarios.indexOf(id) >= 0;
      cb.onchange = function () {
        if (cb.checked) { if (user.scenarios.indexOf(id) < 0) user.scenarios.push(id); }
        else { user.scenarios = user.scenarios.filter(function (x) { return x !== id; }); }
        if (user.scenarios.indexOf(user.landing) < 0) user.landing = user.scenarios[0] || '';
        render();
      };
      lab.appendChild(cb); lab.appendChild(el('span', null, (meta.title || id)));
      chips.appendChild(lab);
    });
    scn.appendChild(chips);
    card.appendChild(scn);

    // landing
    var land = el('div', 'adm-field');
    land.appendChild(el('label', 'adm-lbl', 'Открывать при входе'));
    var sel = el('select', 'adm-in adm-sel');
    user.scenarios.forEach(function (id) { var op = el('option', null, S.scenarios[id] ? S.scenarios[id].title : id); op.value = id; if (user.landing === id) op.selected = true; sel.appendChild(op); });
    sel.onchange = function () { user.landing = sel.value; };
    land.appendChild(sel);
    card.appendChild(land);

    // пароли
    var pw = el('div', 'adm-field');
    pw.appendChild(el('label', 'adm-lbl', 'Пароли'));
    (user.passwords || []).forEach(function (p, j) {
      var prow = el('div', 'adm-pw');
      var inp = el('input', 'adm-in'); inp.value = p; inp.spellcheck = false;
      inp.oninput = function () { user.passwords[j] = inp.value; };
      var gen = el('button', 'adm-mini', '↻'); gen.type = 'button'; gen.title = 'Сгенерировать';
      gen.onclick = function () { user.passwords[j] = genPassword(); render(); };
      var rm = el('button', 'adm-mini', '✕'); rm.type = 'button'; rm.title = 'Удалить пароль';
      rm.onclick = function () { user.passwords.splice(j, 1); render(); };
      prow.appendChild(inp); prow.appendChild(gen); prow.appendChild(rm);
      pw.appendChild(prow);
    });
    var addpw = el('button', 'adm-mini adm-addpw', '+ пароль'); addpw.type = 'button';
    addpw.onclick = function () { (user.passwords = user.passwords || []).push(genPassword()); render(); };
    pw.appendChild(addpw);
    card.appendChild(pw);

    // срок
    var exp = el('div', 'adm-field');
    exp.appendChild(el('label', 'adm-lbl', 'Доступ до (необязательно)'));
    var date = el('input', 'adm-in'); date.type = 'date'; date.value = user.expires || '';
    date.onchange = function () { user.expires = date.value; };
    exp.appendChild(date);
    card.appendChild(exp);

    return card;
  }

  async function onSave() {
    var status = document.getElementById('adm-status');
    var errs = validate();
    if (errs.length) { status.className = 'adm-status err'; status.textContent = '⚠ ' + errs.join('; '); return; }
    status.className = 'adm-status'; status.textContent = 'Собираю…';
    try {
      var json = await rebuild();
      var newText = S.text.replace(/window\.__VAULT__=({[\s\S]*?});<\/script>/, function () { return 'window.__VAULT__=' + json + ';</script>'; });
      var blob = new Blob([newText], { type: 'text/html' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'index.html';
      document.body.appendChild(a); a.click(); a.remove();
      var summary = S.users.map(function (u) { return u.login + ' [' + u.role + '] ' + (u.passwords || []).join(', ') + ' → ' + u.scenarios.join(', ') + (u.expires ? ' до ' + u.expires : ''); }).join('\n');
      status.className = 'adm-status ok';
      status.textContent = '✓ index.html собран и скачан. Загрузите его в корень репозитория (замените существующий) и закоммитьте.';
      var pre = document.getElementById('adm-summary'); if (!pre) { pre = el('pre'); pre.id = 'adm-summary'; pre.className = 'adm-summary'; status.parentNode.appendChild(pre); }
      pre.textContent = summary;
    } catch (e) { status.className = 'adm-status err'; status.textContent = 'Ошибка сборки: ' + e.message; }
  }

  /* ---- gate ---- */
  function initGate() {
    var form = document.getElementById('aform');
    var login = document.getElementById('a-login'), pass = document.getElementById('a-pass');
    var err = document.getElementById('a-err'), btn = document.getElementById('a-btn');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!login.value || !pass.value) return;
      err.hidden = true; btn.disabled = true; btn.textContent = 'Проверяю…';
      if (!S.manifest) {
        var site = await fetchSite();
        if (!site || !site.manifest) { err.textContent = 'Не удалось загрузить index.html'; err.hidden = false; btn.disabled = false; btn.textContent = 'Войти'; return; }
        S.text = site.text; S.manifest = site.manifest;
      }
      var r = null;
      try { r = await adminLogin(login.value, pass.value); } catch (e) { r = null; }
      if (r) {
        S.scenarios = r.cfg.scenarios || {};
        S.users = (r.cfg.users || []).map(function (u) { return { login: u.login, role: u.role || 'partner', scenarios: (u.scenarios || []).slice(), landing: u.landing || (u.scenarios || [])[0] || '', passwords: (u.passwords || []).slice(), expires: u.expires || '', note: u.note || '' }; });
        S.ceks = r.ceks;
        document.getElementById('agate').style.display = 'none';
        var app = document.getElementById('adminapp'); app.hidden = false;
        render();
      } else {
        err.textContent = 'Неверный мастер-логин или у пользователя нет роли admin';
        err.hidden = false; btn.disabled = false; btn.textContent = 'Войти';
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initGate);
  else initGate();
})();
