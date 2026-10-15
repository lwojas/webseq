import { INSTRUMENT_DEFS, INSTRUMENT_KINDS, instrumentDefFor } from "../model/instruments";
import { DEFAULT_ENVELOPE } from "../model/types";
import type { Asset, InstrumentKindId, Note, SampleEnvelope, Track } from "../model/types";
import { MAX_NOTE_PITCH, MIN_NOTE_PITCH } from "../model/notes";

interface Props {
  /** The selected track, or null when MASTER is selected (it has no sound source). */
  track: Track | null;
  /** The sample asset the track plays, if any. */
  asset: Asset | null;
  /** How many tracks play `asset` — its envelope is shared between all of them. */
  assetUseCount: number;
  /** The selected note, only when it belongs to `track` in the shown pattern. */
  note: Note | null;
  onSetInstrument: (trackId: string, kind: InstrumentKindId | null) => void;
  onSetInstrumentParam: (trackId: string, paramId: string, value: number) => void;
  onSetEnvelope: (assetId: number, envelope: Partial<SampleEnvelope>) => void;
  onSetNotePitch: (noteId: string, pitch: number) => void;
  onSetNoteVelocity: (noteId: string, velocity: number) => void;
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}

function formatValue(value: number): string {
  return Math.abs(value) < 10 ? value.toFixed(2) : String(Math.round(value));
}

function Slider({ label, min, max, step, value, unit, onChange }: SliderProps) {
  return (
    <div className="module-param">
      <span className="param-label static">{label}</span>
      <div className="range-row">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
        <span className="value">
          {formatValue(value)}
          {unit ?? ""}
        </span>
      </div>
    </div>
  );
}

const ENVELOPE_FIELDS: { id: keyof SampleEnvelope; label: string; max: number; step: number; unit?: string }[] = [
  { id: "attack", label: "Attack", max: 2, step: 0.005, unit: "s" },
  { id: "decay", label: "Decay", max: 2, step: 0.005, unit: "s" },
  { id: "sustain", label: "Sustain", max: 1, step: 0.01 },
  { id: "release", label: "Release", max: 3, step: 0.01, unit: "s" },
];

/** The bottom-panel Instrument tab: contextual to the selected track, like the FX tab, and
 * deliberately not part of the track row — it describes *what a track plays*, which is one thing
 * per track in this app (a sample or one synth), so it edits in place without leaving the
 * track's context. Sample tracks get the sample's ADSR; synth tracks get the instrument's own
 * controls (rendered generically from INSTRUMENT_DEFS). A selected note's pitch/velocity are
 * edited here too, since they are properties of what that track plays. */
export function InstrumentPanel({
  track,
  asset,
  assetUseCount,
  note,
  onSetInstrument,
  onSetInstrumentParam,
  onSetEnvelope,
  onSetNotePitch,
  onSetNoteVelocity,
}: Props) {
  if (!track) {
    return (
      <div className="fx-panel">
        <div className="fx-panel-title">INSTRUMENT</div>
        <div className="fx-panel-empty">Select a track to edit what it plays. MASTER has no instrument.</div>
      </div>
    );
  }

  const def = instrumentDefFor(track);
  const synth = track.instrument ?? null;
  const envelope = asset?.envelope ?? DEFAULT_ENVELOPE;

  return (
    <div className="fx-panel instrument-panel">
      <div className="fx-panel-title">{track.name} — INSTRUMENT</div>

      <div className="track-mode-row">
        <div className="track-mode-group">
          <span className="track-mode-label">Source</span>
          <div className="track-mode-toggle">
            <button className={synth ? "" : "active"} onClick={() => onSetInstrument(track.id, null)} title="Play a loaded sample">
              Sample
            </button>
            <button
              className={synth ? "active" : ""}
              onClick={() => onSetInstrument(track.id, synth ? synth.kind : "kick")}
              title="Play a built-in synthesized instrument"
            >
              Synth
            </button>
          </div>
        </div>
        {synth && (
          <div className="track-mode-group">
            <span className="track-mode-label">Kind</span>
            <div className="track-mode-toggle">
              {INSTRUMENT_KINDS.map((kind) => (
                <button key={kind} className={synth.kind === kind ? "active" : ""} onClick={() => onSetInstrument(track.id, kind)}>
                  {INSTRUMENT_DEFS[kind].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="fx-panel-detail">
        {synth && def && (
          <div className="module-panel">
            <div className="module-panel-header">
              <span className="name">{def.label}</span>
            </div>
            <div className="module-params">
              {def.params.map((p) => (
                <Slider
                  key={p.id}
                  label={p.label}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  unit={p.unit}
                  value={synth.params[p.id] ?? p.default}
                  onChange={(v) => onSetInstrumentParam(track.id, p.id, v)}
                />
              ))}
            </div>
            {def.sustained && <div className="instrument-hint">Sustained: each note's length is its held time.</div>}
          </div>
        )}

        {!synth && asset && (
          <div className="module-panel">
            <div className="module-panel-header">
              <span className="name">{asset.name} — Envelope</span>
              <button className="btn small" onClick={() => onSetEnvelope(asset.id, DEFAULT_ENVELOPE)} title="Reset the envelope to no shaping">
                Reset
              </button>
            </div>
            <div className="module-params">
              {ENVELOPE_FIELDS.map((f) => (
                <Slider
                  key={f.id}
                  label={f.label}
                  min={0}
                  max={f.max}
                  step={f.step}
                  unit={f.unit}
                  value={envelope[f.id]}
                  onChange={(v) => onSetEnvelope(asset.id, { [f.id]: v })}
                />
              ))}
            </div>
            {assetUseCount > 1 && (
              <div className="instrument-hint">The envelope belongs to the sample, so it applies on all {assetUseCount} tracks that play it.</div>
            )}
          </div>
        )}

        {!synth && !asset && (
          <div className="fx-panel-empty">No sound yet — load a sample on this track, or switch Source to Synth.</div>
        )}

        {note && (
          <div className="module-panel">
            <div className="module-panel-header">
              <span className="name">Selected note</span>
            </div>
            <div className="module-params">
              <Slider
                label="Pitch"
                min={MIN_NOTE_PITCH}
                max={MAX_NOTE_PITCH}
                step={1}
                unit="st"
                value={note.pitch ?? 0}
                onChange={(v) => onSetNotePitch(note.id, v)}
              />
              <Slider
                label="Velocity"
                min={0}
                max={1}
                step={0.01}
                value={note.velocity}
                onChange={(v) => onSetNoteVelocity(note.id, v)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
