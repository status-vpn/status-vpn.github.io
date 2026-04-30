/* votes.js — voting and counter aggregation
 *
 * Static-site approach: per-service vote counts are computed as
 *   baseline (deterministic by date+slug) + user's local additions.
 * This makes counters stable across reloads, change daily, and
 * still react instantly when the visitor clicks a button.
 *
 * To swap to a real backend (Firebase/Supabase/Cloudflare KV),
 * replace getCounts/recordVote — the rest of the app calls only
 * this module's API.
 */
(function (global) {
  "use strict";

  var KEY_PREFIX = "vpnstatus:v1:";
  var DAY_MS = 86400000;

  // Mulberry32 — fast deterministic PRNG. Same seed → same numbers.
  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      var t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function todayBucket() {
    var now = new Date();
    return now.getUTCFullYear() * 10000 +
           (now.getUTCMonth() + 1) * 100 +
           now.getUTCDate();
  }

  // Deterministic baseline votes for a service for the current day.
  // Numbers are tuned so statusFromCounts() reliably returns the requested
  // status — no flipping to a neighbouring bucket because of rounding.
  //   threshold=10 (default): down → 13–19, warn → 6–8, ok → 0–2
  //   threshold=50 (partners): scaled proportionally
  function baseline(slug, threshold, status) {
    var seed = hash(slug + ":" + todayBucket());
    var r = rng(seed);
    var scale = Math.max(threshold, 10);
    var down, up, like, dislike;

    if (status === "down") {
      // Guaranteed above threshold (1.3x–2.0x)
      down = Math.floor(threshold * (1.3 + r() * 0.7)) + 1;
      up = Math.floor(scale * 0.3 * r());
      dislike = Math.floor(scale * (0.6 + r() * 0.6));
      like = Math.floor(dislike * (0.2 + r() * 0.3));
    } else if (status === "warn") {
      // In warn band: above threshold/2, below threshold (0.6x–0.85x)
      down = Math.floor(threshold * (0.6 + r() * 0.25)) + 1;
      up = Math.floor(scale * (0.6 + r() * 0.5));
      like = Math.floor(scale * (0.7 + r() * 0.7));
      dislike = Math.floor(like * (0.3 + r() * 0.3));
    } else {
      // Well below threshold/2 (0–25% of threshold)
      down = Math.floor(threshold * 0.25 * r());
      up = Math.floor(scale * (1.5 + r() * 1.5));
      like = Math.floor(scale * (1 + r() * 2.5));
      dislike = Math.floor(like * (0.1 + r() * 0.35));
    }
    return { down: down, up: up, like: like, dislike: dislike };
  }

  // Read user's own votes for a service (stored locally).
  function getUserVote(slug) {
    try {
      var raw = localStorage.getItem(KEY_PREFIX + "vote:" + slug);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Expire after 24 hours so user can vote again next day.
      if (Date.now() - parsed.ts > DAY_MS) {
        localStorage.removeItem(KEY_PREFIX + "vote:" + slug);
        return null;
      }
      return parsed;
    } catch (e) { return null; }
  }
  function setUserVote(slug, kind) {
    try {
      localStorage.setItem(
        KEY_PREFIX + "vote:" + slug,
        JSON.stringify({ kind: kind, ts: Date.now() })
      );
    } catch (e) {}
  }

  // Local "votes added" delta — what this user contributed this session.
  // Persisted across reloads within a day.
  function getDelta(slug) {
    try {
      var raw = localStorage.getItem(KEY_PREFIX + "delta:" + slug);
      if (!raw) return { down: 0, up: 0, like: 0, dislike: 0, day: todayBucket() };
      var parsed = JSON.parse(raw);
      if (parsed.day !== todayBucket()) {
        return { down: 0, up: 0, like: 0, dislike: 0, day: todayBucket() };
      }
      return parsed;
    } catch (e) { return { down: 0, up: 0, like: 0, dislike: 0, day: todayBucket() }; }
  }
  function saveDelta(slug, delta) {
    try {
      localStorage.setItem(KEY_PREFIX + "delta:" + slug, JSON.stringify(delta));
    } catch (e) {}
  }

  // Public API: get aggregate counts (baseline + user delta) for a service.
  function getCounts(slug, threshold, status) {
    var b = baseline(slug, threshold, status || "ok");
    var d = getDelta(slug);
    return {
      down: b.down + d.down,
      up: b.up + d.up,
      like: b.like + d.like,
      dislike: b.dislike + d.dislike,
      baseline: b
    };
  }

  // Public API: register a vote. Returns updated counts.
  // Each user can only have one active "down" / "up" choice; like/dislike are independent.
  function recordVote(slug, kind, threshold, status) {
    var existing = getUserVote(slug);
    var delta = getDelta(slug);

    // Toggle pair logic: down ↔ up are mutually exclusive within 24h.
    if (kind === "down" || kind === "up") {
      if (existing && (existing.kind === "down" || existing.kind === "up")) {
        if (existing.kind === kind) {
          // Already voted same — undo.
          delta[kind] = Math.max(0, delta[kind] - 1);
          localStorage.removeItem(KEY_PREFIX + "vote:" + slug);
          delta.day = todayBucket();
          saveDelta(slug, delta);
          return { counts: getCounts(slug, threshold, status), userVote: null };
        } else {
          // Switch.
          delta[existing.kind] = Math.max(0, delta[existing.kind] - 1);
          delta[kind] = (delta[kind] || 0) + 1;
        }
      } else {
        delta[kind] = (delta[kind] || 0) + 1;
      }
    } else {
      // like/dislike — same toggle logic on its own pair.
      var pair = (kind === "like") ? "dislike" : "like";
      if (existing && existing.kind === kind) {
        delta[kind] = Math.max(0, delta[kind] - 1);
        localStorage.removeItem(KEY_PREFIX + "vote:" + slug);
        delta.day = todayBucket();
        saveDelta(slug, delta);
        return { counts: getCounts(slug, threshold, status), userVote: null };
      }
      if (existing && existing.kind === pair) {
        delta[pair] = Math.max(0, delta[pair] - 1);
      }
      delta[kind] = (delta[kind] || 0) + 1;
    }

    delta.day = todayBucket();
    saveDelta(slug, delta);
    setUserVote(slug, kind);
    return { counts: getCounts(slug, threshold, status), userVote: kind };
  }

  // Determine current status from counts and threshold.
  // - down ≥ threshold       → "down"
  // - down ≥ threshold * 0.5 → "warn"
  // - else                   → "ok"
  function statusFromCounts(counts, threshold) {
    if (counts.down >= threshold) return "down";
    if (counts.down >= Math.ceil(threshold * 0.5)) return "warn";
    return "ok";
  }

  // Effective uptime start: if status was "down" today, use today midnight.
  // Otherwise use the configured start date for the service.
  function effectiveUptimeStart(originalStartIso, counts, threshold) {
    if (statusFromCounts(counts, threshold) === "down") {
      var d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    }
    return originalStartIso;
  }

  global.VPNVotes = {
    getCounts: getCounts,
    recordVote: recordVote,
    getUserVote: getUserVote,
    statusFromCounts: statusFromCounts,
    effectiveUptimeStart: effectiveUptimeStart
  };
})(window);
