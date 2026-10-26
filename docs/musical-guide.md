# Chord mode and the Musical Guide

Client-only (webseq): **webdsp is unchanged.** Principle: *the scale provides the vocabulary, the guide
provides examples and starting points, the user remains the composer.* Not a song generator.

## Scale-relative layer (`model/scaleDegrees.ts`)

The one place a scale degree becomes a MIDI note. A scale of *n* notes is an infinite ascending **ladder**:
index *k* = `tonic + 12·floor(k/n) + intervals[k mod n]`. Index 0 is the tonic at or below the track's
reference note (a synth's real root such as Bass A1, or the key's tonic in octave 4 for a sample), 7 is the tonic
an octave up in a 7-note scale, -1 the scale note below. Degrees past the scale wrap by octave (9 = 2 an octave up).
A **chromatic** project has no useful "every second note", so ladders use **Major on the key root** there.
Everything resolves through the existing `model/scale.ts` data; nothing re-derives intervals.

## Chord mode (`model/chord.ts`, `Note.chord`)

A chord is stored on an ordinary Note as `{ root, degrees, type?, inversion?, voicing? }`, never as MIDI notes:

- `root`: ladder index (which scale note it is built on).
- `degrees`: scale-step offsets from the root, ascending. `[0,2,4]` = 1·3·5 (triad), `[0,2,4,6]` adds the
  7th, `[0,2,4,6,8]` the 9th. Up to 5 tones. These are the "In scale" shapes: their quality follows the project scale.
- `type` (optional): a `CHORD_TYPES` id (maj, min, dim, aug, sus2, sus4, 6, m6, 69, maj7, m7, 7, dim7, m7b5, maj9,
  m9, 9, 11, m11, 13). A named type is a fixed semitone table on the scale-note root, so Minor 7 is minor in any
  scale; `degrees` then only records the tone count. 11 and 13 drop the tones players omit (5th, or 3rd of a dominant
  11) to stay within 5 tones. An unknown type is dropped on load and the chord falls back to its `degrees`.
- `inversion` (optional, 0 = root): moves the n lowest tones up an octave one at a time (Cm7: C Eb G Bb → Eb G Bb C →
  G Bb C Eb → Bb C Eb G). Clamped to tones − 1. In-scale chords move by the scale's note count, so a pentatonic
  chord inverts by its own octave.
- `voicing` (optional, `"open"`; absent = close): applied after inversion, lifts the second-lowest tone an octave
  (Cm7: C G Bb Eb). No effect on chords of fewer than 3 tones.
- All three are resolved in `chordTones` / `arrangeTones`, pure functions. Absent fields mean the old behaviour, so
  existing projects load and sound identical. Tones are always sorted ascending; tone *i* is engine instance *i*.
  Notes are clamped to the engine's ±4 octave offset range, so an extreme root + inversion can collapse tones.

A note has **either** `chord` **or** `pitch` (Note mode). The Track Editor's note card has a **Note | Chord**
switch: Chord mode shows a root menu (scale notes only, with their degree), a Type menu (named types, plus the In-scale Triad/Seventh/Ninth), Inversion and Voicing menus, and
the resolved tones (e.g. `A1 C2 E2`). Switching Note→Chord roots a triad on the nearest scale note to the pitch;
Chord→Note keeps the root as the pitch. Chop tracks (pitch = slice) have no chord mode. Chromatic work stays
possible everywhere else (plain notes, the full pitch menu).

**Scale changes.** Chords are resolved at playback, so changing the project scale re-resolves them (A Phrygian
A·C·E becomes A·C·E in Minor, A·C#·E in Lydian). Plain notes are never converted or rewritten, and the stored
chord is never touched.

**Playback.** `audio/compile.ts#playedNotes` expands each chord note into ordinary notes (same start, length,
velocity, LFO) *before* the arp, so the arp arpeggiates chords. Nothing downstream knows chords exist.
- *Samples*: chord tones are simultaneous voices (use Poly voice mode; a mono track chokes to the last tone).
- *Synths*: webdsp instruments are monophonic per instance (its docs: "chords/layers = more instances"), so the
  existing path alone cannot sound a chord. `audio/instruments.ts#InstrumentHost` keeps **one instance per chord
  tone** for tracks that contain chords (max 5, `MAX_INSTRUMENTS` is 64); tone *i* always plays on instance *i*, and
  controls, LFOs and automation lanes are applied to all instances. Tracks without chords keep one instance.
  If real per-instance polyphony ever lands in webdsp, only `InstrumentHost` changes.

Stored chords are re-validated (`normalizeChord`) at playback; a corrupt one plays as a plain note.

## Musical Guide

`components/MusicalGuide.tsx`, opened by **Musical Guide** beside the Scale control (also in the phone Settings
view). A modal over the app:

1. Opening pauses a playing transport (`guide/session.ts#pauseForGuide`). Closing never resumes it.
2. The app root is `inert` (no pointer, focus or Tab behind it); window shortcuts and MIDI input are ignored
   while it is open (`blockWhileGuideOpen`). Esc, the backdrop or **Back to sequencer** closes it.
3. It reads the project and never modifies it by being open. The single write is **Try this**
   (`APPLY_RECIPE`).

Content: the project scale (tap notes to hear them, **Play scale**), "X is home" with a tiny home-settling
example, and the recipes. Hearing uses the existing engine: `audio/guidePreview.ts` builds a throwaway pattern on
throwaway synth tracks, compiles it with the same `compileInstrumentNotes`, and plays it on a private
`InstrumentHost`. No second audio engine, no scheduler branch; stopping removes its instances.

### Recipes (`guide/recipes.ts`)

Plain data, independent of React/audio. A recipe has `id, name, category, description, bars` and `tracks[]`,
each `{ role, instrument?, events[] }`. An event is `{ bar, step, length, degree, octave?, velocity?, chord? }`:
a 1-based scale degree (1 = home), never MIDI. `chord` names a `CHORD_SHAPES` id, so recipe chords are the same
`NoteChord` the editor stores. Add a recipe by adding an entry to `RECIPES`. Initial set: Root Pulse, Root + Fifth
(bass); Two Note Motif, Tension & Release (melody); Simple Triad Movement, Two Chord Movement (chords). No rhythm
templates yet (they don't map onto the sequence model without becoming drum programming).

Pipeline: `Recipe → project scale → ladder index → Note (pitch / NoteChord) → normal pattern → existing playback`
(`guide/resolve.ts`, `guide/apply.ts`).

### Try this: placement and safety (`guide/apply.ts`)

Purely additive: nothing existing is overwritten, shrunk or re-sourced, and no sequence is created.

- The recipe goes into the sequence being edited, on the **selected track if it has no notes in that sequence**,
  otherwise on the **next empty track** (scanning forward, wrapping to the start). A multi-track recipe takes
  successive empty tracks. If there aren't enough, it is refused with a message and nothing changes.
- A target track with no sound gets the recipe's suggested instrument; a track that already has a sound keeps it.
  An instrument the registry/engine lacks is skipped with a message.
- The sequence only **grows** to fit a longer recipe (growing loses nothing); a shorter recipe leaves the
  sequence length as it is.
- The result is ordinary data (notes, chords); nothing records that it came from a recipe.

## Tests

`test/chord.test.ts` (resolution, A Phrygian/major/minor, wrapping, instance pool, playback path, persistence,
backwards compatibility), `test/guide.test.ts` (recipes, resolution, length, tracks, instruments, safety,
previews, session contract).
