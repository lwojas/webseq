// The unified modulation model: automation + LFO stacks on FX, synth and sample parameters,
// the Utility FX, and automation templates. Engine-facing parts run against the recording mock.
import { describe, expect, it } from "vitest";
import { EffectKind, NodeParam, SampleParam } from "webdsp";
import { laneEvents, laneStateAt, restoreAutomation, scheduleAutomation, startAutomation } from "../src/audio/automation";
import { syncBuses } from "../src/audio/busSync";
import { compileNote } from "../src/audio/compile";
import { addFx, addFxLfo, FX_DEFS, removeFxLfo, setFxLfo, setFxParam } from "../src/model/fx";
import { addInstrumentLfo, setTrackInstrument } from "../src/model/instruments";
import { findLane, replaceAutomationRange, setAutomationPoint, valueAtBeat } from "../src/model/automation";
import { AUTOMATION_TEMPLATES, applyTemplate, templateRegion } from "../src/model/automationTemplates";
import { fxParamDefs, laneParamDef, normalizedToValue, scaleFor, sourceParamDefs, valueToNormalized } from "../src/model/modulation";
import { projectReducer } from "../src/model/reducer";
import { addAsset, assignAsset, createInitialProject } from "../src/model/project";
import { cloneFxChain } from "../src/model/trackConfig";
import type { Asset, AutomationLane, Note, Project } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const last = <T,>(a: readonly T[]): T => a[a.length - 1];
const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));
const getBusId = (t: string) => (t === "master" ? 0 : buses[t]);

function sampleAsset(id: number): Asset {
  return { id, name: "s", type: "audio", duration: 1, sampleRate: 48000, channels: 1, origin: "import" };
}

describe("FX LFO stack", () => {
  it("adds, edits (clamped) and removes LFOs per FX instance, up to four", () => {
    let p = addFx(addFx(createInitialProject(), "track-1", "filter"), "track-1", "delay");
    const [filter, delay] = p.tracks[0].fx;
    for (let i = 0; i < 6; i++) p = addFxLfo(p, "track-1", filter.id, "cutoff");
    expect(p.tracks[0].fx[0].lfos).toHaveLength(4);
    expect(p.tracks[0].fx[1].lfos).toBeUndefined();

    p = setFxLfo(p, "track-1", filter.id, 1, { amount: 5, rateHz: 999, phase: -1 });
    expect(p.tracks[0].fx[0].lfos![1]).toMatchObject({ amount: 1, rateHz: 40, phase: 0 });

    p = removeFxLfo(p, "track-1", filter.id, 0);
    expect(p.tracks[0].fx[0].lfos).toHaveLength(3);
    for (let i = 0; i < 3; i++) p = removeFxLfo(p, "track-1", filter.id, 0);
    expect(p.tracks[0].fx[0].lfos).toBeUndefined(); // empty stack is dropped, not left as []
    expect(delay.id).not.toBe(filter.id);
  });

  it("works on the master chain too", () => {
    let p = addFx(createInitialProject(), "master", "reverb");
    p = addFxLfo(p, "master", p.master.fx[0].id, "mix");
    expect(p.master.fx[0].lfos).toHaveLength(1);
  });

  it("travels with a cloned FX chain (copy/paste) without sharing the array", () => {
    let p = addFx(createInitialProject(), "track-1", "delay");
    p = addFxLfo(p, "track-1", p.tracks[0].fx[0].id, "mix");
    const { fx } = cloneFxChain(p.tracks[0].fx, []);
    expect(fx[0].lfos).toEqual(p.tracks[0].fx[0].lfos);
    expect(fx[0].lfos).not.toBe(p.tracks[0].fx[0].lfos);
  });
});

describe("Utility FX", () => {
  it("is a one-parameter gain in dB whose neutral value is unity", () => {
    expect(FX_DEFS.utility.params).toHaveLength(1);
    const gain = FX_DEFS.utility.params[0];
    expect(gain).toMatchObject({ id: "gain", unit: "dB", default: 0, min: -60, max: 12 });
  });

  it("maps to the engine's Utility kind and gain param", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "utility");
    p = setFxParam(p, "track-1", p.tracks[0].fx[0].id, "gain", -6);
    syncBuses(runtime, p, buses);
    expect(calls.addEffect.map((a) => a.kind)).toEqual([EffectKind.Utility]);
    expect(calls.setEffectParameter).toContainEqual([1, calls.addEffect[0].id, NodeParam.UtilityGain, -6]);
  });
});

