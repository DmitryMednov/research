#!/usr/bin/env node
/* ============================================================
   build.mjs — сборка единой страницы-входа с шифрованным архивом.

   Модель: один экран логина. Контент сценариев зашифрован «конвертом»
   (envelope): у сценария свой ключ CEK (им шифруется контент), CEK
   заворачивается ключом каждого пароля, кому открыт доступ
   (ключ = PBKDF2 от «логин\\nпароль»). Мастер-логин (роль admin)
   открывает всё; партнёр — только своё.

   Источник правды по ПОЛЬЗОВАТЕЛЯМ — зашифрованный блок cfg внутри
   index.html (доступен только админам). Им управляет /admin/.
   Источник правды по КОНТЕНТУ — _src/*.html. Эта сборка их объединяет:
   при наличии cfg в текущем index.html пользователи берутся оттуда
   (правки админки переживают пересборку контента).

   node build.mjs            # собрать index.html
   node build.mjs decrypt    # восстановить _src/* (мастер-логином)
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const subtle = globalThis.crypto.subtle;
const ITER = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---- сценарии: id -> исходник ---- */
const SCENARIOS = {
  hub: { src: '_src/hub.html',          kicker: 'Витрина',      kind: 'hub' },
  r1:  { src: '_src/muzh-na-chas.html', kicker: 'Исследование', kind: 'research' },
  r2:  { src: '_src/samui.html',        kicker: 'Исследование', kind: 'research' },
};

/* ---- пользователи по умолчанию (bootstrap, если нет cfg) ---- */
const BOOTSTRAP_USERS = [
  { login: 'admin',  role: 'admin',   scenarios: ['hub', 'r1', 'r2'], landing: 'hub', expires: null },
  { login: 'cyprus', role: 'partner', scenarios: ['r1'],              landing: 'r1',  expires: null },
  { login: 'samui',  role: 'partner', scenarios: ['r2'],              landing: 'r2',  expires: null },
];

/* ---- утилиты ---- */
const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
function genPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', x = rand(12);
  let o = ''; for (let i = 0; i < 12; i++) { if (i && i % 4 === 0) o += '-'; o += abc[x[i] % abc.length]; } return o;
}
async function pbkdf2(pass, salt) {
  const km = await subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const rawKey = (b) => subtle.importKey('raw', b, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
async function gEnc(key, u8) { const iv = rand(12); const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, u8); return { iv: b64(iv), ct: b64(ct) }; }
async function gDec(key, o) { return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct))); }
const passphrase = (login, pw) => `${String(login).toLowerCase().trim()}\n${pw}`;

/* ---- secrets (bootstrap-пароли) ---- */
function loadSecrets() {
  const p = path.join(ROOT, '_src/secrets.json');
  let s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  let changed = false;
  for (const u of BOOTSTRAP_USERS) {
    if (!s[u.login]) { s[u.login] = [genPassword()]; changed = true; }
    else if (typeof s[u.login] === 'string') { s[u.login] = [s[u.login]]; changed = true; } // нормализация в массив
  }
  if (changed) { fs.mkdirSync(path.join(ROOT, '_src'), { recursive: true }); fs.writeFileSync(p, JSON.stringify(s, null, 2)); console.log('Пароли -> _src/secrets.json (в git не попадает)'); }
  return s;
}

/* ---- разбор исходника ---- */
function parseBody(html) {
  return (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1].replace(/<script[\s\S]*?<\/script>/gi, '').trim();
}
function parseTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return h1[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  return t ? t[1].trim() : '';
}

/* ---- читаем текущий cfg (пользователи) из index.html ---- */
async function loadExistingUsers(secrets) {
  const file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(/window\.__VAULT__=({[\s\S]*?});<\/script>/);
  if (!m) return null;
  let vault; try { vault = JSON.parse(m[1]); } catch { return null; }
  if (!vault.cfg || !Array.isArray(vault.rcp)) return null; // старый формат -> bootstrap
  // пытаемся расшифровать cfg любым admin-паролем из secrets
  for (const login of Object.keys(secrets)) {
    for (const pw of secrets[login]) {
      for (const e of vault.rcp) {
        if (!e.w || !e.w.__cfg) continue;
        try {
          const kek = await pbkdf2(passphrase(login, pw), unb64(e.salt));
          const wrap = JSON.parse(dec.decode(await gDec(kek, e.w.__cfg)));
          const cek = await rawKey(unb64(wrap.k));
          const cfg = JSON.parse(dec.decode(await gDec(cek, vault.cfg)));
          if (cfg && Array.isArray(cfg.users)) return cfg.users;
        } catch { /* не тот ключ */ }
      }
    }
  }
  throw new Error('index.html содержит cfg, но его не удалось расшифровать паролями из _src/secrets.json.\n' +
    'Укажите актуальный admin-логин/пароль в _src/secrets.json (иначе пользователи будут потеряны).');
}

