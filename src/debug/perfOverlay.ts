// On-device frame-rate overlay, enabled by opening the app with `?perf=1`. It exists to tell
// "the browser isn't running animation frames fast enough" apart from "frames run fine but the
// playhead looks choppy" on a phone, without needing USB DevTools (whose tracing slows the page).
// Plain DOM, outside React, so it never adds renders; it is a no-op unless the flag is present.

/** Counters other code bumps; read and reset by the overlay twice a second. */
export const perfCounters = { playheadWrites: 0 };

const REPORT_MS = 500;

export function mountPerfOverlay(): void {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("perf")) return;

  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;top:0;left:0;z-index:99999;padding:4px 6px;font:10px/1.4 ui-monospace,monospace;" +
    "color:#0f0;background:rgba(0,0,0,0.75);white-space:pre;pointer-events:none";
  document.body.appendChild(el);

  let last = 0;
  let windowStart = 0;
  let frames = 0;
  let worstGap = 0;
  let longFrames = 0; // gaps over 20 ms (a missed 60 Hz frame)
  const tick = (now: number) => {
    if (last) {
      const gap = now - last;
      worstGap = Math.max(worstGap, gap);
      if (gap > 20) longFrames++;
    }
    last = now;
    frames++;
    if (!windowStart) windowStart = now;
    const elapsed = now - windowStart;
    if (elapsed >= REPORT_MS) {
      const perSecond = 1000 / elapsed;
      el.textContent =
        `rAF ${(frames * perSecond).toFixed(0)}/s  avg ${(elapsed / frames).toFixed(1)}ms  worst ${worstGap.toFixed(0)}ms\n` +
        `slow(>20ms) ${(longFrames * perSecond).toFixed(0)}/s  playhead writes ${(perfCounters.playheadWrites * perSecond).toFixed(0)}/s`;
      windowStart = now;
      frames = 0;
      worstGap = 0;
      longFrames = 0;
      perfCounters.playheadWrites = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
