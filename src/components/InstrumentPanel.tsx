import { INSTRUMENT_DEFS, INSTRUMENT_KINDS, instrumentDefFor } from "../model/instruments";
import { ModBadge, ModulationSlot, modulationBadges, type AutomationUi, type ModulationUi } from "./ModulationSlot";
import { ChopEditor } from "./ChopEditor";
import { effectiveSampleMode } from "../model/chop";
import { DEFAULT_ENVELOPE, effectiveChokeGroup, effectivePlaybackMode, effectiveVoiceMode } from "../model/types";
import type { Asset, InstrumentKindId, PlaybackMode, SampleEnvelope, SampleMode, Track, TrackLfo, VoiceMode } from "../model/types";

interface Props {
  /** The selected track, or null when MASTER is selected (it has no sound source). */
  track: Track | null;
  /** The sample asset the track plays, if any. */
  asset: Asset | null;
  /** How many tracks play `asset` — its envelope is shared between all of them. */
  assetUseCount: number;
  onSetInstrument: (trackId: string, kind: InstrumentKindId | null) => void;
  onSetInstrumentParam: (trackId: string, paramId: string, value: number) => void;
  /** Engine-reported modulation options for the selected synth, or null before the engine exists
   * (the modulation slot then stays hidden). */
  modulation: ModulationUi | null;
  onAddLfo: (trackId: string, target: string) => void;
  onSetLfo: (trackId: string, index: number, patch: Partial<TrackLfo>) => void;
  onRemoveLfo: (trackId: string, index: number) => void;
  onSetEnvelope: (assetId: number, envelope: Partial<SampleEnvelope>) => void;
  /** Automation of the track's source parameters (synth controls, or a sample's envelope / pitch),
   * or undefined before there is anything to automate. */
  automation?: AutomationUi;
  /** Sample playback (one-shot/loop) and voice (poly/mono): properties of the sound source, so they
   * live here beside Source/Kind rather than in the FX tab. Synth tracks are always one monophonic
   * instance (see audio/instruments.ts), so neither applies to them. */
  onSetPlaybackMode: (trackId: string, mode: PlaybackMode) => void;
  onSetVoiceMode: (trackId: string, mode: VoiceMode) => void;
  /** Choke group (null = none): playing this track cuts off the other tracks in the same group. */
  onSetChokeGroup: (trackId: string, group: number | null) => void;
  /** Chromatic (pitch transposes) vs chop (pitch picks a slice) for a sample track. */
  onSetSampleMode: (trackId: string, mode: SampleMode) => void;
  onSetCues: (assetId: number, cues: number[]) => void;
  onSetChopStart: (assetId: number, start: number) => void;
  /** Plays one slice of the asset, independent of the sequence. */
  onAuditionSlice: (assetId: number, slice: number) => void;
  getAssetBytes: (assetId: number) => ArrayBuffer | undefined;
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
  /** Which modulation sources this control has (marker beside its name). */
  badge?: { auto: boolean; lfos: number };
  /** Clicking the name automates the control. */
  onAutomate?: () => void;
}

function formatValue(value: number): string {
  return Math.abs(value) < 10 ? value.toFixed(2) : String(Math.round(value));
}

