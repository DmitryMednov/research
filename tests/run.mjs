/* ============================================================
   Автотесты системы (Playwright, без тест-фреймворка).
   Собирает версии сайта во временной папке (репозиторий не трогает),
   поднимает локальный сервер и проверяет:
     - целостность сборки и отсутствие утечек открытого текста
     - вход и доступы (admin / партнёры / неверный / открытый режим)
     - админ-панель: вход, правка, скачивание рабочего index.html
     - мобильная вёрстка (нет горизонтального переполнения)
     - видимость текста в PDF (ловит «белый текст на белом»)

   Запуск:  npm install  &&  npm test
   Требуется: _src/ с исходниками контента (если нет — node build.mjs decrypt).
   ============================================================ */
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDS = { admin: 'admin-test-pw', cyprus: 'cyprus-test-pw', samui: 'samui-test-pw' };

/* ---- chromium ---- */
function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  try { const ex = chromium.executablePath(); if (ex && fs.existsSync(ex)) return ex; } catch { }
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) for (const d of fs.readdirSync(base)) {
    if (d.startsWith('chromium-')) { const p = path.join(base, d, 'chrome-linux', 'chrome'); if (fs.existsSync(p)) return p; }
  }
  return null;
}

/* ---- temp build ---- */
function setupTemp() {
  if (!fs.existsSync(path.join(ROOT, '_src', 'hub.html'))) {
    console.error('Нет _src/ с исходниками. Восстановите: node build.mjs decrypt');
    process.exit(2);
  }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'research-test-'));
  for (const d of ['assets', '_src', 'admin']) fs.cpSync(path.join(ROOT, d), path.join(TMP, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build.mjs'), path.join(TMP, 'build.mjs'));
  // детерминированные тестовые пароли
  fs.writeFileSync(path.join(TMP, '_src', 'secrets.json'),
    JSON.stringify({ admin: [CREDS.admin], cyprus: [CREDS.cyprus], samui: [CREDS.samui] }, null, 2));
  return TMP;
}
function build(TMP, open) {
  execFileSync('node', ['build.mjs'], { cwd: TMP, env: { ...process.env, OPEN_ACCESS: open ? '1' : '0' }, stdio: 'pipe' });
}

/* ---- статический сервер ---- */
const CT = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
function serve(dir) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    fs.readFile(f, (e, buf) => {
      if (e) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'content-type': CT[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/* ---- мини-харнесс ---- */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

/* ---- helpers ---- */
let browser, BASE;
async function open(opts = {}) {
  const ctx = await browser.newContext(opts.mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page._errs = errs;
  await page.goto(BASE + (opts.path || '/'));
  await page.waitForTimeout(250);
  return { ctx, page };
}
async function loginPw(page, login, pw) {
  await page.fill('#gate-login', login); await page.fill('#gate-pass', pw); await page.click('#gate-btn');
  await page.waitForTimeout(1200);
}
const txt = (page, s) => page.evaluate(t => document.body.innerText.includes(t), s);
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

async function invisibleInPrint(page) {
  await page.emulateMedia({ media: 'print' });
  const bad = await page.evaluate(() => {
    const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return 1; const [r, g, b, a] = m.map(Number); if (a === 0) return null; return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
    const bgLum = el => { let e = el; while (e) { const c = getComputedStyle(e).backgroundColor; const l = lum(c); if (l !== null && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return l; e = e.parentElement; } return 1; };
    const out = [];
    document.querySelectorAll('#app *').forEach(el => {
      const t = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!t) return;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
      const tl = lum(cs.color); if (tl === null) return;
      if (tl > 0.7 && bgLum(el) > 0.7) out.push((el.className || el.tagName) + ': "' + t.slice(0, 30) + '"');
    });
    return out;
  });
  await page.emulateMedia({ media: 'screen' });
  return bad;
}

/* =================== ТЕСТЫ (режим паролей) =================== */
test('сборка: манифест, нет утечки открытого текста, версии ассетов', ({ TMP }) => {
  const html = fs.readFileSync(path.join(TMP, 'index.html'), 'utf8');
  assert(/window\.__VAULT__=\{/.test(html), 'нет манифеста');
  for (const n of ['нишевый игрок', 'Guesty', 'дорожная карта']) assert(!html.includes(n), 'утечка: ' + n);
  for (const a of ['site.css', 'vault.js', 'anim.js']) assert(new RegExp(a + '\\?v=[a-f0-9]+').test(html), 'нет ?v= у ' + a);
});
test('вход (пароли): есть поля логина и пароля', async () => {
  const { ctx, page } = await open();
  assert(await page.$('#gate-login'), 'нет поля логина');
  assert(await page.$('#gate-pass'), 'нет поля пароля');
  await ctx.close();
});
test('admin → витрина «Исследования» + 5 карточек', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'admin', CREDS.admin);
  assert(await txt(page, 'Исследования'), 'нет витрины');
  assert((await page.$$('[data-scn]')).length === 5, 'не 5 карточек');
  assert(page._errs.length === 0, 'JS-ошибки: ' + page._errs);
  await ctx.close();
});
test('cyprus → только «Муж на час», без карточек витрины', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'cyprus', CREDS.cyprus);
  assert(await txt(page, 'нишевый игрок'), 'нет контента Кипра');
  assert(!(await txt(page, 'Архив исследований')), 'видна витрина');
  assert((await page.$$('[data-scn]')).length === 0, 'есть карточки');
  await ctx.close();
});
test('samui → «Аренда вилл на Самуи» (Guesty)', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'samui', CREDS.samui);
  assert(await txt(page, 'Guesty'), 'нет контента Самуи');
  await ctx.close();
});
test('неверный пароль → ошибка, контент скрыт', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'admin', 'totally-wrong');
  assert(await page.isVisible('#gate-err'), 'нет ошибки');
  assert(await page.getAttribute('#app', 'hidden') !== null, 'контент показан');
  await ctx.close();
});
test('admin: открыть исследование с витрины и вернуться', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'admin', CREDS.admin);
  await page.click('[data-scn="r1"]'); await page.waitForTimeout(900);
  assert(await txt(page, 'нишевый игрок'), 'исследование не открылось');
  assert(await page.$('[data-back]'), 'нет кнопки «Витрина»');
  await page.click('[data-back]'); await page.waitForTimeout(700);
  assert(await txt(page, 'Исследования'), 'не вернулись на витрину');
  await ctx.close();
});
test('PDF: нет невидимого (белого) текста при печати', async () => {
  const { ctx, page } = await open();
  await loginPw(page, 'cyprus', CREDS.cyprus);
  const bad = await invisibleInPrint(page);
  assert(bad.length === 0, 'светлый текст на светлом фоне: ' + bad.slice(0, 6).join(' | '));
  await ctx.close();
});
test('мобильный 390px: нет горизонтального переполнения', async () => {
  // вход
  let { ctx, page } = await open({ mobile: true });
  assert(!(await overflow(page)), 'переполнение: вход');
  await page.fill('#gate-login', 'admin'); await page.fill('#gate-pass', CREDS.admin); await page.click('#gate-btn');
  await page.waitForTimeout(1200);
  assert(!(await overflow(page)), 'переполнение: витрина');
  await page.click('[data-scn="r1"]'); await page.waitForTimeout(900);
  assert(!(await overflow(page)), 'переполнение: исследование');
  await ctx.close();
  // админка
  ({ ctx, page } = await open({ mobile: true, path: '/admin/' }));
  await page.fill('#a-login', 'admin'); await page.fill('#a-pass', CREDS.admin); await page.click('#a-btn');
  await page.waitForTimeout(1200);
  assert(!(await overflow(page)), 'переполнение: админка');
  await ctx.close();
});
test('админ-панель: вход, +пароль, скачивание рабочего index.html', async ({ TMP }) => {
  const { ctx, page } = await open({ path: '/admin/' });
  await page.fill('#a-login', 'admin'); await page.fill('#a-pass', CREDS.admin); await page.click('#a-btn');
  await page.waitForTimeout(1300);
  assert((await page.$$('.adm-user')).length === 3, 'не 3 пользователя');
  await page.locator('.adm-user').nth(1).locator('.adm-addpw').click();
  await page.waitForTimeout(200);
  const pwInputs = page.locator('.adm-user').nth(1).locator('.adm-pw .adm-in');
  await pwInputs.nth(await pwInputs.count() - 1).fill('EXTRA-9999');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.adm-bar .btn-turq').click()]);
  await dl.saveAs(path.join(TMP, 'admin-out.html'));
  await ctx.close();
  // проверяем скачанный файл
  const { ctx: c2, page: p2 } = await open({ path: '/admin-out.html' });
  await loginPw(p2, 'cyprus', 'EXTRA-9999');
  assert(await txt(p2, 'нишевый игрок'), 'новый пароль не работает');
  await c2.close();
  const { ctx: c3, page: p3 } = await open({ path: '/admin-out.html' });
  await loginPw(p3, 'cyprus', CREDS.cyprus);
  assert(await txt(p3, 'нишевый игрок'), 'старый пароль перестал работать');
  await c3.close();
});