describe("FX LFOs reach the engine", () => {
  it("sends each LFO once, resolved against the engine's own names", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "delay");
    const id = p.tracks[0].fx[0].id;
    p = addFxLfo(p, "track-1", id, "mix");
    p = addFxLfo(p, "track-1", id, "mix"); // two LFOs on the same parameter
    syncBuses(runtime, p, buses);
    syncBuses(runtime, p, buses); // idempotent
    expect(calls.setEffectLfo).toHaveLength(2);
    expect(calls.setEffectLfo.map(([, , slot]) => slot)).toEqual([0, 1]);
    expect(calls.setEffectLfo[0][3]).toMatchObject({ target: 101, waveform: 0, sync: false });
  });

  it("leaves a slot off for a target the engine does not offer, and clears removed LFOs", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "delay");
    const id = p.tracks[0].fx[0].id;
    p = addFxLfo(p, "track-1", id, "time"); // delay time is not a modulation target
    syncBuses(runtime, p, buses);
    expect(calls.setEffectLfo).toHaveLength(0);

    p = addFxLfo(p, "track-1", id, "feedback");
    syncBuses(runtime, p, buses);
    expect(calls.setEffectLfo).toHaveLength(1);
    p = removeFxLfo(p, "track-1", id, 1);
    syncBuses(runtime, p, buses);
    expect(calls.clearEffectLfo).toEqual([[1, calls.addEffect[0].id, 1]]);
  });
});

describe("automation targets any parameter", () => {
  it("lists FX, synth and sample parameters through one description", () => {
    expect(fxParamDefs({ type: "filter" }).find((d) => d.id === "cutoff")).toMatchObject({ scale: "log" });
    expect(fxParamDefs({ type: "utility" })[0].scale).toBe("linear");
    let p = setTrackInstrument(createInitialProject(), "track-1", "bass");
    expect(sourceParamDefs(p.tracks[0]).some((d) => d.id === "cutoff")).toBe(true);
    p = assignAsset(addAsset(p, sampleAsset(7)), "track-2", 7);
    expect(sourceParamDefs(p.tracks[1]).map((d) => d.id)).toEqual(["pitch", "attack", "decay", "sustain", "release"]);
    expect(sourceParamDefs({ instrument: null, assetId: null })).toEqual([]);
  });

  it("scale: Hz / seconds are log, everything else linear; mapping round-trips", () => {
    expect(scaleFor({ min: 40, unit: "Hz" })).toBe("log");
    expect(scaleFor({ min: 0, unit: "s" })).toBe("linear");
    expect(scaleFor({ min: 0.1, unit: "Q" })).toBe("linear");
    const def = { min: 40, max: 18000, scale: "log" as const };
    for (const t of [0, 0.25, 0.5, 1]) expect(valueToNormalized(def, normalizedToValue(def, t))).toBeCloseTo(t, 6);
    expect(normalizedToValue(def, 0.5)).toBeCloseTo(Math.sqrt(40 * 18000), 3);
  });

  it("source lanes are stored without an fxId, beside FX lanes, and found again", () => {
    let p = setTrackInstrument(createInitialProject(), "track-1", "bass");
    p = addFx(p, "track-1", "filter");
    const fxId = p.tracks[0].fx[0].id;
    p = setAutomationPoint(p, "track-1", null, "cutoff", 0, 300);
    p = setAutomationPoint(p, "track-1", fxId, "cutoff", 0, 900); // same name, different owner
    expect(p.tracks[0].automation).toHaveLength(2);
    expect(findLane(p.tracks[0].automation, null, "cutoff")!.events[0].value).toBe(300);
    expect(findLane(p.tracks[0].automation, fxId, "cutoff")!.events[0].value).toBe(900);
    expect(laneParamDef(p.tracks[0], findLane(p.tracks[0].automation, null, "cutoff")!)?.id).toBe("cutoff");
    expect(findLane(p.tracks[0].automation, null, "cutoff")).not.toHaveProperty("fxId");
  });

  it("drops source lanes the new source cannot honour, keeps FX lanes", () => {
    let p = setTrackInstrument(createInitialProject(), "track-1", "bass");
    p = addFx(p, "track-1", "filter");
    p = setAutomationPoint(p, "track-1", null, "cutoff", 0, 300);
    p = setAutomationPoint(p, "track-1", p.tracks[0].fx[0].id, "cutoff", 0, 900);
    p = projectReducer(p, { type: "SET_TRACK_INSTRUMENT", trackId: "track-1", kind: "kick" }); // kick has no cutoff
    expect(p.tracks[0].automation).toHaveLength(1);
    expect(p.tracks[0].automation[0].fxId).toBeDefined();
    // Same-named control survives a kind change that still has it.
    let q = setTrackInstrument(createInitialProject(), "track-1", "bass");
    q = setAutomationPoint(q, "track-1", null, "tune", 0, 50);
    q = projectReducer(q, { type: "SET_TRACK_INSTRUMENT", trackId: "track-1", kind: "pulse" });
    expect(q.tracks[0].automation).toHaveLength(1);
  });

  it("replaces only a range of a lane", () => {
    let p = createInitialProject();
    for (const [pos, v] of [[0, 1], [4, 2], [8, 3], [12, 4]] as const) p = setAutomationPoint(p, "track-1", "f", "x", pos, v);
    p = replaceAutomationRange(p, "track-1", "f", "x", 4, 8, [{ position: 5, value: 9 }]);
    expect(p.tracks[0].automation[0].events.map((e) => [e.position, e.value])).toEqual([[0, 1], [5, 9], [12, 4]]);
    p = replaceAutomationRange(p, "track-1", "f", "x", 0, 16, []);
    expect(p.tracks[0].automation).toHaveLength(0);
  });
});

