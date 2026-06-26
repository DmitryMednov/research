#!/usr/bin/env node
/* ============================================================
   build.mjs — сборка единой страницы-входа с шифрованным архивом.

   Модель: один экран логина (логин + пароль). Контент всех сценариев
   зашифрован «конвертом» (envelope encryption):
     - у каждого сценария свой случайный ключ (CEK), им шифруется контент;
     - CEK заворачивается ключом каждого, кому к сценарию открыт доступ
       (ключ = PBKDF2 от «логин\\nпароль»).
   Поэтому мастер-логин открывает все сценарии, а логин партнёра —
   только свой. Логины в коде (не секрет), пароли — в _src/secrets.json
   (в git НЕ попадает; генерируются, если файла нет).

   Использование:
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

/* ---- конфигурация (НЕ секрет) ---- */
const SCENARIOS = {
  hub: { src: '_src/hub.html',          kicker: 'Витрина' },
  r1:  { src: '_src/muzh-na-chas.html', kicker: 'Исследование' },
  r2:  { src: '_src/samui.html',        kicker: 'Исследование' },
};
const CREDS = [
  { login: 'admin',  scenarios: ['hub', 'r1', 'r2'], landing: 'hub' },
  { login: 'cyprus', scenarios: ['r1'],              landing: 'r1'  },
  { login: 'samui',  scenarios: ['r2'],              landing: 'r2'  },
];

/* ---- утилиты ---- */
const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

function genPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = rand(12);
  let out = '';
  for (let i = 0; i < 12; i++) { if (i && i % 4 === 0) out += '-'; out += abc[bytes[i] % abc.length]; }
  return out;
}

async function pbkdf2(passphrase, salt) {
  const km = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function rawKey(bytes) {
  return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function gcmEnc(key, dataU8) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, dataU8);
  return { iv: b64(iv), ct: b64(ct) };
}
async function gcmDec(key, obj) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.ct));
  return new Uint8Array(pt);
}

/* ---- secrets (login -> password) ---- */
function loadSecrets() {
  const p = path.join(ROOT, '_src/secrets.json');
  let s = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
  let changed = false;
  for (const c of CREDS) if (!s[c.login]) { s[c.login] = genPassword(); changed = true; }
  if (changed) {
    fs.mkdirSync(path.join(ROOT, '_src'), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(s, null, 2));
    console.log('Пароли записаны в _src/secrets.json (в git не попадает)');
  }
  return s;
}

/* ---- разбор исходника ---- */
function parseBody(html) {
  let body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  return body.replace(/<script[\s\S]*?<\/script>/gi, '').trim();
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

/* ---- сборка ---- */
async function buildEncrypt() {
  const secrets = loadSecrets();

  // 1) ключи и шифрование контента сценариев
  const scn = {};
  const ceks = {};
  for (const [id, cfg] of Object.entries(SCENARIOS)) {
    const file = path.join(ROOT, cfg.src);
    if (!fs.existsSync(file)) { console.warn('нет исходника:', cfg.src); continue; }
    const body = parseBody(fs.readFileSync(file, 'utf8'));
    const cek = rand(32);
    ceks[id] = cek;
    const key = await rawKey(cek);
    scn[id] = await gcmEnc(key, enc.encode(JSON.stringify({ kicker: cfg.kicker, html: body })));
  }

  // 2) для каждого логина — заворачиваем CEK доступных сценариев
  const rcp = [];
  for (const c of CREDS) {
    const salt = rand(16);
    const kek = await pbkdf2(`${c.login.toLowerCase().trim()}\n${secrets[c.login]}`, salt);
    const w = {};
    for (const id of c.scenarios) {
      if (!ceks[id]) continue;
      const payload = enc.encode(JSON.stringify({ k: b64(ceks[id]), l: id === c.landing }));
      w[id] = await gcmEnc(kek, payload);
    }
    rcp.push({ salt: b64(salt), w });
  }

  const manifest = { iter: ITER, scn, rcp };
  fs.writeFileSync(path.join(ROOT, 'index.html'), shell(JSON.stringify(manifest)));
  console.log('✓ собрано: index.html');
  console.log('\nЛогины и пароли (из _src/secrets.json):');
  for (const c of CREDS)
    console.log(`  ${c.login.padEnd(8)} ${secrets[c.login]}   → ${c.scenarios.join(', ')}`);
}

/* ---- восстановление _src мастер-логином ---- */
async function buildDecrypt() {
  const secrets = loadSecrets();
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/window\.__VAULT__=({[\s\S]*?});<\/script>/);
  if (!m) { console.error('нет манифеста в index.html'); return; }
  const vault = JSON.parse(m[1]);
  const master = CREDS.find(c => c.scenarios.length === Object.keys(SCENARIOS).length) || CREDS[0];
  const entry = vault.rcp[CREDS.indexOf(master)];
  const kek = await pbkdf2(`${master.login.toLowerCase().trim()}\n${secrets[master.login]}`, unb64(entry.salt));
  for (const [id, cfg] of Object.entries(SCENARIOS)) {
    if (!entry.w[id] || !vault.scn[id]) continue;
    const wrap = JSON.parse(dec.decode(await gcmDec(kek, entry.w[id])));
    const cek = await rawKey(unb64(wrap.k));
    const obj = JSON.parse(dec.decode(await gcmDec(cek, vault.scn[id])));
    const full = `<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<title>${id}</title>\n<link rel="stylesheet" href="assets/site.css">\n</head>\n<body>\n${obj.html}\n</body>\n</html>\n`;
    fs.writeFileSync(path.join(ROOT, cfg.src), full);
    console.log('✓ восстановлено:', cfg.src);
  }
}

const mode = process.argv[2] || 'encrypt';
if (mode === 'decrypt') await buildDecrypt();
else await buildEncrypt();
