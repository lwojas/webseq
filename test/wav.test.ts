import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/audio/wav";

// No real decodeAudioData under vitest/node (see webdsp's own "deliberately not unit-tested"
// convention for anything needing a real AudioContext), so this stays at the byte-format
// level: read the WAV header/data back by hand and check it round-trips.
function readString(view: DataView, offset: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav", () => {
  it("writes a canonical 16-bit PCM WAV header", () => {
    const channelData = [new Float32Array([0, 0.5, -0.5, 1, -1])];
    const buffer = encodeWav(channelData, 48000);
    const view = new DataView(buffer);

    expect(readString(view, 0, 4)).toBe("RIFF");
    expect(readString(view, 8, 4)).toBe("WAVE");
    expect(readString(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM format code
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readString(view, 36, 4)).toBe("data");

    const dataSize = view.getUint32(40, true);
    expect(dataSize).toBe(channelData[0].length * 2);
    expect(buffer.byteLength).toBe(44 + dataSize);
  });

  it("interleaves multi-channel data and round-trips sample values within 16-bit quantization", () => {
    const left = new Float32Array([1, -1, 0]);
    const right = new Float32Array([0.5, -0.5, 0.25]);
    const buffer = encodeWav([left, right], 44100);
    const view = new DataView(buffer);

    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 2); // byte rate = sampleRate * blockAlign
    expect(view.getUint16(32, true)).toBe(4); // blockAlign = channels * bytesPerSample

    const readSample = (frame: number, channel: number) =>
      view.getInt16(44 + (frame * 2 + channel) * 2, true) / 0x7fff;

    expect(readSample(0, 0)).toBeCloseTo(1, 3);
    expect(readSample(0, 1)).toBeCloseTo(0.5, 3);
    expect(readSample(1, 0)).toBeCloseTo(-1, 3);
    expect(readSample(1, 1)).toBeCloseTo(-0.5, 3);
    expect(readSample(2, 0)).toBeCloseTo(0, 3);
    expect(readSample(2, 1)).toBeCloseTo(0.25, 3);
  });

  it("clamps out-of-range samples instead of wrapping/overflowing", () => {
    const buffer = encodeWav([new Float32Array([2, -2])], 48000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
