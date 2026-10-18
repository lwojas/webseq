// Waveform overview for the chop editor. Decodes an asset's stored bytes once (the engine keeps
// only its own PCM, not exposed to the app) and reduces it to per-bin peak amplitude. Cached by
// asset id; ids are never reused within a runtime and a reloaded project remaps them.

const BINS = 1024;
const cache = new Map<number, Promise<Float32Array | null>>();

/** Peak |amplitude| (0..1) of `bins` equal spans across all channels. */
export function computePeaks(channels: Float32Array[], bins = BINS): Float32Array {
  const peaks = new Float32Array(bins);
  const length = channels[0]?.length ?? 0;
  if (length === 0) return peaks;
  for (const data of channels) {
    for (let b = 0; b < bins; b++) {
      const from = Math.floor((b * length) / bins);
      const to = Math.max(from + 1, Math.floor(((b + 1) * length) / bins));
      let max = peaks[b];
      for (let i = from; i < to && i < length; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks[b] = max;
    }
  }
  return peaks;
}

/** Peaks for an asset's bytes, or null if they can't be decoded here. Safe to call repeatedly. */
export function loadPeaks(assetId: number, getBytes: () => ArrayBuffer | undefined): Promise<Float32Array | null> {
  let entry = cache.get(assetId);
  if (!entry) {
    const bytes = getBytes();
    entry = bytes ? decodePeaks(bytes) : Promise.resolve(null);
    cache.set(assetId, entry);
  }
  return entry;
}

export function forgetPeaks(assetId: number): void {
  cache.delete(assetId);
}

async function decodePeaks(bytes: ArrayBuffer): Promise<Float32Array | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    // decodeAudioData detaches its input, so decode a copy.
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    return computePeaks(channels);
  } catch {
    return null;
  }
}
