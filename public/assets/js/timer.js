/* timer.js — live uptime ticker */
(function (global) {
  "use strict";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function formatDelta(ms) {
    if (ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var d = Math.floor(totalSec / 86400);
    var h = Math.floor((totalSec % 86400) / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return { d: d, h: h, m: m, s: s };
  }

  function formatShort(ms) {
    var p = formatDelta(ms);
    if (p.d > 0) return p.d + "д " + p.h + "ч";
    if (p.h > 0) return p.h + "ч " + pad(p.m) + "м";
    return p.m + "м " + pad(p.s) + "с";
  }

  // Bind a live ticker to a DOM root.
  // root must contain elements with data-t-days/hours/mins/secs
  function bindTicker(root, getStartIso) {
    var dEl = root.querySelector("[data-t-days]");
    var hEl = root.querySelector("[data-t-hours]");
    var mEl = root.querySelector("[data-t-mins]");
    var sEl = root.querySelector("[data-t-secs]");

    function tick() {
      var startIso = typeof getStartIso === "function" ? getStartIso() : getStartIso;
      var start = new Date(startIso).getTime();
      var p = formatDelta(Date.now() - start);
      if (dEl) dEl.textContent = p.d;
      if (hEl) hEl.textContent = pad(p.h);
      if (mEl) mEl.textContent = pad(p.m);
      if (sEl) sEl.textContent = pad(p.s);
    }
    tick();
    return setInterval(tick, 1000);
  }

  global.VPNTimer = {
    formatDelta: formatDelta,
    formatShort: formatShort,
    bindTicker: bindTicker
  };
})(window);
