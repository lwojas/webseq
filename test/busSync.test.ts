import { describe, expect, it, vi } from "vitest";
import { MASTER_BUS, NodeParam, type AudioRuntime } from "webdsp";
import { syncBuses, type ConfiguredBuses } from "../src/audio/busSync";
import { createInitialProject } from "../src/model/project";
import { addFx, removeFx } from "../src/model/fx";
import type { Project } from "../src/model/types";

// Records every bus parameter write, so the test can see which buses were configured at all.
function recordingRuntime() {
  const setNodeParameter = vi.fn();
  return { runtime: { setNodeParameter } as unknown as AudioRuntime, setNodeParameter };
}

const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));

// Buses that received anything other than volume (BusGain) and the master bus.
function configuredBusIds(calls: unknown[][]): Set<number> {
  const ids = new Set<number>();
  for (const [bus, param] of calls as [number, number][]) {
    if (bus !== MASTER_BUS && param !== NodeParam.BusGain) ids.add(bus);
  }
  return ids;
}

describe("syncBuses", () => {
  it("sends only volume to tracks that have never had FX", () => {
    const { runtime, setNodeParameter } = recordingRuntime();
    const configured: ConfiguredBuses = new Set();
    syncBuses(runtime, createInitialProject(), buses, configured);
    expect(configuredBusIds(setNodeParameter.mock.calls)).toEqual(new Set());
    expect(configured.size).toBe(0);
    // Volume still reaches every track bus, so the mixer is right from the start.
    const volumeBuses = new Set(setNodeParameter.mock.calls.filter(([, p]) => p === NodeParam.BusGain).map(([b]) => b));
    expect(volumeBuses.size).toBe(64);
  });

  it("configures only the bus of a track that gains FX", () => {
    const { runtime, setNodeParameter } = recordingRuntime();
    const configured: ConfiguredBuses = new Set();
    const project: Project = addFx(createInitialProject(), "track-2", "delay");
    syncBuses(runtime, project, buses, configured);
    expect(configuredBusIds(setNodeParameter.mock.calls)).toEqual(new Set([2]));
    expect([...configured]).toEqual(["track-2"]);
  });

  it("keeps a track configured after its last FX is removed, so the reset reaches the engine", () => {
    const { runtime, setNodeParameter } = recordingRuntime();
    const configured: ConfiguredBuses = new Set();
    const withFx = addFx(createInitialProject(), "track-2", "delay");
    syncBuses(runtime, withFx, buses, configured);

    const fxId = withFx.tracks[1].fx[0].id;
    const without = removeFx(withFx, "track-2", fxId);
    setNodeParameter.mockClear();
    syncBuses(runtime, without, buses, configured);
    expect(configuredBusIds(setNodeParameter.mock.calls)).toEqual(new Set([2]));
    const delayMix = setNodeParameter.mock.calls.find(([bus, param]) => bus === 2 && param === NodeParam.DelayMix);
    expect(delayMix?.[2]).toBe(0);
  });
});