describe("lane events (pure)", () => {
  const lane = (...pts: [number, number][]): AutomationLane => ({ parameter: "x", events: pts.map(([position, value]) => ({ position, value })) });

  it("holds before the first point, ramps each segment, holds after the last", () => {
    expect(laneEvents(lane([4, 1], [8, 3]))).toEqual([
      { pos: 0, value: 1 },
      { pos: 4, from: 1, value: 3, rampBeats: 4 },
      { pos: 8, value: 3 },
    ]);
    expect(laneEvents(lane([0, 1], [4, 1]))).toEqual([{ pos: 0, value: 1 }, { pos: 4, value: 1 }]); // equal values: steps, no ramp
    expect(laneEvents(lane([0, 5]))).toEqual([{ pos: 0, value: 5 }]);
    expect(laneEvents(lane())).toEqual([]);
  });

  it("describes where a lane is at a beat: the value, and the rest of the ramp it is in", () => {
    const l = lane([0, 0], [8, 8], [12, 8]);
    expect(laneStateAt(l, 2)).toEqual({ pos: 2, from: 2, value: 8, rampBeats: 6 });
    expect(laneStateAt(l, 10)).toEqual({ pos: 10, value: 8 }); // flat segment
    expect(laneStateAt(l, 99)).toEqual({ pos: 99, value: 8 }); // after the last point
    expect(laneStateAt(lane(), 1)).toBeNull();
  });
});

