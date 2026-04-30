#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * VPN Status — static site generator.
 *
 * Reads data/services.json + templates/*, writes to repo root:
 *   index.html
 *   services/<slug>.html (one per service)
 *   sitemap.xml
 *   404.html
 * Copies public/* into the root as-is.
 *
 * Run daily via GitHub Actions to keep TODAY_DATE fresh in HTML.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data", "services.json");
const TEMPLATES = path.join(ROOT, "templates");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUT = ROOT;

// ---------- date helpers ----------
const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"
];

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function ruDate(d) {
  return d.getUTCDate() + " " + RU_MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function isoDate(d) {
  return d.toISOString();
}

// ---------- I/O helpers ----------
function readText(p) { return fs.readFileSync(p, "utf8"); }
function writeText(p, c) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// ---------- HTML helpers ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(str) { return escapeHtml(str); }
function escapeJsonLd(str) {
  // Prevent embedded JSON-LD from breaking out of <script> tags.
  return String(str)
    .split("<").join("\\u003c")
    .split(">").join("\\u003e")
    .split("&").join("\\u0026");
}

function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{([A-Z0-9_]+)\}\}/g, function (_, key) {
    return key in vars ? vars[key] : "";
  });
}

// ---------- core ----------
function uptimeStartFor(service) {
  // Two modes:
  //   - sliding: uptimeStartHoursAgo → recomputed on every build (partners stay near a fixed window)
  //   - fixed:   uptimeStartIso     → stable across builds, counter naturally grows day by day
  if (service.uptimeStartIso) return service.uptimeStartIso;
  if (typeof service.uptimeStartHoursAgo === "number") {
    return new Date(Date.now() - service.uptimeStartHoursAgo * 3600 * 1000).toISOString();
  }
  // Fallback: 7 days ago
  return new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
}

function pickAlternatives(allServices, current, maxOthers) {
  // Top-1 always vpntype, top-2 always adguard-vpn (when current isn't them).
  const result = [];
  const top1 = allServices.find(s => s.slug === "vpntype");
  const top2 = allServices.find(s => s.slug === "adguard-vpn");

  if (top1 && top1.slug !== current.slug) result.push(top1);
  if (top2 && top2.slug !== current.slug) result.push(top2);

  const remainders = allServices.filter(s =>
    s.slug !== current.slug &&
    s.slug !== "vpntype" &&
    s.slug !== "adguard-vpn" &&
    s.slug !== "radmin-vpn" // not a real anonymity VPN — exclude from alternative lists
  );

  // Stable rotation per current slug — keeps lists varied without randomness.
  const seed = (current.slug.length * 7 + current.name.charCodeAt(0)) % Math.max(1, remainders.length);
  const ordered = remainders.slice(seed).concat(remainders.slice(0, seed));
  for (const r of ordered) {
    if (result.length >= 2 + maxOthers) break;
    result.push(r);
  }
  return result;
}

function renderPlatformBadgesTop(service, platforms) {
  // Show a curated set in hero with green/red status indicator each.
  const priority = ["android", "ios", "windows", "macos", "youtube", "telegram", "instagram", "openai"];
  const supportedSet = new Set(service.platforms);
  return priority.map(k => {
    const p = platforms[k];
    if (!p) return "";
    const ok = supportedSet.has(k);
    const stateClass = ok ? "is-ok" : "is-down";
    const stateLabel = ok ? "работает" : "не работает";
    return '<span class="platform-pill ' + stateClass + '" title="' + escapeAttr(p.label + ' — ' + stateLabel) + '">' +
           '<span class="platform-pill-dot" aria-hidden="true"></span>' +
           '<span class="usage-icon" aria-hidden="true">' + p.icon + '</span>' +
           '<span class="platform-pill-label">' + escapeHtml(p.label) + '</span>' +
           '<span class="visually-hidden"> — ' + stateLabel + '</span>' +
           '</span>';
  }).join("\n");
}

function renderPlatformGrid(service, platforms) {
  const allKeys = Object.keys(platforms);
  const supportedSet = new Set(service.platforms);
  return allKeys.map(k => {
    const p = platforms[k];
    const ok = supportedSet.has(k);
    const stateClass = ok ? "is-ok" : "is-down";
    const stateLabel = ok ? "работает" : "не работает";
    return '<div class="platform-tile ' + stateClass + '" title="' + escapeAttr(p.label + ' — ' + stateLabel) + '">' +
           '<span class="platform-tile-icon" aria-hidden="true">' + p.icon + '</span>' +
           '<span class="platform-tile-label">' + escapeHtml(p.label) + '</span>' +
           '<span class="platform-tile-status" aria-hidden="true"></span>' +
           '<span class="visually-hidden">' + stateLabel + '</span>' +
           '</div>';
  }).join("\n");
}

function renderCtaBlock(s) {
  // External CTA only for top-1 / top-2 (the partners). Others show no outbound link.
  if (!s.isPartner) return "";
  return '<a class="cta cta-primary" href="' + escapeAttr(s.siteUrl) +
         '" target="_blank" rel="noopener nofollow sponsored">' +
         'Перейти на ' + escapeHtml(s.name) + ' →</a>';
}

function renderProsCons(items) {
  return (items || []).map(text => '<li>' + escapeHtml(text) + '</li>').join("\n");
}

function renderFaqHtml(service, todayDate) {
  if (!service.faq || !service.faq.length) {
    return '<section class="container section faq" id="faq" aria-labelledby="faq-h"><h2 id="faq-h">Частые вопросы про ' + escapeHtml(service.name) + '</h2>' +
           '<details><summary>Что делать, если ' + escapeHtml(service.name) + ' не работает?</summary>' +
           '<p>Если сервис недоступен на ' + escapeHtml(todayDate) + ', проверьте список альтернатив выше — мы обновляем его на основе пользовательских голосов и текущего статуса.</p></details></section>';
  }
  const items = service.faq.map(item =>
    '<details><summary>' + escapeHtml(item.q) + '</summary><p>' + escapeHtml(item.a) + '</p></details>'
  ).join("\n");
  return '<section class="container section faq" id="faq" aria-labelledby="faq-h">' +
         '<h2 id="faq-h">Частые вопросы про ' + escapeHtml(service.name) + '</h2>' +
         items +
         '<details><summary>Что делать, если ' + escapeHtml(service.name) + ' перестал работать?</summary>' +
         '<p>Сначала переподключитесь и переключите протокол. Если проблема не решилась — проверьте альтернативы из списка выше: они отсортированы по текущему статусу на ' + escapeHtml(todayDate) + '.</p></details></section>';
}

function renderFaqSchema(service) {
  if (!service.faq || !service.faq.length) return "";
  const entities = service.faq.map(item => ({
    "@type": "Question",
    "name": item.q,
    "acceptedAnswer": { "@type": "Answer", "text": item.a }
  }));
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": entities
  });
  return '<script type="application/ld+json">' + escapeJsonLd(json) + '</script>';
}

function renderAlternatives(alts, platforms) {
  return alts.map(s => {
    const initStatus = s.currentStatus || "ok";
    const platTags = s.platforms.slice(0, 4)
      .map(k => platforms[k] ? '<span class="alt-platform" title="' + escapeAttr(platforms[k].label) + '">' + platforms[k].icon + '</span>' : "")
      .join("");
    return (
      '<li class="alt-row" ' +
        'data-slug="' + escapeAttr(s.slug) + '" ' +
        'data-threshold="' + s.voteThreshold + '" ' +
        'data-uptime-start="' + uptimeStartFor(s) + '" ' +
        'data-initial-status="' + escapeAttr(initStatus) + '">' +
      '<a class="alt-link" href="' + escapeAttr(s.slug) + '.html" aria-label="Открыть страницу ' + escapeAttr(s.name) + '"></a>' +
      '<span class="alt-logo" style="background:' + escapeAttr(s.color) + '">' + escapeHtml(s.logo) + '</span>' +
      '<div class="alt-body">' +
        '<div class="alt-name">' + escapeHtml(s.name) + '</div>' +
        '<div class="alt-meta">' + escapeHtml(s.tagline) + '</div>' +
      '</div>' +
      '<div class="alt-status"><span class="status-dot"></span><span data-alt-status-label>Работает</span></div>' +
      '<div class="alt-platforms">' + platTags + '</div>' +
      '<div class="alt-uptime"><span class="alt-uptime-label">Без сбоев</span><b data-alt-uptime>—</b></div>' +
      '<span class="alt-cta">Подробнее →</span>' +
      '</li>'
    );
  }).join("\n");
}

function renderServiceCard(s, platforms) {
  const initStatus = s.currentStatus || "ok";
  const platTags = s.platforms.slice(0, 5).map(k =>
    platforms[k]
      ? '<span class="platform-mini" title="' + escapeAttr(platforms[k].label) + '">' + platforms[k].icon + '</span>'
      : ""
  ).join("");
  return (
    '<article class="service-card" ' +
      'data-slug="' + escapeAttr(s.slug) + '" ' +
      'data-threshold="' + s.voteThreshold + '" ' +
      'data-uptime-start="' + uptimeStartFor(s) + '" ' +
      'data-initial-status="' + escapeAttr(initStatus) + '" ' +
      'data-status="' + escapeAttr(initStatus) + '">' +
      '<a class="service-link" href="services/' + escapeAttr(s.slug) + '.html" aria-label="' + escapeAttr(s.name) + '"></a>' +
      '<div class="service-card-head">' +
        '<span class="service-logo" style="background:' + escapeAttr(s.color) + '">' + escapeHtml(s.logo) + '</span>' +
        '<div>' +
          '<div class="service-card-name">' + escapeHtml(s.name) + '</div>' +
          '<div class="service-card-tag">' + escapeHtml(s.tagline) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="service-card-status">' +
        '<span class="status-dot" data-card-dot></span>' +
        '<span data-card-status-label>Работает</span>' +
      '</div>' +
      '<div class="service-card-uptime">' +
        '<span class="uptime-mini-label">Без сбоев</span>' +
        '<span class="uptime-mini" data-card-uptime>—</span>' +
      '</div>' +
      '<div class="service-card-uptime">' +
        '<span class="uptime-mini-label">Жалоб сегодня</span>' +
        '<span class="uptime-mini"><b data-card-down>0</b></span>' +
      '</div>' +
      '<div class="service-card-platforms">' + platTags + '</div>' +
    '</article>'
  );
}

// ---------- main ----------
function build() {
  console.log("→ Reading data + templates");
  const data = JSON.parse(readText(DATA));
  const tplIndex = readText(path.join(TEMPLATES, "index.html"));
  const tplService = readText(path.join(TEMPLATES, "service.html"));

  const today = todayUTC();
  const todayDate = ruDate(today);
  const todayIso = isoDate(today);

  const sharedVars = {
    SITE_TITLE: data.site.title,
    SITE_DESCRIPTION: data.site.description,
    SITE_AUTHOR: data.site.author,
    SITE_YEAR: String(data.site.year),
    TODAY_DATE: todayDate,
    TODAY_ISO: todayIso
  };

  // Index
  console.log("→ Rendering index.html");
  const cardsHtml = data.services.map(s => renderServiceCard(s, data.platforms)).join("\n");
  const indexHtml = renderTemplate(tplIndex, Object.assign({}, sharedVars, {
    SERVICES_LIST: cardsHtml,
    COUNT_TOTAL: String(data.services.length)
  }));
  writeText(path.join(OUT, "index.html"), indexHtml);

  // Service pages
  console.log("→ Rendering " + data.services.length + " service pages");
  for (const s of data.services) {
    const alts = pickAlternatives(data.services, s, 3); // top-2 fixed + 3 others = 5 total
    const altsHtml = renderAlternatives(alts, data.platforms);
    const platformBadgesTop = renderPlatformBadgesTop(s, data.platforms);
    const platformGrid = renderPlatformGrid(s, data.platforms);
    const protocolsList = (s.protocols || []).join(", ");
    const prosHtml = renderProsCons(s.pros);
    const consHtml = renderProsCons(s.cons);
    const faqHtml = renderFaqHtml(s, todayDate);
    const faqSchema = renderFaqSchema(s);
    const ctaBlock = renderCtaBlock(s);

    const html = renderTemplate(tplService, Object.assign({}, sharedVars, {
      SERVICE_NAME: s.name,
      SERVICE_SLUG: s.slug,
      SERVICE_COLOR: s.color,
      SERVICE_LOGO: s.logo,
      SERVICE_TAGLINE: s.tagline,
      SERVICE_DESCRIPTION: s.description,
      SERVICE_URL: s.siteUrl,
      SERVICE_COUNTRY: s.country,
      SERVICE_FOUNDED: s.founded,
      SERVICE_PROTOCOLS: protocolsList,
      VOTE_THRESHOLD: String(s.voteThreshold),
      UPTIME_START_ISO: uptimeStartFor(s),
      INITIAL_STATUS: s.currentStatus || "ok",
      ALTERNATIVES_LIST: altsHtml,
      PLATFORM_BADGES_TOP: platformBadgesTop,
      PLATFORM_GRID: platformGrid,
      SERVICE_PROS: prosHtml,
      SERVICE_CONS: consHtml,
      FAQ_SECTION: faqHtml,
      FAQ_SCHEMA: faqSchema,
      CTA_BLOCK: ctaBlock
    }));
    writeText(path.join(OUT, "services", s.slug + ".html"), html);
  }

  // Sitemap
  console.log("→ Writing sitemap.xml");
  const urls = [
    { loc: "/", priority: "1.0", changefreq: "daily" }
  ].concat(data.services.map(s => ({
    loc: "/services/" + s.slug + ".html",
    priority: "0.8",
    changefreq: "daily"
  })));
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u =>
      '  <url><loc>' + escapeHtml(u.loc) + '</loc>' +
      '<lastmod>' + todayIso + '</lastmod>' +
      '<changefreq>' + u.changefreq + '</changefreq>' +
      '<priority>' + u.priority + '</priority></url>'
    ).join("\n") +
    '\n</urlset>\n';
  writeText(path.join(OUT, "sitemap.xml"), sitemap);

  // 404
  console.log("→ Writing 404.html");
  const html404 = renderTemplate(tplIndex, Object.assign({}, sharedVars, {
    SITE_TITLE: "Страница не найдена · " + data.site.title,
    SITE_DESCRIPTION: "Запрошенная страница не существует. Вернитесь к списку всех VPN-сервисов.",
    SERVICES_LIST: cardsHtml,
    COUNT_TOTAL: String(data.services.length)
  })).replace(
    "<h1>Какие VPN работают сегодня в России</h1>",
    "<h1>Страница не найдена</h1>"
  ).replace(
    /<p class="lede">[\s\S]*?<\/p>/,
    '<p class="lede">Запрошенной страницы не существует. Возможно, ссылка устарела. Ниже — все актуальные VPN-сервисы.</p>'
  );
  writeText(path.join(OUT, "404.html"), html404);

  // Static assets
  console.log("→ Copying static assets from public/");
  copyDir(PUBLIC_DIR, OUT);

  // robots.txt
  console.log("→ Writing robots.txt");
  const robots =
    "User-agent: *\n" +
    "Allow: /\n" +
    "Sitemap: " + (data.site.domain ? "https://" + data.site.domain : "") + "/sitemap.xml\n";
  writeText(path.join(OUT, "robots.txt"), robots);

  console.log("✓ Build complete (" + todayDate + ")");
}

build();
