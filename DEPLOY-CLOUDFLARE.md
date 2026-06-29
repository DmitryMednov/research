# Версия с входом через Google (Cloudflare Access)

Дополнительная версия архива, где доступ выдаётся **по email** (вход через
Google или одноразовый код на почту), а права на конкретные статьи
управляются списками email. Парольная версия (этот репозиторий,
`dmitrymednov.github.io`) при этом **остаётся как есть** — это независимый
запасной способ для разовых ссылок.

## Почему не на GitHub Pages
Cloudflare Access защищает только трафик через Cloudflare. GitHub Pages
всегда отдаёт тот же контент по `*.github.io` мимо Cloudflare → обход.
Поэтому защищаемая (открытый текст) версия живёт на **Cloudflare Pages**
(origin = Cloudflare, публичного обхода нет).

## Что генерирует сборка
```
node build.mjs site     # -> _site/ (открытый текст, в git НЕ коммитится)
```
`_site/` — самодостаточный деплой-каталог:
```
_site/index.html            витрина (ссылки на статьи)
_site/muzh-na-chas/         статья 1   -> Access app на /muzh-na-chas/*
_site/samui/                статья 2   -> Access app на /samui/*
_site/assets/               стили, шрифты, анимации
```
Открытого логин-гейта нет — вход обеспечивает Cloudflare Access.

---

## Шаги (выполняются в ваших аккаунтах)

### 1. Приватный репозиторий для Access-версии
Контент открытый, поэтому репозиторий должен быть **приватным**. Положите в
него содержимое `_site/` (в корень). Перенос сделаю я, когда дадите доступ
к репозиторию.

### 2. Cloudflare: добавить домен
- Завести аккаунт Cloudflare (free), добавить сайт `mednov.family`.
- Сменить NS-серверы у регистратора на выданные Cloudflare.
- Основной `mednov.family` оставить как есть (DNS-запись на GitHub Pages,
  можно «DNS only»). Менять основной сайт не нужно.

### 3. Cloudflare Pages: задеплоить Access-версию
- Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** →
  выбрать приватный репозиторий из шага 1.
- Build command: пусто. Output directory: `/` (если контент `_site/` лежит
  в корне репо) или `_site` (если положили целиком папкой).
- Custom domain: **`research.mednov.family`** (Cloudflare сам добавит DNS).

### 4. Google как способ входа (Zero Trust)
- Google Cloud Console → APIs & Services → Credentials → **OAuth client ID**
  (тип Web). Authorized redirect URI:
  `https://<ваш-team>.cloudflareaccess.com/cdn-cgi/access/callback`
  (точное значение — в Zero Trust → Settings → Custom Pages / Team domain).
- Cloudflare **Zero Trust → Settings → Authentication → Login methods**:
  - Add new → **Google** → вставить Client ID и Client Secret.
  - Включить встроенный **One-time PIN** (код на email) — это «вход без
    Google» для тех, у кого нет Google-аккаунта.

### 5. Access-приложения по статьям
Zero Trust → **Access → Applications → Add → Self-hosted**. Создать по
приложению на путь:

| Приложение | Domain / Path                         | Кому открыть |
|-----------|----------------------------------------|--------------|
| Витрина   | `research.mednov.family` (path `/`)    | вы + фэмили-офис |
| Муж на час| `research.mednov.family` `/muzh-na-chas/*` | список email |
| Самуи     | `research.mednov.family` `/samui/*`    | список email |

Для каждого: Identity providers = Google + One-time PIN; Policy = **Allow**,
Include → **Emails** → перечислить адреса (или Email domain / Access group).

### 6. Как выдавать доступ
Открыть нужное Access-приложение → Policy → добавить/убрать email. Эффект
мгновенный. (Витрину обычно открывают только вам/семье, а партнёрам — лишь
их статью.)

---

## Управление из своей админ-панели (опционально, позже)
Вместо дашборда Cloudflare можно собрать мини-панель «email → статьи» на
**Cloudflare Worker**, который через Cloudflare API правит политики Access
(токен живёт в Worker, не в браузере). Сделаю, когда базовая схема выше
заработает — её удобнее настраивать и тестировать на живом Cloudflare.

## Итог: две независимые версии
- **Парольная** (как сейчас): `dmitrymednov.github.io/research` — зашифровано,
  разовые ссылки логин+пароль. Не меняется.
- **Google/Access**: `research.mednov.family` — вход по Google/коду на email,
  доступ к статьям по спискам email.