/* ---- пользователи -> пароли (из secrets для bootstrap) ---- */
function attachBootstrapPasswords(users, secrets) {
  return users.map(u => ({ ...u, passwords: (secrets[u.login] || [genPassword()]).slice() }));
}

/* ---- шаблон страницы-входа ---- */
function shell(manifestJson) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Research</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<div id="app" hidden></div>

<div id="gate" class="gatewrap">
  <form id="gateform" class="gatecard" autocomplete="off">
    <div class="gate-logo" aria-label="Mednov">
      <svg viewBox="0 0 150.34 98.048" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M19.246 0H0V98.048H19.246V40.0158C24.5963 42.624 30.496 43.2228 35.4998 43.2228H43.6043V98.048H62.8503V43.2228H66.1564C72.2529 43.2228 77.8025 45.7263 81.8317 49.7593C85.861 53.7922 88.3623 59.3471 88.3623 65.4489V98.048H108.101V65.4489C108.101 53.8935 103.385 43.3952 95.7877 35.7906C88.19 28.1861 77.7015 23.4657 66.1564 23.4657H35.469C31.3423 23.4657 19.246 19.9774 19.246 6.85762V0Z" fill="#2CB0A8"/><path d="M136.251 97.8169C144.032 97.8169 150.34 91.5033 150.34 83.715C150.34 75.9268 144.032 69.6131 136.251 69.6131C128.47 69.6131 122.162 75.9268 122.162 83.715C122.162 91.5033 128.47 97.8169 136.251 97.8169Z" fill="#2CB0A8"/></svg>
    </div>
    <div class="gate-fields">
      <input id="gate-login" type="text" placeholder="Логин" aria-label="Логин" autocapitalize="off" autocorrect="off" spellcheck="false">
      <input id="gate-pass" type="password" placeholder="Пароль" aria-label="Пароль">
      <button id="gate-btn" type="submit">Войти</button>
    </div>
    <div id="gate-err" class="gate-err" role="alert" hidden>Неверный логин или пароль</div>
  </form>
</div>

