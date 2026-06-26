/* ============================================================
   vault.js — единый вход и расшифровка архива в браузере.
   Совместимо с build.mjs (PBKDF2-SHA256 -> AES-256-GCM, конверт).

   Логин+пароль -> KEK (PBKDF2). KEK разворачивает CEK доступных
   сценариев; CEK расшифровывает контент. Мастер-логин открывает все
   сценарии и может переходить между ними на месте; партнёр — только
   свой. На сервере лежит только шифртекст (window.__VAULT__).
   ============================================================ */
(function () {
  'use strict';
  var V = window.__VAULT__;
  if (!V) return;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var unlocked = {};   // id -> CryptoKey (CEK)
  var hasHub = false;  // мастер (доступна витрина)

  function unb64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  async function kdf(passphrase, salt) {
    var km = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: V.iter, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  function rawKey(bytes) { return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']); }
  async function gcmDec(key, obj) {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.ct)));
  }

  /* --- попытка входа: вернёт landing id или null --- */
  async function tryLogin(login, password) {
    var pass = login.toLowerCase().trim() + '\n' + password;
    for (var r = 0; r < V.rcp.length; r++) {
      var entry = V.rcp[r];
      var kek;
      try { kek = await kdf(pass, unb64(entry.salt)); } catch (e) { continue; }
      var got = {}, landing = null, ok = false;
      for (var id in entry.w) {
        try {
          var wrap = JSON.parse(dec.decode(await gcmDec(kek, entry.w[id])));
          got[id] = await rawKey(unb64(wrap.k));
          if (wrap.l) landing = id;
          ok = true;
        } catch (e) { /* не этот получатель */ }
      }
      if (ok) {
        unlocked = got;
        hasHub = !!got.hub;
        return landing || Object.keys(got)[0];
      }
    }
    return null;
  }

  /* --- расшифровать и показать сценарий на месте --- */
  async function reveal(id) {
    if (!unlocked[id] || !V.scn[id]) return;
    var obj = JSON.parse(dec.decode(await gcmDec(unlocked[id], V.scn[id])));
    var app = document.getElementById('app');
    app.innerHTML = obj.html;
    app.hidden = false;
    var gate = document.getElementById('gate');
    if (gate) gate.style.display = 'none';
    injectControls(id);
    if (window.RAnim) window.RAnim.run(app);
    window.scrollTo(0, 0);
  }

  /* --- управляющие кнопки (Выйти / ← Витрина) --- */
  function injectControls(id) {
    var app = document.getElementById('app');
    var row = app.querySelector('.brandbar .row');
    var host;
    if (row) {
      host = row.querySelector('.links') || row;
    } else {
      host = document.createElement('div');
      host.className = 'gate-controls';
      app.appendChild(host);
    }
    // чистим прежние служебные кнопки
    host.querySelectorAll('[data-vault-ctl]').forEach(function (n) { n.remove(); });
    if (hasHub && id !== 'hub') {
      var back = document.createElement('button');
      back.type = 'button'; back.className = 'gate-logout'; back.dataset.vaultCtl = '1'; back.dataset.back = '1';
      back.textContent = '← Витрина';
      host.appendChild(back);
    }
    var out = document.createElement('button');
    out.type = 'button'; out.className = 'gate-logout'; out.dataset.vaultCtl = '1'; out.dataset.logout = '1';
    out.textContent = 'Выйти';
    host.appendChild(out);
  }

  /* --- делегирование кликов внутри контента --- */
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-logout],[data-back],[data-scn]');
    if (!t) return;
    if (t.hasAttribute('data-logout')) { ev.preventDefault(); location.reload(); return; }
    if (t.hasAttribute('data-back')) { ev.preventDefault(); reveal('hub'); return; }
    if (t.hasAttribute('data-scn')) {
      var id = t.getAttribute('data-scn');
      if (unlocked[id]) { ev.preventDefault(); reveal(id); }
    }
  });

  /* --- форма входа --- */
  function init() {
    var form = document.getElementById('gateform');
    var login = document.getElementById('gate-login');
    var pass = document.getElementById('gate-pass');
    var err = document.getElementById('gate-err');
    var btn = document.getElementById('gate-btn');
    if (!form) return;
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!login.value || !pass.value) return;
      err.hidden = true; btn.disabled = true; btn.textContent = 'Проверяю…';
      var landing = null;
      try { landing = await tryLogin(login.value, pass.value); } catch (e) { landing = null; }
      if (landing) {
        await reveal(landing);
      } else {
        err.hidden = false; btn.disabled = false; btn.textContent = 'Войти';
        pass.value = ''; pass.focus();
        form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
