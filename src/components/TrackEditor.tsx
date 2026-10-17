import { memo, useMemo } from "react";
import type { Note, NoteId, Pattern, Track, TrackEventLfo, TrackId } from "../model/types";
import { eventLfoOf } from "../model/eventLfo";
import { TrackLfoPanel } from "./TrackLfoPanel";
import { notesForTrack, totalBeats, trackHasSource } from "../model/types";
import { MAX_NOTE_PITCH, MIN_NOTE_PITCH } from "../model/notes";
import { rootMidiNote } from "../model/instruments";
import { NoteBlock } from "./NoteBlock";
import { TRACK_EDITOR_COLUMN_PX } from "./timelineConstants";

interface Props {
  /** The selected track, or null when MASTER is selected (it has no sequence). */
  track: Track | null;
  pattern: Pattern;
  beatsPerBar: number;
  selectedNoteId: NoteId | null;
  onSelectNote: (id: NoteId | null) => void;
  onAddNote: (trackId: TrackId, start: number) => void;
  onResizeNote: (noteId: NoteId, duration: number, freePlacement: boolean) => void;
  onMoveNote: (noteId: NoteId, start: number, freePlacement: boolean) => void;
  onRemoveNote: (noteId: NoteId) => void;
  onSetNotePitch: (noteId: NoteId, pitch: number) => void;
  onSetNoteVelocity: (noteId: NoteId, velocity: number) => void;
  onSetNoteDuration: (noteId: NoteId, duration: number) => void;
  onSetTrackEventLfo: (trackId: TrackId, patch: Partial<TrackEventLfo>) => void;
  onSetNoteLfo: (noteId: NoteId, amount: number) => void;
  onSetTrackNotesLfo: (trackId: TrackId, amount: number) => void;
}

/** Selectable note lengths, in beats (= steps; a step is a 16th note, so 2 beats reads "2/16").
 * The note's actual duration is added when it isn't one of these (free-placed lengths). */
const LENGTH_OPTIONS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16];

const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"];
const PITCH_OFFSETS = Array.from({ length: MAX_NOTE_PITCH - MIN_NOTE_PITCH + 1 }, (_, i) => MAX_NOTE_PITCH - i);
/** Audible band offered in the dropdown (the engine would happily play outside it). */
const MIN_AUDIBLE_HZ = 20;
const MAX_AUDIBLE_HZ = 16000;

/** The note a pitch offset sounds as. For a synth with a Hz root, that is its real note
 * (root + offset, e.g. Bass 55 Hz = A-1); otherwise (samples, unpitched roots) only the
 * offset in semitones is meaningful. */
