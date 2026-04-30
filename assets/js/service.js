/* service.js — service page logic: voting, timer, threshold bar, alternatives ticker */
(function () {
  "use strict";

  var body = document.body;
  var slug = body.getAttribute("data-service");
  var threshold = parseInt(body.getAttribute("data-threshold"), 10) || 10;
  var originalStartIso = body.getAttribute("data-uptime-start");
  var initialStatus = body.getAttribute("data-initial-status") || "ok";

  if (!slug) return;

  var state = {
    counts: window.VPNVotes.getCounts(slug, threshold, initialStatus),
    userVote: window.VPNVotes.getUserVote(slug),
    effectiveStartIso: originalStartIso
  };

  // -------- DOM refs --------
  var dot = document.querySelector("[data-status-dot]");
  var statusBadge = document.querySelector("[data-status-badge]");
  var statusLabel = document.querySelector("[data-status-label]");
  var downCountEl = document.querySelector("[data-down-count]");
  var thresholdFill = document.querySelector("[data-threshold-fill]");
  var thresholdDisplay = document.querySelector("[data-threshold-display]");
  var voteButtons = Array.prototype.slice.call(document.querySelectorAll("[data-vote]"));
  var altList = document.querySelector("[data-alt-list]");
  var statusBg = document.querySelector("[data-status-bg]");

  // -------- render --------
  function statusToText(s) {
    return s === "ok" ? "Работает стабильно" :
           s === "warn" ? "Возможны перебои" :
           "Сообщают о недоступности";
  }
  function statusToBgVar(s) {
    if (s === "down") return "linear-gradient(135deg, #dc2626 0%, #7f1d1d 100%)";
    if (s === "warn") return "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)";
    return ""; // use default brand gradient
  }

  function render() {
    var status = window.VPNVotes.statusFromCounts(state.counts, threshold);
    state.effectiveStartIso = window.VPNVotes.effectiveUptimeStart(originalStartIso, state.counts, threshold);

    // Status dot + label
    if (dot) {
      dot.classList.remove("warn", "down");
      if (status !== "ok") dot.classList.add(status);
    }
    if (statusBadge) {
      statusBadge.classList.remove("is-ok", "is-warn", "is-down");
      statusBadge.classList.add("is-" + status);
    }
    if (statusLabel) statusLabel.textContent = statusToText(status);

    // Hero background hint based on status
    if (statusBg) {
      var bg = statusToBgVar(status);
      if (bg) statusBg.style.background = bg;
      else statusBg.style.background = "";
    }

    // Down count
    if (downCountEl) downCountEl.textContent = state.counts.down;

    // Threshold bar
    if (thresholdFill) {
      var pct = Math.min(100, (state.counts.down / threshold) * 100);
      thresholdFill.style.width = pct + "%";
    }
    if (thresholdDisplay) thresholdDisplay.textContent = threshold;

    // Vote button counts + active state
    voteButtons.forEach(function (btn) {
      var kind = btn.getAttribute("data-vote");
      var countEl = btn.querySelector("[data-count]");
      if (countEl) countEl.textContent = state.counts[kind] || 0;
      btn.classList.toggle("is-active",
        state.userVote && state.userVote.kind === kind);
    });
  }

  // -------- vote handlers --------
  voteButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var kind = btn.getAttribute("data-vote");
      var prevStatus = window.VPNVotes.statusFromCounts(state.counts, threshold);

      var result = window.VPNVotes.recordVote(slug, kind, threshold, initialStatus);
      state.counts = result.counts;
      state.userVote = result.userVote ? { kind: result.userVote, ts: Date.now() } : null;

      btn.classList.remove("vote-burst");
      // force reflow so the animation re-triggers
      void btn.offsetWidth;
      btn.classList.add("vote-burst");

      var newStatus = window.VPNVotes.statusFromCounts(state.counts, threshold);
      if (prevStatus !== "down" && newStatus === "down") {
        // Visual reset feedback
        announce("Порог жалоб достигнут — счётчик безотказной работы сброшен.");
      }
      render();
    });
  });

  function announce(msg) {
    var el = document.createElement("div");
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
      "background:#0f172a;color:white;padding:14px 22px;border-radius:12px;" +
      "box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:1000;font-weight:600;" +
      "max-width:90vw;text-align:center;";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; el.style.transition = "opacity .4s"; }, 3500);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // -------- timer --------
  var timerRoot = document.querySelector("[data-uptime-timer]");
  if (timerRoot) {
    window.VPNTimer.bindTicker(timerRoot, function () { return state.effectiveStartIso; });
  }

  // -------- alternatives live tickers --------
  if (altList) {
    var altRows = Array.prototype.slice.call(altList.querySelectorAll(".alt-row"));
    altRows.forEach(function (row) {
      var altSlug = row.getAttribute("data-slug");
      var altThreshold = parseInt(row.getAttribute("data-threshold"), 10) || 10;
      var altStartIso = row.getAttribute("data-uptime-start");
      var altInitial = row.getAttribute("data-initial-status") || "ok";

      function updateAlt() {
        var c = window.VPNVotes.getCounts(altSlug, altThreshold, altInitial);
        var s = window.VPNVotes.statusFromCounts(c, altThreshold);
        var effStart = window.VPNVotes.effectiveUptimeStart(altStartIso, c, altThreshold);

        var dotEl = row.querySelector(".status-dot");
        if (dotEl) {
          dotEl.classList.remove("warn", "down");
          if (s !== "ok") dotEl.classList.add(s);
        }
        var labelEl = row.querySelector("[data-alt-status-label]");
        if (labelEl) labelEl.textContent =
          s === "ok" ? "Работает" : s === "warn" ? "Сбои" : "Не работает";
        var upEl = row.querySelector("[data-alt-uptime]");
        if (upEl) upEl.textContent = window.VPNTimer.formatShort(Date.now() - new Date(effStart).getTime());
      }
      updateAlt();
      setInterval(updateAlt, 1000);
    });
  }

  render();
})();