function Slider({ label, min, max, step, value, unit, onChange, badge, onAutomate }: SliderProps) {
  return (
    <div className="module-param">
      {onAutomate ? (
        <button className="param-label" onClick={onAutomate} title="Automate this parameter">
          {label}
          <ModBadge badge={badge} />
        </button>
      ) : (
        <span className="param-label static">{label}</span>
      )}
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
 * controls (rendered generically from INSTRUMENT_DEFS). Per-step pitch/velocity/length are NOT
 * here: they belong to the Track Editor, which edits the steps themselves. */
const CHOKE_GROUP_COUNT = 8;

/** Group numbers offered in the Choke Group select: 1..8, plus the track's current group when a
 * project holds a larger one, so the select never shows a value it cannot represent. */
function chokeGroupOptions(current: number | null): number[] {
  const groups = Array.from({ length: CHOKE_GROUP_COUNT }, (_, i) => i + 1);
  return current !== null && current > CHOKE_GROUP_COUNT ? [...groups, current] : groups;
}

export function InstrumentPanel({
  track,
  asset,
  assetUseCount,
  onSetInstrument,
  onSetInstrumentParam,
  modulation,
  onAddLfo,
  onSetLfo,
  onRemoveLfo,
  onSetEnvelope,
  automation,
  onSetPlaybackMode,
  onSetVoiceMode,
  onSetChokeGroup,
  onSetSampleMode,
  onSetCues,
  onSetChopStart,
  onAuditionSlice,
  getAssetBytes,
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
  const badges = modulationBadges(automation?.lanes ?? [], synth?.lfos ?? []);

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
        {!synth && (
          <>
            <div className="track-mode-group">
              <span className="track-mode-label">Mode</span>
              <div className="track-mode-toggle">
                {(["one-shot", "loop"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={effectivePlaybackMode(track) === mode ? "active" : ""}
                    onClick={() => onSetPlaybackMode(track.id, mode)}
                    title={mode === "loop" ? "Tile the sample to fill this track's note lengths" : "Play through once, bounded by note length"}
                  >
                    {mode === "one-shot" ? "One-shot" : "Loop"}
                  </button>
                ))}
              </div>
            </div>
            <div className="track-mode-group">
              <span className="track-mode-label">Pitch</span>
              <div className="track-mode-toggle">
                {(["chromatic", "chop"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={effectiveSampleMode(track) === mode ? "active" : ""}
                    onClick={() => onSetSampleMode(track.id, mode)}
                    title={mode === "chop" ? "A step's pitch picks a slice of the sample (cue points below)" : "A step's pitch transposes the sample"}
                  >
                    {mode === "chromatic" ? "Chromatic" : "Chop"}
                  </button>
                ))}
              </div>
            </div>
            <div className="track-mode-group">
              <span className="track-mode-label">Voice</span>
              <div className="track-mode-toggle">
                {(["poly", "mono"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={effectiveVoiceMode(track) === mode ? "active" : ""}
                    onClick={() => onSetVoiceMode(track.id, mode)}
                    title={mode === "mono" ? "This track's own voices never overlap each other" : "This track's voices may overlap (default)"}
                  >
                    {mode === "poly" ? "Poly" : "Mono"}
                  </button>
                ))}
              </div>
            </div>
            <div className="track-mode-group">
              <label className="track-mode-label" htmlFor={`choke-group-${track.id}`}>Choke Group</label>
              <select
                id={`choke-group-${track.id}`}
                className="fx-add-select"
                value={effectiveChokeGroup(track) ?? ""}
                onChange={(e) => onSetChokeGroup(track.id, e.target.value === "" ? null : Number(e.target.value))}
                title="Tracks in the same group cut each other off (e.g. open and closed hi-hat)"
              >
                <option value="">None</option>
                {chokeGroupOptions(effectiveChokeGroup(track)).map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
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
              {def.params.map((p) =>
                p.options ? (
                  <div key={p.id} className="module-param">
                    <span className="param-label static">{p.label}</span>
                    <div className="enum-toggle">
                      {p.options.map((opt) => (
                        <button
                          key={opt.value}
                          className={opt.value === (synth.params[p.id] ?? p.default) ? "active" : ""}
                          onClick={() => onSetInstrumentParam(track.id, p.id, opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                <Slider
                  key={p.id}
                  label={p.label}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  unit={p.unit}
                  value={synth.params[p.id] ?? p.default}
                  onChange={(v) => onSetInstrumentParam(track.id, p.id, v)}
                  badge={badges[p.id]}
                  onAutomate={automation ? () => automation.onAdd(p.id) : undefined}
                />
                ),
              )}
            </div>
            {def.sustained && <div className="instrument-hint">Sustained: each note's length is its held time.</div>}
            <ModulationSlot
              lfos={synth.lfos ?? []}
              ui={modulation}
              labelFor={(id) => def.params.find((p) => p.id === id)?.label ?? id}
              onAdd={(target) => onAddLfo(track.id, target)}
              onChange={(index, patch) => onSetLfo(track.id, index, patch)}
              onRemove={(index) => onRemoveLfo(track.id, index)}
              automation={automation}
            />
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
                  badge={badges[f.id]}
                  onAutomate={automation ? () => automation.onAdd(f.id) : undefined}
                />
              ))}
            </div>
            <ModulationSlot lfos={[]} ui={null} labelFor={(id) => id} onAdd={() => {}} onChange={() => {}} onRemove={() => {}} automation={automation} />
            {assetUseCount > 1 && (
              <div className="instrument-hint">The envelope belongs to the sample, so it applies on all {assetUseCount} tracks that play it.</div>
            )}
          </div>
        )}

        {!synth && asset && effectiveSampleMode(track) === "chop" && (
          <div className="module-panel">
            <div className="module-panel-header">
              <span className="name">{asset.name} — Slices</span>
            </div>
            <ChopEditor asset={asset} getAssetBytes={getAssetBytes} onSetCues={onSetCues} onSetChopStart={onSetChopStart} onAuditionSlice={onAuditionSlice} />
            {assetUseCount > 1 && <div className="instrument-hint">Cue points belong to the sample, so they apply on all {assetUseCount} tracks that play it.</div>}
          </div>
        )}

        {!synth && !asset && (
          <div className="fx-panel-empty">No sound yet — load a sample on this track, or switch Source to Synth.</div>
        )}
      </div>
    </div>
  );
}
