// Waveform overview for the chop editor. Decodes an asset's stored bytes once (the engine keeps
// only its own PCM, not exposed to the app) and reduces it to per-bin peak amplitude. Cached by
// asset id; ids are never reused within a runtime and a reloaded project remaps them.

import { computePeaks } from "webdsp";

const cache = new Map<number, Promise<Float32Array | null>>();

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
