import { describe, expect, it } from "vitest";
import { EqBandType } from "webdsp";
import { bandsFromParams, dbToY, freqToX, handleDb, widenedValue, widthParam, xToFreq, yToDb } from "../src/model/eqGeometry";

describe("EQ curve editor geometry", () => {
  it("maps frequency logarithmically across the width and back", () => {
    expect(freqToX(20, 600)).toBeCloseTo(0, 6);
    expect(freqToX(20000, 600)).toBeCloseTo(600, 6);
    expect(freqToX(632.455, 600)).toBeCloseTo(300, 1); // geometric centre of 20..20000
    for (const hz of [25, 440, 8000]) expect(xToFreq(freqToX(hz, 600), 600)).toBeCloseTo(hz, 6);
    expect(xToFreq(-50, 600)).toBe(20);
    expect(xToFreq(9999, 600)).toBe(20000);
  });

  it("maps dB linearly, 0 dB in the middle, clamped to the view", () => {
    expect(dbToY(0, 200)).toBe(100);
    expect(dbToY(18, 200)).toBe(0);
    expect(yToDb(dbToY(-7.5, 200), 200)).toBeCloseTo(-7.5, 9);
    expect(yToDb(-500, 200)).toBe(18);
    expect(yToDb(900, 200)).toBe(-18);
  });

  it("reads bands from flat FX params with defaults for missing keys", () => {
    const bands = bandsFromParams({ b2On: 1, b2Freq: 1234, b2Gain: -4, b4Type: 4, b4Slope: 24 });
    expect(bands).toHaveLength(4);
    expect(bands[0].enabled).toBe(false);
    expect(bands[1]).toMatchObject({ enabled: true, type: EqBandType.Bell, frequency: 1234, gain: -4 });
    expect(bands[3]).toMatchObject({ type: EqBandType.HighPass, slope: 24 });
  });

  it("puts gainless bands on the 0 dB line and exposes the right width control", () => {
    const [low, , , high] = bandsFromParams({ b1Gain: 6, b4Type: 3, b4Gain: 9 });
    expect(handleDb(low)).toBe(6);
    expect(handleDb(high)).toBe(0);
    expect(widthParam(EqBandType.Bell)).toBe("q");
    expect(widthParam(EqBandType.Notch)).toBe("q");
    expect(widthParam(EqBandType.HighShelf)).toBe("shelfSlope");
    expect(widthParam(EqBandType.LowPass)).toBeNull();
  });

  it("widens/narrows within the engine's ranges", () => {
    expect(widenedValue(EqBandType.Bell, 1, 1)).toBeLessThan(1);
    expect(widenedValue(EqBandType.Bell, 1, -1)).toBeGreaterThan(1);
    expect(widenedValue(EqBandType.Bell, 1, 99)).toBe(0.1);
    expect(widenedValue(EqBandType.Bell, 1, -99)).toBe(18);
    expect(widenedValue(EqBandType.LowShelf, 0.5, -99)).toBe(1);
  });
});
