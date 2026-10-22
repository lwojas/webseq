import { describe, expect, it } from "vitest";
import { NodeParam } from "webdsp";
import { syncBuses } from "../src/audio/busSync";
import { addFx } from "../src/model/fx";
import {
  canRouteTo,
  createInitialProject,
  setTrackMuted,
  setTrackOutput,
  setTrackSend,
  setTrackSendAmount,
  setTrackSoloed,
  setTrackVolume,
} from "../src/model/project";
import { effectiveSendLevel, effectiveTrackGain, faderGain, mainGate, resolvedSend, sendLevel, trackById } from "../src/model/types";
import type { Project } from "../src/model/types";
import { mockRuntime } from "./mockRuntime";

const buses = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`track-${i + 1}`, i + 1]));
const t = (p: Project, id: string) => trackById(p, id)!;
// A, B send to FX = track-4. track-1/2 are sources, track-3 an unrelated track.
const base = (): Project => {
  let p = createInitialProject();
  p = setTrackSend(p, "track-1", "track-4", 0.25);
  p = setTrackSend(p, "track-2", "track-4", 0.75);
  return p;
};

/** What reaches master from each path, given the levels the mixer pushes: a bus's main edge is
 * fader x main gate, its send edge is fader x send level, post-fader. Mirrors the engine. */
function levels(p: Project, id: string) {
  const tr = t(p, id);
  return { main: faderGain(tr) * mainGate(p, tr), send: faderGain(tr) * sendLevel(p, tr) };
}

describe("send amount and post-fader tap", () => {
  it("amount 0 / 0.5 / 1 scale the send; a missing amount reads as 1", () => {
    let p = setTrackSend(createInitialProject(), "track-1", "track-4", 0);
    expect(levels(p, "track-1").send).toBe(0);
    p = setTrackSendAmount(p, "track-1", 0.5);
    expect(levels(p, "track-1").send).toBe(0.5);
    p = setTrackSendAmount(p, "track-1", 1);
    expect(levels(p, "track-1").send).toBe(1);
    const legacy = { ...createInitialProject() };
    legacy.tracks = legacy.tracks.map((tr) => (tr.id === "track-1" ? { ...tr, send: { to: "track-4" } } : tr));
    expect(resolvedSend(legacy, t(legacy, "track-1"))).toEqual({ to: "track-4", amount: 1 });
  });

  it("clamps the amount to 0..1", () => {
    const p = setTrackSend(createInitialProject(), "track-1", "track-4", 7);
    expect(t(p, "track-1").send?.amount).toBe(1);
    expect(setTrackSendAmount(p, "track-1", -3).tracks[0].send?.amount).toBe(0);
  });

  it("the track fader scales its send (post-fader) and the main output together", () => {
    const p = setTrackVolume(base(), "track-1", 0.5);
    expect(levels(p, "track-1")).toEqual({ main: 0.5, send: 0.5 * 0.25 });
  });

  it("two sources keep independent contributions to one FX bus", () => {
    const p = base();
    expect(levels(p, "track-1").send).toBe(0.25);
    expect(levels(p, "track-2").send).toBe(0.75);
    expect(levels(setTrackSendAmount(p, "track-2", 0.1), "track-1").send).toBe(0.25);
  });
});

describe("mute", () => {
  it("a muted source feeds neither its main output nor its send; the other source is unaffected", () => {
    const p = setTrackMuted(base(), "track-1", true);
    expect(levels(p, "track-1")).toEqual({ main: 0, send: 0 });
    expect(levels(p, "track-2").send).toBe(0.75);
    // the shared FX track itself is not muted by a source's mute
    expect(levels(p, "track-4").main).toBe(1);
  });
});

describe("solo", () => {
  it("soloing the FX bus: its return is audible, source mains are gated, source sends still flow", () => {
    const p = setTrackSoloed(base(), "track-4", true);
    expect(levels(p, "track-4").main).toBe(1);
    expect(levels(p, "track-1")).toEqual({ main: 0, send: 0.25 });
    expect(levels(p, "track-2")).toEqual({ main: 0, send: 0.75 });
    expect(levels(p, "track-3")).toEqual({ main: 0, send: 0 });
  });

  it("soloing a source: its main, its send and the FX return are audible; other sources are excluded", () => {
    const p = setTrackSoloed(base(), "track-1", true);
    expect(levels(p, "track-1")).toEqual({ main: 1, send: 0.25 });
    expect(levels(p, "track-4").main).toBe(1);
    expect(levels(p, "track-2")).toEqual({ main: 0, send: 0 });
    expect(levels(p, "track-3").main).toBe(0);
  });

  it("soloing an unrelated track gates both paths of the sources", () => {
    const p = setTrackSoloed(base(), "track-3", true);
    expect(levels(p, "track-1")).toEqual({ main: 0, send: 0 });
    expect(levels(p, "track-4").main).toBe(0);
  });

  it("a muted soloed source does not make the FX return audible", () => {
    const p = setTrackMuted(setTrackSoloed(base(), "track-1", true), "track-1", true);
    expect(levels(p, "track-4").main).toBe(0);
  });

  it("effectiveTrackGain still reports the main output's audible gain", () => {
    const p = setTrackSoloed(base(), "track-4", true);
    expect(effectiveTrackGain(p, t(p, "track-1"))).toBe(0);
    expect(effectiveSendLevel(p, t(p, "track-1"))).toBe(0.25);
  });
});

