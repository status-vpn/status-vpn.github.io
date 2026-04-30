# VPN Status — статический сайт мониторинга

Статический сайт для GitHub Pages: статусы VPN-сервисов, индивидуальные страницы с актуальной датой в HTML, счётчики безотказной работы и пользовательские голоса.

## Архитектура

```
data/services.json        # все данные о сервисах
templates/                # шаблоны HTML (Mustache-подобные {{VARS}})
public/                   # статические ассеты (CSS, JS, иконки)
scripts/build.js          # генератор статики (Node.js, без зависимостей)

# генерируется (коммитится автоматически):
index.html
services/<slug>.html
sitemap.xml, robots.txt, 404.html
assets/                   # копия из public/
```

## Локальная разработка

```bash
node scripts/build.js              # собрать
npx http-server . -p 8080          # посмотреть → http://localhost:8080
```

## Деплой на GitHub Pages

1. Создай репозиторий и запушь весь проект.
2. Settings → Pages → Source: **GitHub Actions**.
3. Воркфлоу `.github/workflows/daily-update.yml` запустится автоматически:
   - на push в main,
   - вручную через Actions → "Daily HTML rebuild" → Run workflow,
   - и **каждый день в 00:05 UTC** (даты обновятся в HTML).

## Как работают счётчики голосов

`public/assets/js/votes.js` — клиентский модуль. По умолчанию счётчики строятся как:

- **baseline** — детерминированное число, зависит от даты+slug (стабильно в течение дня),
- **delta** — голоса этого пользователя (localStorage).

Один пользователь = один активный голос «работает/не работает» в сутки. Лайки/дизлайки — отдельная пара. При достижении порога жалоб (`voteThreshold`) счётчик безотказной работы визуально сбрасывается — статус становится «не работает».

### Подключить настоящий бэкенд

Замени тело функций `getCounts` и `recordVote` в `votes.js` на вызовы Firebase / Supabase / Cloudflare KV. Остальной код работает с этим API — менять больше ничего не надо.

## Добавить новый VPN-сервис

Открой `data/services.json` → массив `services` → добавь объект:

```json
{
  "slug": "my-vpn",
  "name": "Мой ВПН",
  "color": "#ff0080",
  "logo": "МВ",
  "siteUrl": "https://example.com",
  "isPartner": false,
  "voteThreshold": 10,
  "uptimeStartHoursAgo": 100,
  "tagline": "Краткое описание",
  "description": "Подробное описание сервиса",
  "country": "🇷🇺 Россия",
  "founded": "2024",
  "protocols": ["WireGuard"],
  "platforms": ["android", "ios"],
  "pros": ["…"],
  "cons": ["…"],
  "faq": [{"q": "…", "a": "…"}]
}
```

Запусти `node scripts/build.js` — страница `/services/my-vpn.html` сгенерируется автоматически и попадёт в sitemap, в карточки на главной и в альтернативы на других страницах.

## Партнёрские сервисы

Top-1 и Top-2 в блоке альтернатив всегда зафиксированы:
- **Top-1**: VPNType (`isPartner: true`, повышенный порог сброса 50)
- **Top-2**: AdGuard VPN (`isPartner: true`, повышенный порог сброса 50)

Чтобы поменять — отредактируй функцию `pickAlternatives` в `scripts/build.js` и поля `isPartner` / `voteThreshold` соответствующих сервисов в JSON.