describe("scheduling automation on the audio clock", () => {
  const SPB = 0.5; // 120 BPM
  const win = (start: number, beats = 16) => ({ startTime: start, endTime: start + beats * SPB });

  it("FX: a segment is one ramp from its start value, LFOs stay attached, and a later window adds the closing step", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "master", "delay");
    const id = p.master.fx[0].id;
    p = addFxLfo(p, "master", id, "mix");
    p = setAutomationPoint(p, "master", id, "mix", 0, 0.2);
    p = setAutomationPoint(p, "master", id, "mix", 4, 0.6);
    syncBuses(runtime, p, buses);
    const effect = calls.addEffect[0].id;
    startAutomation(runtime, 10);

    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    expect(calls.scheduleParams).toEqual([[{ time: 10, target: { effect: { bus: 0, effect } }, param: NodeParam.DelayMix, value: 0.6, from: 0.2, ramp: 2 }]]);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 10.05, 10.1);
    expect(calls.scheduleParams).toHaveLength(1); // the same window is never scheduled twice
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 11.9, 12.1);
    expect(calls.scheduleParams[1]).toEqual([{ time: 12, target: { effect: { bus: 0, effect } }, param: NodeParam.DelayMix, value: 0.6 }]);
    expect(calls.setEffectLfo).toHaveLength(1);
    expect(calls.clearEffectLfo).toHaveLength(0);
    expect(calls.setEffectParameter.some((c) => c[3] === 0.6)).toBe(false); // automation never writes directly any more
  });

  it("replays the lane from its start in every step iteration", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-3", "utility");
    const id = p.tracks[2].fx[0].id;
    p = setAutomationPoint(p, "track-3", id, "gain", 0, 0);
    p = setAutomationPoint(p, "track-3", id, "gain", 8, -60);
    syncBuses(runtime, p, buses);
    startAutomation(runtime, 10);
    scheduleAutomation(runtime, p, getBusId, [win(10, 8), win(14, 8)], SPB, 9.95, 14.1);
    const times = calls.scheduleParams.flat().map((e) => e.time);
    expect(times).toEqual([10, 14]); // iteration 2 starts again from its own start
    expect(calls.scheduleParams[0][0]).toMatchObject({ param: NodeParam.UtilityGain, from: 0, value: -60, ramp: 4, target: { effect: { bus: 3 } } });
  });

  it("an edited lane is refreshed at once from the current position, replacing a ramp already running", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "utility");
    const id = p.tracks[0].fx[0].id;
    p = setAutomationPoint(p, "track-1", id, "gain", 0, 0);
    p = setAutomationPoint(p, "track-1", id, "gain", 8, -40);
    syncBuses(runtime, p, buses);
    startAutomation(runtime, 10);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    calls.scheduleParams.length = 0;

    // The user moves the end point 1 s (2 beats) in: the lane (new data) says -20 dB there, ramping on to -80.
    p = setAutomationPoint(p, "track-1", id, "gain", 8, -80);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 11, 11.1);
    const [refresh] = calls.scheduleParams[0];
    expect(refresh).toMatchObject({ time: 11, from: -20, value: -80, ramp: 3 });
    // An unedited lane is not refreshed again.
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 11.05, 11.2);
    expect(calls.scheduleParams).toHaveLength(1);
  });

  it("synth: schedules against the live instrument's control, LFOs coexist, stopping restores the project value", () => {
    const { runtime, calls } = mockRuntime();
    let p = setTrackInstrument(createInitialProject(), "track-1", "bass");
    p = addInstrumentLfo(p, "track-1", "cutoff");
    p = setAutomationPoint(p, "track-1", null, "cutoff", 0, 100);
    p = setAutomationPoint(p, "track-1", null, "cutoff", 8, 300);
    syncBuses(runtime, p, buses);
    expect(calls.setInstrumentLfo[0][2]).toMatchObject({ target: 3 }); // the LFO, on cutoff (id 3)
    startAutomation(runtime, 10);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    expect(calls.scheduleParams[0]).toEqual([{ time: 10, target: { instrument: 1 }, param: 3, value: 300, from: 100, ramp: 4 }]);
    calls.setInstrumentParameter.length = 0;
    syncBuses(runtime, p, buses); // a project edit mid-playback must not knock the automated value back
    expect(calls.setInstrumentParameter).toHaveLength(0);

    restoreAutomation(runtime, p);
    expect(last(calls.setInstrumentParameter)).toEqual([1, 3, p.tracks[0].instrument!.params.cutoff]);
  });

  it("sample: envelope lanes target the asset's SampleParam, and stopping restores its envelope", () => {
    const { runtime, calls } = mockRuntime();
    let p = assignAsset(addAsset(createInitialProject(), sampleAsset(7)), "track-1", 7);
    p = setAutomationPoint(p, "track-1", null, "release", 0, 0.1);
    p = setAutomationPoint(p, "track-1", null, "release", 8, 0.5);
    startAutomation(runtime, 10);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    expect(calls.scheduleParams[0]).toEqual([{ time: 10, target: { sample: 7 }, param: SampleParam.EnvRelease, value: 0.5, from: 0.1, ramp: 4 }]);
    restoreAutomation(runtime, p);
    expect(last(calls.setSampleEnvelope)![0]).toBe(7);
  });

  it("stopping restores an FX parameter that was only ever scheduled, not written directly", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "utility");
    const id = p.tracks[0].fx[0].id;
    p = setFxParam(p, "track-1", id, "gain", -3);
    p = setAutomationPoint(p, "track-1", id, "gain", 0, 0);
    syncBuses(runtime, p, buses);
    startAutomation(runtime, 10);
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    calls.setEffectParameter.length = 0;
    restoreAutomation(runtime, p);
    expect(calls.setEffectParameter).toEqual([[1, calls.addEffect[0].id, NodeParam.UtilityGain, -3]]);
  });

  it("does nothing for lanes whose target is not live yet", () => {
    const { runtime, calls } = mockRuntime();
    let p = addFx(createInitialProject(), "track-1", "utility");
    p = setAutomationPoint(p, "track-1", p.tracks[0].fx[0].id, "gain", 0, 0);
    startAutomation(runtime, 10); // no syncBuses: no engine effect exists
    scheduleAutomation(runtime, p, getBusId, [win(10)], SPB, 9.95, 10.1);
    expect(calls.scheduleParams).toHaveLength(0);
  });

  it("sample pitch lane transposes each note by the lane's value at its position", () => {
    let p = assignAsset(addAsset(createInitialProject(), sampleAsset(7)), "track-1", 7);
    p = setAutomationPoint(p, "track-1", null, "pitch", 0, 0);
    p = setAutomationPoint(p, "track-1", null, "pitch", 8, 12);
    const note = (start: number, pitch?: number): Note => ({ id: "n", trackId: "track-1", start, duration: 1, velocity: 1, ...(pitch ? { pitch } : {}) });
    expect(compileNote(p.tracks[0], note(0), 120, 0)!.pitch).toBeUndefined();
    expect(compileNote(p.tracks[0], note(4), 120, 0)!.pitch).toBeCloseTo(6);
    expect(compileNote(p.tracks[0], note(4, 3), 120, 0)!.pitch).toBeCloseTo(9);
    // No lane: unchanged behaviour.
    expect(compileNote({ ...p.tracks[0], automation: [] }, note(4, 3), 120, 0)!.pitch).toBe(3);
  });
});