describe("routing guards", () => {
  it("rejects self, unknown and looping sends, across outputs and sends", () => {
    let p = setTrackSend(createInitialProject(), "track-1", "track-2");
    expect(setTrackSend(p, "track-1", "track-1")).toBe(p);
    expect(setTrackSend(p, "track-1", "nope")).toBe(p);
    expect(setTrackSend(p, "track-2", "track-1")).toBe(p); // 1 -send-> 2 -send-> 1
    expect(setTrackOutput(p, "track-2", "track-1")).toBe(p); // 1 -send-> 2 -out-> 1
    p = setTrackOutput(p, "track-3", "track-1");
    expect(canRouteTo(p, "track-2", "track-3")).toBe(false); // 3 -out-> 1 -send-> 2
    expect(setTrackSend(p, "track-2", "track-3")).toBe(p);
  });

  it("reads a dangling or cyclic stored send as no send", () => {
    const p = createInitialProject();
    p.tracks[0].send = { to: "gone", amount: 1 };
    p.tracks[1].send = { to: "track-3", amount: 1 };
    p.tracks[2].send = { to: "track-2", amount: 1 };
    expect(resolvedSend(p, p.tracks[0])).toBeNull();
    expect(resolvedSend(p, p.tracks[1])).toBeNull();
    expect(resolvedSend(p, p.tracks[2])).toBeNull();
  });

  it("existing output routing still works alongside a send", () => {
    let p = setTrackOutput(createInitialProject(), "track-1", "track-5");
    p = setTrackSend(p, "track-1", "track-4");
    expect(t(p, "track-1").outputTrack).toBe("track-5");
    expect(t(p, "track-1").send?.to).toBe("track-4");
  });

  it("a track without a send serialises exactly as before", () => {
    const p = setTrackSend(setTrackSend(createInitialProject(), "track-1", "track-4"), "track-1", null);
    expect("send" in t(p, "track-1")).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips sends with their amounts through JSON, identically", () => {
    const p = base();
    const back = JSON.parse(JSON.stringify(p)) as Project;
    expect(back).toEqual(p);
    expect(back.tracks.filter((x) => x.send).map((x) => [x.id, x.send])).toEqual([
      ["track-1", { to: "track-4", amount: 0.25 }],
      ["track-2", { to: "track-4", amount: 0.75 }],
    ]);
  });

  it("a project from before sends has none and plays as before", () => {
    const p = createInitialProject();
    expect(p.tracks.every((x) => !("send" in x))).toBe(true);
    expect(p.tracks.every((x) => levels(p, x.id).send === 0 && levels(p, x.id).main === x.volume)).toBe(true);
  });
});

describe("engine sync", () => {
  const params = (raw: ReturnType<typeof mockRuntime>["raw"], param: number) =>
    raw.setNodeParameter.mock.calls.filter(([, p]) => p === param).map(([b, , v]) => [b, v]);

  it("pushes fader, main gate, send target and send amount on separate controls", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, setTrackSoloed(base(), "track-4", true), buses);
    const last = (param: number, bus: number) => params(raw, param).filter(([b]) => b === bus).pop()![1];
    expect(last(NodeParam.BusGain, 1)).toBe(1);
    expect(last(NodeParam.BusMainGain, 1)).toBe(0);
    expect(last(NodeParam.BusSendAmount, 1)).toBe(0.25);
    expect(last(NodeParam.BusMainGain, 4)).toBe(1);
    expect(params(raw, NodeParam.BusSendTarget)).toEqual([[1, 4], [2, 4]]);
  });

  it("mute lands on the fader, so both paths close", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, setTrackMuted(base(), "track-1", true), buses);
    const last = (param: number, bus: number) => params(raw, param).filter(([b]) => b === bus).pop()![1];
    expect(last(NodeParam.BusGain, 1)).toBe(0);
    expect(last(NodeParam.BusMainGain, 1)).toBe(1);
  });

  it("pushes a send destination once, re-points it, and clears it, without duplicates", () => {
    const { runtime, raw } = mockRuntime();
    const p = setTrackSend(createInitialProject(), "track-1", "track-4");
    syncBuses(runtime, p, buses);
    syncBuses(runtime, p, buses);
    syncBuses(runtime, setTrackSend(p, "track-1", "track-5"), buses);
    syncBuses(runtime, setTrackSend(p, "track-1", null), buses);
    expect(params(raw, NodeParam.BusSendTarget)).toEqual([[1, 4], [1, 0], [1, 5], [1, 0]]);
  });

  it("parks changed edges first so swapping a send never trips the engine's loop check", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, setTrackSend(createInitialProject(), "track-1", "track-2"), buses); // 1 -> 2
    raw.setNodeParameter.mockClear();
    syncBuses(runtime, setTrackSend(createInitialProject(), "track-2", "track-1"), buses); // 2 -> 1
    expect(params(raw, NodeParam.BusSendTarget)).toEqual([[1, 0], [2, 1]]);
    expect(params(raw, NodeParam.BusOutput)).toEqual([]);
  });

  it("sends nothing about routing for a project without sends or outputs", () => {
    const { runtime, raw } = mockRuntime();
    syncBuses(runtime, createInitialProject(), buses);
    expect(params(raw, NodeParam.BusSendTarget)).toEqual([]);
    expect(params(raw, NodeParam.BusOutput)).toEqual([]);
  });

  it("leaves track insert FX untouched by sends", () => {
    const withFx = addFx(createInitialProject(), "track-1", "delay");
    const a = mockRuntime();
    const b = mockRuntime();
    syncBuses(a.runtime, withFx, buses);
    syncBuses(b.runtime, setTrackSend(withFx, "track-1", "track-4"), buses);
    expect(b.calls.addEffect.map((x) => [x.bus, x.kind])).toEqual(a.calls.addEffect.map((x) => [x.bus, x.kind]));
  });
});
