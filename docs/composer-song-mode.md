# Composer / Song mode

webseq has two ways to play: **Pattern mode** (the launcher's pattern queue, `Project.patternChain`) and **Song mode**
(the Composer). The transport's source is chosen with the Pattern | Song toggle; Pattern mode is unchanged.

The Composer is an arrangement layer over the existing engine. It owns *where sequences are placed* and *what musical
modifiers a lane applies*. It owns nothing about audio: instruments, samples, track FX, automation, sends, the mixer and
the buses are exactly the existing ones.

## Model (`src/model/composer.ts`)

```
Project.composer
  lanes[]                      ComposerLane  { id, name, sequences[], modifiers? }
    sequences[]                ComposerSequence { id, patternId, start (bars), color }
```

- A **sequence** is an independent instance: it owns a pattern of its own (`Pattern.composerOwned`), cloned when added from
  the launcher or duplicated. The Sequencer edits it through the usual patternId actions. Length = the pattern's `bars`;
  name = the pattern's name. The launcher's pattern stays the reusable source.
- A **lane** is a parallel stream of sequences on the timeline. Sequences on one lane never overlap (enforced by the
  model); lanes overlap freely; gaps are silence. A lane is not a track, a bus or a routing: every sequence plays all the
  tracks its pattern has notes for.
- **Lane modifiers** (`LaneModifiers`: transpose, velocity, gate) are musical transformations of the lane's notes,
  applied by `applyLaneModifiers` before the pattern is compiled: sequence -> modifiers -> notes -> the existing
  instrument/sample -> the track's own FX -> mixer -> master. They never touch audio, so a lane needs no bus. (Chord notes are
  left as written by transpose.)

## Playback

`songInstances(project)` lists every sequence of every lane with its absolute start beat. `Transport` in Song mode
(`audio/transport.ts`, `tickSong`) schedules each instance as its start enters the lookahead window, through the same
`scheduleNotes` the pattern queue uses. The song is a cycle of `songBeats` beats and loops. No second audio path exists.

## Automation

Composer has no automation of its own. Audio automation stays where it is: a track's (or the master's) existing lanes, with
pattern-local positions. In Song mode they replay from the start of every sequence they apply to (`automationAppliesTo`): a
track's lanes over the sequences whose pattern has notes for it, the master's over the top-most lane's sequences. The Composer
draws the focused lane (the same one the Sequencer's grid shows) over those spans (`automationSpans`) and edits the same
data, so a change in either view is the change in the other. Adding a lane to automate is done in the existing Instrument / FX
cards.

Not done: automation that differs per sequence instance (it would mean moving lanes from the track onto the pattern), and
automating lane modifiers.

## UI

The Composer takes the sequencer grid's place (`Workspace`); dock, side panel and mixer stay. One scrolling viewport holds the
ruler, lane headers (sticky), blocks and the automation row; it owns horizontal swipes. The toolbar has the quick actions;
names, lengths, colours, adding a launcher pattern and the lane's modifiers are in the Edit panel's Composer group.

## Marker

Click the ruler to put a marker on the nearest bar line (click it again to clear it). It is separate from the playhead.
"▶ From here" starts the song at the marker (without one: at the selected sequence). + Sequence, Paste and Add pattern insert at
the marker on the selected lane, and are off while the sequence would not fit there (the marker is on a sequence, or the gap is
too short); afterwards the marker moves to the end of what was inserted. Without a marker they append to the lane. "+ Composer"
from the Sequencer always appends, since the marker is not visible there.