describe("automation templates", () => {
  const cutoff = { min: 40, max: 18000, scale: "log" as const, step: 1, default: 18000, unit: "Hz" };
  const gain = { min: -60, max: 12, scale: "linear" as const, step: 0.1, default: 0, unit: "dB" };
  const tpl = (id: string) => AUTOMATION_TEMPLATES.find((t) => t.id === id)!;
  const BPB = 16;

  it("regions: whole sequence, first bar, last bar; a one-bar sequence has one region", () => {
    expect(templateRegion("all", 64, BPB)).toEqual({ from: 0, to: 64 });
    expect(templateRegion("start", 64, BPB)).toEqual({ from: 0, to: 16 });
    expect(templateRegion("end", 64, BPB)).toEqual({ from: 48, to: 64 });
    for (const r of ["all", "start", "end"] as const) expect(templateRegion(r, 16, BPB)).toEqual({ from: 0, to: 16 });
  });

  it("a ramp spans exactly its region at the parameter's min and max", () => {
    for (const [total, range, from, to] of [[16, "all", 0, 16], [64, "all", 0, 64], [64, "start", 0, 16], [64, "end", 48, 64]] as const) {
      const r = applyTemplate(tpl("rampUp"), range, gain, total, BPB);
      expect([r.from, r.to]).toEqual([from, to]);
      expect(r.events[0]).toEqual({ position: from, value: -60 });
      expect(last(r.events)).toEqual({ position: to, value: 12 });
    }
  });

  it("is deterministic and keeps every point inside the region, strictly increasing, within range", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      for (const [total, range] of [[16, "all"], [64, "all"], [64, "start"], [64, "end"], [128, "all"]] as const) {
        for (const def of [cutoff, gain]) {
          const a = applyTemplate(t, range, def, total, BPB);
          expect(applyTemplate(t, range, def, total, BPB)).toEqual(a);
          expect(a.events.length).toBeGreaterThan(1);
          for (let i = 0; i < a.events.length; i++) {
            const e = a.events[i];
            expect(e.position).toBeGreaterThanOrEqual(a.from);
            expect(e.position).toBeLessThanOrEqual(a.to);
            expect(e.value).toBeGreaterThanOrEqual(def.min);
            expect(e.value).toBeLessThanOrEqual(def.max);
            if (i > 0) expect(e.position).toBeGreaterThan(a.events[i - 1].position);
          }
        }
      }
    }
  });

  it("fades on a dB gain start/end at unity, not at the boost maximum; other params use full range", () => {
    const out = applyTemplate(tpl("fadeOut"), "all", gain, 16, BPB).events;
    expect(out[0].value).toBe(0);
    expect(last(out).value).toBe(-60);
    expect(applyTemplate(tpl("fadeIn"), "all", cutoff, 16, BPB).events.pop()!.value).toBe(18000);
    expect(applyTemplate(tpl("rampUp"), "all", gain, 16, BPB).events.pop()!.value).toBe(12); // ramps use the full range
  });

  it("log parameters ramp exponentially: the midpoint is the geometric mean", () => {
    const r = applyTemplate(tpl("rampUp"), "all", cutoff, 16, BPB);
    const lane = { parameter: "cutoff", events: r.events };
    expect(valueAtBeat(lane, 8)!).toBeCloseTo(Math.sqrt(40 * 18000), -1);
  });

  it("cyclic shapes scale with the region's bars; pulse has real jumps", () => {
    const one = applyTemplate(tpl("wobble"), "all", gain, 16, BPB).events.length;
    const four = applyTemplate(tpl("wobble"), "all", gain, 64, BPB).events.length;
    expect(four).toBeGreaterThan(one * 3);
    const pulse = applyTemplate(tpl("pulse"), "all", gain, 16, BPB).events;
    const lane = { parameter: "gain", events: pulse };
    expect(valueAtBeat(lane, 0)).toBe(12);
    expect(valueAtBeat(lane, 1)).toBe(12);
    expect(valueAtBeat(lane, 2)).toBe(12);
    expect(valueAtBeat(lane, 2.25)).toBe(-60); // a real step, one grid unit wide
    expect(valueAtBeat(lane, 3)).toBe(-60);
    expect(valueAtBeat(lane, 4.5)).toBe(12);
  });

  it("applying to the last bar leaves the rest of the lane intact", () => {
    let p = createInitialProject();
    p = setAutomationPoint(p, "track-1", "f", "x", 0, 5);
    const r = applyTemplate(tpl("rampDown"), "end", gain, 64, BPB);
    p = replaceAutomationRange(p, "track-1", "f", "x", r.from, r.to, r.events);
    const lane = p.tracks[0].automation[0];
    expect(lane.events[0]).toEqual({ position: 0, value: 5 });
    expect(lane.events[1]).toEqual({ position: 48, value: 12 });
    expect(last(lane.events)).toEqual({ position: 64, value: -60 });
  });

  it("every FX parameter can take every template (smoke over the whole registry)", () => {
    for (const fx of Object.values(FX_DEFS)) {
      for (const def of fxParamDefs({ type: fx.type }).filter((d) => !d.options)) {
        for (const t of AUTOMATION_TEMPLATES) {
          const r = applyTemplate(t, "all", def, 32, BPB);
          expect(r.events.every((e) => Number.isFinite(e.value))).toBe(true);
        }
      }
    }
  });
});

describe("existing behaviour is unchanged", () => {
  it("a project with no LFOs or source lanes syncs exactly as before (no LFO calls)", () => {
    const { runtime, calls } = mockRuntime();
    let p: Project = addFx(createInitialProject(), "track-1", "filter");
    p = setFxParam(p, "track-1", p.tracks[0].fx[0].id, "cutoff", 800);
    syncBuses(runtime, p, buses);
    expect(calls.setEffectLfo).toHaveLength(0);
    expect(calls.clearEffectLfo).toHaveLength(0);
  });
});
