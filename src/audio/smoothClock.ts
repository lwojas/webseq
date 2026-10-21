// The audio clock (AudioContext.currentTime) only advances in whole render/hardware buffers, which
// on phones (and over Bluetooth) is tens of milliseconds, so a playhead read straight from it
// changes ~25 times a second no matter how fast the screen refreshes. This wraps a stepped clock
// with a free-running one (performance.now) to give a value that advances every frame.
//
// `source - perf` is a sawtooth that sits below its true value by up to one buffer, so the running
// maximum of it is the true offset between the two clocks; adding the current perf time to that
// gives an estimate that never lags the source by more than a hair and never runs ahead of it by
// more than a buffer. The offset decays very slowly so the two clocks can drift apart, and snaps
// when the source jumps (context suspended/resumed, tab throttled). The result never goes backwards
// except on such a snap.
//
// UI only: scheduling must keep reading the real clock.
export function createSmoothClock(
  source: () => number,
  perfNow: () => number,
  driftPerSecond = 0.0005,
  resyncGap = 0.25,
): () => number {
  let offset = NaN;
  let lastPerf = 0;
  let lastValue = -Infinity;
  return () => {
    const s = source();
    const p = perfNow();
    const raw = s - p;
    if (Number.isNaN(offset) || Math.abs(raw - offset) > resyncGap) {
      offset = raw;
      lastValue = -Infinity;
    } else {
      offset = Math.max(raw, offset - Math.max(0, p - lastPerf) * driftPerSecond);
    }
    lastPerf = p;
    lastValue = Math.max(lastValue, p + offset);
    return lastValue;
  };
}
