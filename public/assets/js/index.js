/* index.js — homepage logic: live counters per card + filtering */
(function () {
  "use strict";

  var grid = document.querySelector("[data-services-grid]");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".service-card"));
  var statusCounters = { ok: 0, warn: 0, down: 0 };

  function classifyCard(card) {
    var slug = card.getAttribute("data-slug");
    var threshold = parseInt(card.getAttribute("data-threshold"), 10) || 10;
    var startIso = card.getAttribute("data-uptime-start");
    var initialStatus = card.getAttribute("data-initial-status") || "ok";

    var counts = window.VPNVotes.getCounts(slug, threshold, initialStatus);
    var status = window.VPNVotes.statusFromCounts(counts, threshold);
    var effectiveStart = window.VPNVotes.effectiveUptimeStart(startIso, counts, threshold);

    // Update status dot + label
    var dot = card.querySelector("[data-card-dot]");
    var label = card.querySelector("[data-card-status-label]");
    if (dot) {
      dot.classList.remove("warn", "down");
      if (status !== "ok") dot.classList.add(status);
    }
    if (label) {
      label.textContent =
        status === "ok" ? "Работает" :
        status === "warn" ? "Возможны сбои" : "Не работает";
    }
    card.setAttribute("data-status", status);

    // Update uptime display
    var uptimeEl = card.querySelector("[data-card-uptime]");
    if (uptimeEl) {
      var startMs = new Date(effectiveStart).getTime();
      uptimeEl.textContent = window.VPNTimer.formatShort(Date.now() - startMs);
    }

    // Update down count
    var downEl = card.querySelector("[data-card-down]");
    if (downEl) downEl.textContent = counts.down;

    statusCounters[status]++;
    return status;
  }

  cards.forEach(classifyCard);

  // Hero stats
  function setStat(name, value) {
    var el = document.querySelector('[data-stat="' + name + '"]');
    if (el) el.textContent = value;
  }
  setStat("working", statusCounters.ok);
  setStat("issues", statusCounters.warn);
  setStat("down", statusCounters.down);

  // Filter tabs
  var filters = document.querySelectorAll(".filter");
  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      var f = btn.getAttribute("data-filter");
      cards.forEach(function (card) {
        var status = card.getAttribute("data-status");
        var show = (f === "all") || (status === f);
        card.style.display = show ? "" : "none";
      });
    });
  });

  // Live re-tick once per minute so the homepage uptime numbers stay fresh.
  setInterval(function () {
    cards.forEach(function (card) {
      var startIso = card.getAttribute("data-uptime-start");
      var threshold = parseInt(card.getAttribute("data-threshold"), 10) || 10;
      var initialStatus = card.getAttribute("data-initial-status") || "ok";
      var slug = card.getAttribute("data-slug");
      var counts = window.VPNVotes.getCounts(slug, threshold, initialStatus);
      var effectiveStart = window.VPNVotes.effectiveUptimeStart(startIso, counts, threshold);
      var uptimeEl = card.querySelector("[data-card-uptime]");
      if (uptimeEl) {
        uptimeEl.textContent = window.VPNTimer.formatShort(Date.now() - new Date(effectiveStart).getTime());
      }
    });
  }, 60000);
})();
