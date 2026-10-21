import { ROOT_NAMES, SCALES, SCALE_PRESETS, formatScale, type ProjectScale } from "../model/scale";

interface Props {
  scale: ProjectScale;
  onChange: (patch: Partial<ProjectScale>) => void;
  /** Opens the Musical Guide (pauses the sequencer and blocks the editor behind it). */
  onOpenGuide: () => void;
}

/** The project's key: root + scale, a separate list of subjective musical presets, and Snap.
 * Changing any of it only changes how notes are shown and entered, never the notes themselves
 * (model/scale.ts). */
export function ScaleControl({ scale, onChange, onOpenGuide }: Props) {
  return (
    <div className="field scale-control" title={`Key: ${formatScale(scale)}. Changing it never rewrites existing notes.`}>
      <span>Scale</span>
      <select value={scale.root} onChange={(e) => onChange({ root: Number(e.target.value) })} aria-label="Scale root note">
        {ROOT_NAMES.map((name, i) => (
          <option key={name} value={i}>
            {name}
          </option>
        ))}
      </select>
      <select value={scale.scale} onChange={(e) => onChange({ scale: e.target.value })} aria-label="Scale">
        {SCALES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        value={scale.preset ?? ""}
        onChange={(e) => e.target.value && onChange({ preset: e.target.value })}
        aria-label="Musical preset"
        title="Musical starting points — inspiration, not definitions of a genre"
      >
        <option value="">Presets…</option>
        <optgroup label="Musical presets (inspiration)">
          {SCALE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        className={`btn small ${scale.snap ? "active" : ""}`}
        onClick={() => onChange({ snap: !scale.snap })}
        aria-pressed={scale.snap}
        title="Snap: new notes land on the nearest scale note and the pitch menu lists scale notes only. Turn off to enter any semitone."
      >
        Snap
      </button>
      <button className="btn small guide-open" onClick={onOpenGuide} title="Musical Guide: hear your scale and try simple starting points. Pauses the sequencer.">
        Musical Guide
      </button>
    </div>
  );
}
