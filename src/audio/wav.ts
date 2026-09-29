// Encodes captured PCM (armCapture()'s planar Float32Array channel data) as a 16-bit PCM WAV
// file — the smallest extension persistence needs to store a resampled Asset (see project
// brief section 16). This lets a resampled asset's bytes flow through the exact same
// saveProject/loadProject/runtime.loadSample() pipeline an imported file already uses: WAV is
// universally decodable by the browser's own decodeAudioData, so there is no separate
// "raw PCM" storage/reload path to build or branch on elsewhere in this app. 16-bit (not
// 32-bit float) is used for the broadest decoder compatibility, at the cost of a little
// quantization — acceptable for a resampled, already-mixed-down capture, and irrelevant to an
// imported asset's own bytes, which are never re-encoded.

const BYTES_PER_SAMPLE = 2; // 16-bit PCM

function clampToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff));
}

/** `channelData` must be equal-length planar Float32Arrays, one per channel — exactly the
 * shape armCapture()'s resolved `channelData` (converted from ArrayBuffer) is already in. */
export function encodeWav(channelData: Float32Array[], sampleRate: number): ArrayBuffer {
  const numChannels = Math.max(1, channelData.length);
  const numFrames = channelData[0]?.length ?? 0;
  const blockAlign = numChannels * BYTES_PER_SAMPLE;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, clampToInt16(channelData[c][frame]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return buffer;
}