<script>window.__VAULT__=${manifestJson};</script>
<script src="assets/bg.js" defer></script>
<script src="assets/anim.js" defer></script>
<script src="assets/vault.js" defer></script>
</body>
</html>
`;
}

/* ---- собрать манифест из (сценарии, пользователи) ---- */
async function buildManifest(users) {
  // 1) шифруем контент сценариев
  const scn = {}, ceks = {}, meta = {};
  for (const [id, cfg] of Object.entries(SCENARIOS)) {
    const file = path.join(ROOT, cfg.src);
    if (!fs.existsSync(file)) { console.warn('нет исходника:', cfg.src); continue; }
    const html = fs.readFileSync(file, 'utf8');
    const cek = rand(32); ceks[id] = cek;
    scn[id] = await gEnc(await rawKey(cek), enc.encode(JSON.stringify({ kicker: cfg.kicker, html: parseBody(html) })));
    meta[id] = { title: parseTitle(html) || id, kicker: cfg.kicker, kind: cfg.kind };
  }
  // 2) cfg-блок (источник правды по пользователям) + CONFIG_KEY
  const CONFIG_KEY = rand(32);
  const cfgBlob = await gEnc(await rawKey(CONFIG_KEY), enc.encode(JSON.stringify({ scenarios: meta, users })));
  // 3) rcp: на каждый пароль каждого пользователя — обёртки CEK (+ __cfg для админов)
  const rcp = [];
  for (const u of users) {
    const exp = u.expires ? Date.parse(u.expires) || null : null;
    for (const pw of (u.passwords && u.passwords.length ? u.passwords : [genPassword()])) {
      const salt = rand(16);
      const kek = await pbkdf2(passphrase(u.login, pw), salt);
      const w = {};
      for (const id of u.scenarios) {
        if (!ceks[id]) continue;
        w[id] = await gEnc(kek, enc.encode(JSON.stringify({ k: b64(ceks[id]), l: id === u.landing, exp })));
      }
      if (u.role === 'admin') w.__cfg = await gEnc(kek, enc.encode(JSON.stringify({ k: b64(CONFIG_KEY) })));
      rcp.push({ salt: b64(salt), w });
    }
  }
  return { iter: ITER, scn, cfg: cfgBlob, rcp };
}

async function buildEncrypt() {
  const secrets = loadSecrets();
  let users = await loadExistingUsers(secrets);
  if (users) console.log('Пользователи взяты из текущего index.html (cfg).');
  else { users = attachBootstrapPasswords(BOOTSTRAP_USERS, secrets); console.log('Пользователи: bootstrap из _src/secrets.json.'); }

  const manifest = await buildManifest(users);
  fs.writeFileSync(path.join(ROOT, 'index.html'), shell(JSON.stringify(manifest)));
  console.log('✓ собрано: index.html\n');
  console.log('Логины и пароли:');
  for (const u of users) console.log(`  ${u.login.padEnd(8)} [${u.role}] ${(u.passwords || []).join(', ')}  → ${u.scenarios.join(', ')}${u.expires ? '  до ' + u.expires : ''}`);
}

/* ---- восстановление _src мастер-логином ---- */
async function buildDecrypt() {
  const secrets = loadSecrets();
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const vault = JSON.parse(html.match(/window\.__VAULT__=({[\s\S]*?});<\/script>/)[1]);
  for (const login of Object.keys(secrets)) for (const pw of secrets[login]) for (const e of vault.rcp) {
    try {
      const kek = await pbkdf2(passphrase(login, pw), unb64(e.salt));
      for (const id of Object.keys(SCENARIOS)) {
        if (!e.w[id] || !vault.scn[id]) continue;
        const wrap = JSON.parse(dec.decode(await gDec(kek, e.w[id])));
        const cek = await rawKey(unb64(wrap.k));
        const obj = JSON.parse(dec.decode(await gDec(cek, vault.scn[id])));
        fs.writeFileSync(path.join(ROOT, SCENARIOS[id].src),
          `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<title>${id}</title>\n<link rel="stylesheet" href="assets/site.css">\n</head>\n<body>\n${obj.html}\n</body>\n</html>\n`);
        console.log('✓ восстановлено:', SCENARIOS[id].src);
      }
      return;
    } catch { /* следующий ключ */ }
  }
  console.error('Не удалось расшифровать паролями из _src/secrets.json');
}

/* ---- Access-версия: статичные пер-статейные страницы (Cloudflare Pages + Access) ----
   Открытый текст (Access защищает на входе). В _site/ — самодостаточный
   деплой-каталог. В публичный репозиторий НЕ коммитится (.gitignore). */
async function buildSite() {
  const out = path.join(ROOT, '_site');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  for (const f of ['site.css', 'anim.js', 'logo-mark.svg', 'logo-mark-white.svg']) {
    var s = path.join(ROOT, 'assets', f); if (fs.existsSync(s)) fs.copyFileSync(s, path.join(out, 'assets', f));
  }
  const SLUG = {}; for (const id in SCENARIOS) SLUG[id] = id === 'hub' ? '' : path.basename(SCENARIOS[id].src, '.html');
  function page(title, assets, bodyInner) {
    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${assets}/site.css">
</head>
<body>
<div id="app">
${bodyInner}
</div>
<script src="${assets}/anim.js" defer></script>
</body>
</html>
`;
  }
  for (const [id, cfg] of Object.entries(SCENARIOS)) {
    const file = path.join(ROOT, cfg.src); if (!fs.existsSync(file)) continue;
    const raw = fs.readFileSync(file, 'utf8');
    let body = parseBody(raw);
    const sub = id !== 'hub'; const assets = sub ? '../assets' : 'assets';
    if (id === 'hub') {
      // карточки-кнопки -> ссылки на статьи
      body = body.replace(/<button class="rcard" data-scn="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g,
        (m, scn, inner) => `<a class="rcard" href="${SLUG[scn] ? SLUG[scn] + '/' : '#'}">${inner}</a>`);
    } else {
      const controls = `<a class="gate-logout" href="../">← Все исследования</a>` +
        `<button class="gate-logout" type="button" onclick="window.print()">↓ PDF</button>`;
      // встраиваем управление в шапку (вместо тега), иначе — фиксированной плашкой
      if (/<span class="tag">[\s\S]*?<\/span>/.test(body)) body = body.replace(/<span class="tag">[\s\S]*?<\/span>/, controls);
      else body = `<div class="gate-controls">${controls}</div>\n` + body;
    }
    const dir = id === 'hub' ? out : path.join(out, SLUG[id]);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), page(parseTitle(raw) || id, assets, body));
    console.log('✓ site:', path.relative(ROOT, path.join(dir, 'index.html')), sub ? '(Access app: /' + SLUG[id] + '/*)' : '(hub)');
  }
  console.log('\nГотово: _site/ — открытый текст для Cloudflare Pages за Access (в git не попадает).');
  console.log('Пути для Access-приложений:', Object.keys(SCENARIOS).filter(i => i !== 'hub').map(i => '/' + SLUG[i] + '/*').join(', '));
}

const mode = process.argv[2] || 'encrypt';
if (mode === 'decrypt') await buildDecrypt();
else if (mode === 'site') await buildSite();
else await buildEncrypt();
