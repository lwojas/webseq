# Project scale and per-track arpeggiator

Client-only features: webdsp is untouched. Both transform data before it reaches the engine.
webtracker carries a line-for-line JS port of `src/model/scale.ts` and `src/model/arp.ts`
(`src/model/scale.js`, `arp.js`) with the same test vectors — the apps share no package.

## Scale (`model/scale.ts`, `Project.scale`)

A *context*, never a constraint: `{ root 0..11, scale id, snap, preset }`. Absent = chromatic (every
note in scale), so old projects are unchanged. Changing it **never rewrites a note** and playback
never reads it. Intervals are a table (`SCALES`); `SCALE_PRESETS` are subjective starting points
(root + scale + suggested octave) shown separately in the UI as "Musical presets (inspiration)".

API: `getScaleNotes`, `isNoteInScale`, `getScaleDegree`, `getNearestScaleNote` (ties go down),
`getNotesInRange`, plus offset helpers for webseq (below).

Effects in the UI:
- Transport bar: root, scale, preset, **Snap**.
- Track Editor pitch menu: in-scale pitches are marked `●` with their degree; off-scale are plain.
  With Snap on the menu lists only scale pitches (the note's current value is always kept) and a
  newly added note is moved to the nearest scale pitch (`model/scaleEntry.ts`, reducer `ADD_NOTE`).
  Off-scale notes in the lane are drawn dimmed/italic.
- Note pitch in webseq is a semitone *offset* from the track's own pitch. A synth with a Hz root uses
  its real note; for a sample (original pitch unknown) offset 0 is taken as the key's tonic.
  Chop tracks (pitch = slice) are never scale-aware.

## Arp (`model/arp.ts`, `Track.arp`)

`{ enabled, mode, pattern, rate, octaves, gate, velocity: { mode, amount, steps } }`, optional and
disabled by default. `audio/compile.ts#playedNotes` is the single seam: with the arp off the track's
stored notes are compiled untouched (identical path to before); on, they are replaced by
`arpTrackNotes(...)` before `compileNote`/`compileInstrumentNote`. Sample, synth, swing, mono,
automation and the track LFO therefore all see ordinary notes.

**How notes are read.** Track notes cannot overlap, so there is no stored chord. Per *bar*:
the pitches of the track's notes are the chord pool, and each note is a gate window: the arp plays
inside `[start, start+duration)`, first step on the note's start, then every `rate`. Placement keeps
its rhythm and rests; the arp chooses what sounds. Runs are clipped at bar lines and the pattern end,
and each bar is independent (fresh pool, step counter, random sequence), so loops, queued/changed
patterns and different pattern lengths are deterministic with no state between iterations.

- Order: up, down, up/down, down/up (turning points not repeated), random (seeded per bar), as played,
  pattern (`ARP_PATTERNS`: 1-based indices into the pool; past the end wraps; `0` is a rest that still
  advances the step).
- Rate: 1/1 … 1/32 plus triplets and dotted values, in grid steps (`ARP_RATES`). Same BPM/clock.
- Octaves 1–4: the pool repeated upward. (Chop tracks: octave = +12 slices — not meaningful; leave at 1.)
- Gate: fraction of a step, 5–100 %.
- Velocity: source / pattern (blend source → level by amount) / accent (source scaled down by level);
  1–16 step levels, drawn in the step editor. `steps` is the one place a per-step field would grow.
- The project scale is *not* applied to generated notes; the scale remains context for entering the
  source notes.

Limits: generated notes are not shown in the grid/timeline (the stored steps are); generated notes
past ±48 semitones are clamped; an arp never crosses a bar line. MIDI-control contract is not extended.