/* =================== ТЕСТЫ (открытый режим) =================== */
const openTests = [];
const otest = (name, fn) => openTests.push({ name, fn });
otest('открытый режим: только кнопка «Войти», без полей', async () => {
  const { ctx, page } = await open();
  assert(!(await page.$('#gate-login')), 'есть поле логина');
  assert(await page.$('#gate-btn'), 'нет кнопки');
  assert(await page.evaluate(() => !!window.__OPEN__), 'нет __OPEN__');
  await ctx.close();
});
otest('открытый режим: «Войти» открывает витрину', async () => {
  const { ctx, page } = await open();
  await page.click('#gate-btn'); await page.waitForTimeout(1300);
  assert(await txt(page, 'Исследования'), 'витрина не открылась');
  assert(page._errs.length === 0, 'JS-ошибки: ' + page._errs);
  await ctx.close();
});

/* =================== ПРОГОН =================== */
(async () => {
  const exe = findChrome();
  if (!exe) { console.error('Не найден chromium. Установите: npx playwright install chromium, или задайте CHROME_PATH'); process.exit(2); }
  const TMP = setupTemp();
  globalThis.__TMP = TMP;
  browser = await chromium.launch({ executablePath: exe });
  let pass = 0, fail = 0;

  async function runGroup(title, list, ctxExtra) {
    console.log('\n' + title);
    for (const t of list) {
      try { await t.fn(ctxExtra); console.log('  \x1b[32m✓\x1b[0m ' + t.name); pass++; }
      catch (e) { console.log('  \x1b[31m✗\x1b[0m ' + t.name + '\n      ' + e.message); fail++; }
    }
  }

  // режим паролей
  build(TMP, false);
  const s1 = await serve(TMP); BASE = 'http://127.0.0.1:' + s1.port;
  await runGroup('Режим логин+пароль:', tests, { TMP });
  s1.srv.close();

  // открытый режим
  build(TMP, true);
  const s2 = await serve(TMP); BASE = 'http://127.0.0.1:' + s2.port;
  await runGroup('Открытый режим (кнопка «Войти»):', openTests, { TMP });
  s2.srv.close();

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `Итог: ${pass} прошло, ${fail} упало\x1b[0m`);
  process.exit(fail ? 1 : 0);
})();
