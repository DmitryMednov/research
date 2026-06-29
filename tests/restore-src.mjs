/* Восстановить _src/secrets.json для CI:
   - если задан SECRETS_JSON — берём его;
   - иначе, в открытом режиме, достаём гостевой ключ из window.__OPEN__
     в index.html (этого достаточно, чтобы node build.mjs decrypt вернул
     исходники контента для тестов).
   Дальше workflow вызывает `node build.mjs decrypt`. */
import fs from 'node:fs';

fs.mkdirSync('_src', { recursive: true });
const sj = process.env.SECRETS_JSON;
if (sj && sj.trim()) {
  fs.writeFileSync('_src/secrets.json', sj);
  console.log('secrets.json из SECRETS_JSON');
} else {
  const html = fs.readFileSync('index.html', 'utf8');
  const m = html.match(/window\.__OPEN__=(\{.*?\});/);
  if (!m) {
    console.error('index.html не в открытом режиме и нет секрета SECRETS_JSON — нечем расшифровать контент для тестов.');
    process.exit(1);
  }
  const o = JSON.parse(m[1]);
  fs.writeFileSync('_src/secrets.json', JSON.stringify({ [o.login]: [o.pw] }));
  console.log('secrets.json из window.__OPEN__ (открытый режим)');
}