function formatPitch(pitch: number, root: number | null): string {
  if (root === null) return pitch === 0 ? "0 st" : `${pitch > 0 ? "+" : ""}${pitch} st`;
  const midi = Math.round(root + pitch);
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/** Offsets to offer: all of them for a sample, only the audible span for a synth root, always
 * including the note's current value. */
function pitchOptions(root: number | null, current: number): number[] {
  if (root === null) return PITCH_OFFSETS;
  return PITCH_OFFSETS.filter((p) => {
    const hz = 440 * Math.pow(2, (root + p - 69) / 12);
    return p === current || (hz >= MIN_AUDIBLE_HZ && hz <= MAX_AUDIBLE_HZ);
  });
}

function formatLength(beats: number): string {
  if (Number.isInteger(beats)) return `${beats}/16`;
  const denominator = 16 / beats;
  return Number.isInteger(denominator) ? `1/${denominator}` : `${+beats.toFixed(3)}/16`;
}

interface CardProps {
  note: Note;
  /** The track's root as a MIDI note (see rootMidiNote), a primitive so the memo holds. */
  root: number | null;
  selected: boolean;
  onSelectNote: (id: NoteId | null) => void;
  onRemoveNote: (noteId: NoteId) => void;
  onSetNotePitch: (noteId: NoteId, pitch: number) => void;
  onSetNoteVelocity: (noteId: NoteId, velocity: number) => void;
  onSetNoteDuration: (noteId: NoteId, duration: number) => void;
  /** Shown only while the track's LFO is on. */
  lfoOn: boolean;
  onSetNoteLfo: (noteId: NoteId, amount: number) => void;
}

/** The contextual editor under one step. Memoised on the note object itself (the model only
 * replaces the note that was touched), so editing one note re-renders one card. */
const NoteCard = memo(function NoteCard({
  note,
  root,
  selected,
  onSelectNote,
  onRemoveNote,
  onSetNotePitch,
  onSetNoteVelocity,
  onSetNoteDuration,
  lfoOn,
  onSetNoteLfo,
}: CardProps) {
  const pitch = note.pitch ?? 0;
  const lengths = LENGTH_OPTIONS.includes(note.duration)
    ? LENGTH_OPTIONS
    : [...LENGTH_OPTIONS, note.duration].sort((a, b) => a - b);

  return (
    <div
      className={`te-card ${selected ? "selected" : ""}`}
      style={{ gridColumn: Math.floor(note.start) + 1 }}
      onPointerDown={() => onSelectNote(note.id)}
    >
      <div className="te-card-head">
        <select
          value={pitch}
          onChange={(e) => onSetNotePitch(note.id, Number(e.target.value))}
          aria-label="Pitch"
          title={root === null ? "Semitones relative to the sample's original pitch" : "Note, from the instrument's Root plus the offset"}
        >
          {pitchOptions(root, pitch).map((p) => (
            <option key={p} value={p}>
              {formatPitch(p, root)}
            </option>
          ))}
        </select>
        <button className="te-remove" onClick={() => onRemoveNote(note.id)} aria-label="Remove note" title="Remove note">
          ×
        </button>
      </div>
      <div className="module-param">
        <span className="param-label static">
          Vel <span className="te-value">{note.velocity.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={note.velocity}
          onChange={(e) => onSetNoteVelocity(note.id, Number(e.target.value))}
          aria-label="Velocity"
        />
      </div>
      {lfoOn && (
        <div className="module-param">
          <span className="param-label static">
            LFO <span className="te-value">{Math.round((note.lfo ?? 0) * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={note.lfo ?? 0}
            onChange={(e) => onSetNoteLfo(note.id, Number(e.target.value))}
            aria-label="Track LFO amount for this step"
          />
        </div>
      )}
      <select
        value={note.duration}
        onChange={(e) => onSetNoteDuration(note.id, Number(e.target.value))}
        aria-label="Length"
        title="Note length (clamped to the room before the next note)"
      >
        {lengths.map((d) => (
          <option key={d} value={d}>
            {formatLength(d)}
          </option>
        ))}
      </select>
    </div>
  );
});

/** The bottom-panel Track Editor tab: an expanded, scrollable view of the selected track's
 * steps. Same data and same handlers as the timeline (App.tsx) — only the column width differs
 * (TRACK_EDITOR_COLUMN_PX per step, wide enough for the per-step controls). Column i is beat i,
 * so notes sit at the same index as in the timeline. Deliberately no playhead and no transport
 * subscription: this view only re-renders when its props (the track's pattern data) change. */
export const TrackEditor = memo(function TrackEditor({
  track,
  pattern,
  beatsPerBar,
  selectedNoteId,
  onSelectNote,
  onAddNote,
  onResizeNote,
  onMoveNote,
  onRemoveNote,
  onSetNotePitch,
  onSetNoteVelocity,
  onSetNoteDuration,
  onSetTrackEventLfo,
  onSetNoteLfo,
  onSetTrackNotesLfo,
}: Props) {
  const trackId = track?.id ?? null;
  const root = track ? rootMidiNote(track) : null;
  const notes = useMemo(() => (trackId ? notesForTrack(pattern, trackId) : []), [pattern, trackId]);

  if (!track) {
    return (
      <div className="fx-panel">
        <div className="fx-panel-title">TRACK EDITOR</div>
        <div className="fx-panel-empty">Select a track to edit its steps. MASTER has no sequence.</div>
      </div>
    );
  }

  const lfo = eventLfoOf(track);
  const participating = notes.filter((n) => (n.lfo ?? 0) > 0).length;
  const beats = totalBeats(pattern, beatsPerBar);
  const width = beats * TRACK_EDITOR_COLUMN_PX;
  const columns = `repeat(${beats}, ${TRACK_EDITOR_COLUMN_PX}px)`;

  return (
    <div className="track-editor">
      <div className="fx-panel-title">
        {trackHasSource(track) ? track.name : "— empty —"} — TRACK EDITOR
      </div>
      <TrackLfoPanel
        lfo={lfo}
        participating={participating}
        stepCount={notes.length}
        onChange={(patch) => onSetTrackEventLfo(track.id, patch)}
        onSetAllSteps={(amount) => onSetTrackNotesLfo(track.id, amount)}
      />
      <div className="track-editor-content" style={{ width }}>
        <div className="track-lane te-lane" style={{ width }}>
          <div className="cells" style={{ gridTemplateColumns: columns }}>
            {Array.from({ length: beats }, (_, i) => (
              <button
                key={i}
                className={`cell ${i % beatsPerBar === 0 ? "bar-start" : ""}`}
                style={{ gridColumn: i + 1 }}
                onClick={() => onAddNote(track.id, i)}
                aria-label={`step ${i + 1}`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          {notes.map((note) => (
            <NoteBlock
              key={note.id}
              note={note}
              totalBeats={beats}
              selected={note.id === selectedNoteId}
              onSelect={() => onSelectNote(note.id)}
              onResize={(duration, freePlacement) => onResizeNote(note.id, duration, freePlacement)}
              onMove={(start, freePlacement) => onMoveNote(note.id, start, freePlacement)}
              onRemove={() => onRemoveNote(note.id)}
              lfo={lfo.enabled ? note.lfo : undefined}
            >
              <span className="te-note-label">{formatPitch(note.pitch ?? 0, root)}</span>
            </NoteBlock>
          ))}
        </div>
        <div className="te-cards" style={{ gridTemplateColumns: columns }}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              root={root}
              selected={note.id === selectedNoteId}
              onSelectNote={onSelectNote}
              onRemoveNote={onRemoveNote}
              onSetNotePitch={onSetNotePitch}
              onSetNoteVelocity={onSetNoteVelocity}
              onSetNoteDuration={onSetNoteDuration}
              lfoOn={lfo.enabled}
              onSetNoteLfo={onSetNoteLfo}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
