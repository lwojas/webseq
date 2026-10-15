import { describe, expect, it } from "vitest";
import { EffectKind, MASTER_BUS, NodeParam } from "webdsp";
import { syncBuses } from "../src/audio/busSync";
import { fxChainsFor } from "../src/audio/fxChain";
import { createInitialProject } from "../src/model/project";
import { addFx, moveFx, removeFx, setFxEnabled, setFxParam } from "../src/model/fx";
import { setAssetEnvelope, setTrackPan } from "../src/model/project";
import { mockRuntime } from "./mockRuntime";

const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));

describe("syncBuses", () => {
  it("creates no engine effects for a project without FX, only volume and pan per track", () => {
    const { runtime, calls, raw } = mockRuntime();
    syncBuses(runtime, createInitialProject(), buses);
    expect(calls.addEffect).toHaveLength(0);
    const gainBuses = new Set(raw.setNodeParameter.mock.calls.filter(([, p]) => p === NodeParam.BusGain).map(([b]) => b));
    expect(gainBuses.size).toBe(64);
    expect(raw.setNodeParameter.mock.calls.some(([, p]) => p === NodeParam.BusPan)).toBe(true);
  });

  it("adds one engine effect per FX, only on the bus that has it", () => {
    const { runtime, calls } = mockRuntime();
    const project = addFx(createInitialProject(), "track-2", "delay");
    syncBuses(runtime, project, buses);
    expect(calls.addEffect.map((a) => [a.bus, a.kind])).toEqual([[2, EffectKind.Delay]]);
  });

  it("stacks two filters as two engine instances and honours order changes", () => {
    const { runtime, calls, chains } = mockRuntime();
    let project = createInitialProject();
    project = addFx(project, "track-1", "filter");
    project = addFx(project, "track-1", "delay");
    project = addFx(project, "track-1", "filter");
    syncBuses(runtime, project, buses);
    expect(calls.addEffect.map((a) => a.kind)).toEqual([EffectKind.Filter, EffectKind.Delay, EffectKind.Filter]);
    const ids = project.tracks[0].fx.map((f) => f.id);
    const engineOrder = [...chains.get(1)!];

    project = moveFx(project, "track-1", ids[2], 0);
    syncBuses(runtime, project, buses);
    expect(chains.get(1)).toEqual([engineOrder[2], engineOrder[0], engineOrder[1]]);
  });

  it("removes only the removed instance and bypasses via setEffectEnabled", () => {
    const { runtime, calls } = mockRuntime();
    let project = addFx(addFx(createInitialProject(), "track-1", "filter"), "track-1", "filter");
    syncBuses(runtime, project, buses);
    const [a, b] = project.tracks[0].fx;
    const engineA = calls.addEffect[0].id;

    project = setFxEnabled(project, "track-1", a.id, false);
    syncBuses(runtime, project, buses);
    expect(calls.setEffectEnabled).toEqual([[1, engineA, false]]);

    project = removeFx(project, "track-1", b.id);
    syncBuses(runtime, project, buses);
    expect(calls.removeEffect).toEqual([[1, calls.addEffect[1].id]]);
  });

  it("pushes every parameter once, then only the ones that change", () => {
    const { runtime, calls } = mockRuntime();
    let project = addFx(createInitialProject(), "track-1", "delay");
    syncBuses(runtime, project, buses);
    expect(calls.setEffectParameter.map((c) => c[2]).sort()).toEqual(
      [NodeParam.DelayTime, NodeParam.DelayFeedback, NodeParam.DelayMix].sort(),
    );
    calls.setEffectParameter.length = 0;
    syncBuses(runtime, project, buses);
    expect(calls.setEffectParameter).toHaveLength(0);

    project = setFxParam(project, "track-1", project.tracks[0].fx[0].id, "mix", 0.4);
    syncBuses(runtime, project, buses);
    expect(calls.setEffectParameter.map((c) => [c[2], c[3]])).toEqual([[NodeParam.DelayMix, 0.4]]);
  });

  it("applies master chain on MASTER_BUS", () => {
    const { runtime, calls } = mockRuntime();
    const project = addFx(createInitialProject(), "master", "saturation");
    syncBuses(runtime, project, buses);
    expect(calls.addEffect.map((a) => a.bus)).toEqual([MASTER_BUS]);
  });

  it("automation writes dedupe, and restoreBase puts the project value back", () => {
    const { runtime, calls } = mockRuntime();
    const project = addFx(createInitialProject(), "track-1", "filter");
    syncBuses(runtime, project, buses);
    const fxId = project.tracks[0].fx[0].id;
    const chains = fxChainsFor(runtime);
    calls.setEffectParameter.length = 0;

    chains.setParam(1, fxId, "cutoff", 500);
    chains.setParam(1, fxId, "cutoff", 500);
    expect(calls.setEffectParameter).toHaveLength(1);
    expect(calls.setEffectParameter[0][2]).toBe(NodeParam.FilterCutoff);

    calls.setEffectParameter.length = 0;
    chains.restoreBase();
    expect(calls.setEffectParameter.map((c) => [c[2], c[3]])).toEqual([[NodeParam.FilterCutoff, 18000]]);
  });

  it("sends track pan as BusPan", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, setTrackPan(createInitialProject(), "track-3", -0.5), buses);
    expect(raw.setNodeParameter).toHaveBeenCalledWith(3, NodeParam.BusPan, -0.5);
  });

  it("pushes a sample envelope only when it differs from the engine default", () => {
    const { runtime, calls } = mockRuntime();
    let project = createInitialProject();
    project = {
      ...project,
      assets: [
        { id: 7, name: "a", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" },
        { id: 8, name: "b", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" },
      ],
    };
    syncBuses(runtime, project, buses);
    expect(calls.setSampleEnvelope).toHaveLength(0);

    project = setAssetEnvelope(project, 8, { attack: 0.2, release: 0.5 });
    syncBuses(runtime, project, buses);
    syncBuses(runtime, project, buses);
    expect(calls.setSampleEnvelope).toEqual([[8, { attack: 0.2, decay: 0, sustain: 1, release: 0.5 }]]);
  });
});
