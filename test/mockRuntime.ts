// A recording stand-in for the parts of AudioRuntime the engine-sync layer touches. Mirrors
// webdsp's real FX-chain bookkeeping closely enough (ids, ordering) to assert on sync results.
import { vi } from "vitest";
import { InstrumentKind, type AudioRuntime } from "webdsp";

export const INSTRUMENT_PARAM_NAMES: Record<string, string[]> = {
  kick: ["tune", "pitchDrop", "pitchDecay", "decay", "punch", "drive"],
  snare: ["tune", "decay", "snap", "noise"],
  bass: ["tune", "body", "bite", "cutoff", "resonance", "attack", "decay", "sustain", "release"],
};
const KIND_IDS: [string, InstrumentKind][] = [
  ["kick", InstrumentKind.Kick],
  ["snare", InstrumentKind.Snare],
  ["bass", InstrumentKind.Bass],
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
  };
  const runtime = {
    setNodeParameter: vi.fn(),
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
    })),
    getInstrumentParams: vi.fn((kind: InstrumentKind) => {
      const id = KIND_IDS.find(([, k]) => k === kind)![0];
      return INSTRUMENT_PARAM_NAMES[id].map((name, i) => ({ id: i, name, min: 0, max: 1, default: 0, unit: "" }));
    }),
    createInstrument: vi.fn((kind: number, opts: { bus?: number } = {}) => {
      const id = nextInstrument++;
      calls.createInstrument.push({ kind, ...opts, id });
      return id;
    }),
    removeInstrument: vi.fn((id: number) => calls.removeInstrument.push(id)),
    setInstrumentParameter: vi.fn((id: number, param: number, value: number) => calls.setInstrumentParameter.push([id, param, value])),
    instrumentNoteOn: vi.fn((id: number, p: Record<string, number>) => calls.instrumentNoteOn.push([id, p])),
    instrumentNoteOff: vi.fn((id: number) => calls.instrumentNoteOff.push(id)),
    setSampleEnvelope: vi.fn((id: number, env: Record<string, number>) => calls.setSampleEnvelope.push([id, env])),
  };
  return { runtime: runtime as unknown as AudioRuntime, calls, chains, raw: runtime };
}
