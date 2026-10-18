// A recording stand-in for the parts of AudioRuntime the engine-sync layer touches. Mirrors
// webdsp's real FX-chain bookkeeping closely enough (ids, ordering) to assert on sync results.
import { vi } from "vitest";
import { InstrumentKind, type AudioRuntime } from "webdsp";

export const INSTRUMENT_PARAM_NAMES: Record<string, string[]> = {
  kick: ["tune", "pitchDrop", "pitchDecay", "decay", "punch", "drive"],
  snare: ["tune", "decay", "snap", "noise"],
  pulse: ["tune", "cutoff", "resonance", "pump", "repeat", "rate", "diffuse", "attack", "release"],
  pad: ["tune", "tone", "movement", "detune", "space", "attack", "release"],
  hypersaw: ["tune", "detune", "spread", "density", "cutoff", "attack", "decay", "sustain", "release"],
  fm: ["tune", "ratio", "timbre", "snap", "tone", "attack", "decay", "sustain", "release", "legato", "slide"],
  bass: ["tune", "body", "bite", "cutoff", "resonance", "attack", "decay", "sustain", "release", "legato", "slide"],
};
// Which mock controls the engine reports as modulation targets (a stand-in for ModDomain tables).
const MODULATABLE = new Set(["bass.tune", "bass.body", "bass.cutoff", "bass.resonance", "pulse.cutoff", "pulse.pump"]);
export const MODULATION_INFO = {
  maxLfos: 4,
  waveforms: ["sine", "triangle", "square", "saw"],
  divisions: ["4 bars", "2 bars", "1/1", "1/2.", "1/2", "1/4.", "1/2T", "1/4", "1/8.", "1/4T", "1/8", "1/16.", "1/8T", "1/16", "1/16T", "1/32"].map(
    (name, i) => ({ name, beats: 16 / 2 ** i }),
  ),
  minRateHz: 0.01,
  maxRateHz: 40,
};
const KIND_IDS: [string, InstrumentKind][] = [
  ["kick", InstrumentKind.Kick],
  ["snare", InstrumentKind.Snare],
  ["bass", InstrumentKind.Bass],
  ["pulse", InstrumentKind.Pulse],
  ["pad", InstrumentKind.Pad],
  ["fm", InstrumentKind.Fm],
  ["hypersaw", InstrumentKind.Hypersaw],
];

export function mockRuntime() {
  let nextEffect = 1;
  let nextInstrument = 1;
  const chains = new Map<number, number[]>();
  const calls = {
    addEffect: [] as { bus: number; kind: number; index?: number; enabled?: boolean; id: number }[],
    removeEffect: [] as [number, number][],
    moveEffect: [] as [number, number, number][],
    setEffectEnabled: [] as [number, number, boolean][],
    setEffectParameter: [] as [number, number, number, number][],
    createInstrument: [] as { kind: number; bus?: number; id: number }[],
    removeInstrument: [] as number[],
    setInstrumentParameter: [] as [number, number, number][],
    instrumentNoteOn: [] as [number, Record<string, number>][],
    instrumentNoteOff: [] as number[],
    setSampleEnvelope: [] as [number, Record<string, number>][],
    setSampleRegions: [] as [number, { start: number; end: number }[]][],
    setInstrumentLfo: [] as [number, number, Record<string, unknown>][],
    clearInstrumentLfo: [] as [number, number][],
  };
  const runtime = {
    setNodeParameter: vi.fn(),
    setTempo: vi.fn(),
    cancelScheduled: vi.fn(),
    addEffect: vi.fn((bus: number, kind: number, opts: { index?: number; enabled?: boolean } = {}) => {
      const id = nextEffect++;
      const chain = chains.get(bus) ?? [];
      chain.splice(opts.index ?? chain.length, 0, id);
      chains.set(bus, chain);
      calls.addEffect.push({ bus, kind, ...opts, id });
      return id;
    }),
    removeEffect: vi.fn((bus: number, id: number) => {
      chains.set(bus, (chains.get(bus) ?? []).filter((e) => e !== id));
      calls.removeEffect.push([bus, id]);
    }),
    moveEffect: vi.fn((bus: number, id: number, index: number) => {
      const chain = (chains.get(bus) ?? []).filter((e) => e !== id);
      chain.splice(index, 0, id);
      chains.set(bus, chain);
      calls.moveEffect.push([bus, id, index]);
    }),
    setEffectEnabled: vi.fn((bus: number, id: number, enabled: boolean) => calls.setEffectEnabled.push([bus, id, enabled])),
    setEffectParameter: vi.fn((bus: number, id: number, param: number, value: number) =>
      calls.setEffectParameter.push([bus, id, param, value]),
    ),
    getCapabilities: vi.fn(() => ({
      sampleRate: 48000,
      outputChannels: 2,
      maxVoices: 64,
      renderQuantumFrames: 128,
      maxCaptureSeconds: 30,
      instruments: KIND_IDS.map(([id, kind]) => ({ kind, id, name: id, category: "drum", params: [] })),
      modulation: MODULATION_INFO,
    })),
    getInstrumentParams: vi.fn((kind: InstrumentKind) => {
      const id = KIND_IDS.find(([, k]) => k === kind)![0];
      return INSTRUMENT_PARAM_NAMES[id].map((name, i) => ({
        id: i, name, min: 0, max: 1, default: 0, unit: "",
        modulation: MODULATABLE.has(`${id}.${name}`) ? "linear" : "none",
      }));
    }),
    getModulationInfo: vi.fn(() => MODULATION_INFO),
    getModulationTargets: vi.fn((kind: InstrumentKind) => {
      const id = KIND_IDS.find(([, k]) => k === kind)![0];
      return INSTRUMENT_PARAM_NAMES[id]
        .map((name, i) => ({ id: i, name, min: 0, max: 1, default: 0, unit: "", modulation: "linear" }))
        .filter((p) => MODULATABLE.has(`${id}.${p.name}`));
    }),
    setInstrumentLfo: vi.fn((id: number, slot: number, lfo: Record<string, unknown>) => calls.setInstrumentLfo.push([id, slot, lfo])),
    clearInstrumentLfo: vi.fn((id: number, slot: number) => calls.clearInstrumentLfo.push([id, slot])),
    createInstrument: vi.fn((kind: number, opts: { bus?: number } = {}) => {
      const id = nextInstrument++;
      calls.createInstrument.push({ kind, ...opts, id });
      return id;
    }),
    removeInstrument: vi.fn((id: number) => calls.removeInstrument.push(id)),
    setInstrumentParameter: vi.fn((id: number, param: number, value: number) => calls.setInstrumentParameter.push([id, param, value])),
    instrumentNoteOn: vi.fn((id: number, p: Record<string, number>) => calls.instrumentNoteOn.push([id, p])),
    instrumentNoteOff: vi.fn((id: number) => calls.instrumentNoteOff.push(id)),
    setSampleRegions: vi.fn((id: number, regions: { start: number; end: number }[]) => calls.setSampleRegions.push([id, regions])),
    setSampleEnvelope: vi.fn((id: number, env: Record<string, number>) => calls.setSampleEnvelope.push([id, env])),
  };
  return { runtime: runtime as unknown as AudioRuntime, calls, chains, raw: runtime };
}
