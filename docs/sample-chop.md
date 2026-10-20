# Chop mode (sample slicing)

A sample track can play its sample as slices instead of transposing it. Built on webdsp's cue
regions (webdsp `docs/sample-chop.md`); nothing is cut — the engine plays a span of the same
audio.

## Model

| | Where | Notes |
| --- | --- | --- |
| Cue points | `Asset.cues` (`model/types.ts`) | Sorted interior boundaries as fractions 0..1 of the sample; N cues = N+1 contiguous slices (max 49). Fractions survive a reload at another engine sample rate. Describes the audio, shared by every track using the asset. |
| Chop start | `Asset.chopStart` | Fraction 0..1 where slice 1 begins (default 0, absent when 0), to skip leading silence. Always before the first cue (`setAssetChopStart` clamps; `setAssetCues` drops cues at/before it). Slices are `[chopStart, ...cues, 1]`; even splits span start..end. Drag the start handle in the chop editor, or **Reset start**. |
| Mode | `Track.sampleMode` (`"chromatic"` default, `"chop"`) | Per track, so the same sample can be chromatic on one track and chopped on another. Absent on old projects = chromatic, so they play as before. |
| Slice choice | `Note.pitch` | In chop mode a step's pitch (0, 1, 2, ...) is the slice index (0 = slice 1). It does not transpose. Negative pitch has no slice and is skipped; a pitch past the last slice plays nothing. |

The cue maths itself is webdsp's (`addCue`, `moveCue`, `cueRegions`, `computePeaks`, ...); `model/chop.ts` wraps it with webseq's 49-slice cap (a note's pitch is 0..48). Pure logic is in `model/chop.ts` (`evenCues`, `addCue`, `moveCue` — never crosses neighbours —
`removeCue`, `cueRegions`). `project.ts` has `setTrackSampleMode` / `setAssetCues`.

## Audio path

* `audio/compile.ts`: a chop track's event gets `region = pitch` and no `pitch`; chromatic tracks
  are unchanged.
* `audio/busSync.ts` `syncSampleRegions`: converts cues to frame regions (`cueRegions`, using
  `assetLengthFrames`) and calls `runtime.setSampleRegions`, only when an asset's cues changed.
  A project reload gives assets new ids and so pushes them afresh.
* Manual audition (`audio/playback.ts`) still plays the whole sample.

## UI

Instrument tab, sample source: **Pitch: Chromatic | Chop**. In Chop mode a **Slices** panel shows
the waveform (`components/ChopEditor.tsx`, peaks from `audio/peaks.ts`, decoded from the asset's
stored bytes and cached):

* tap the waveform to add a cue; drag a cue to move it (committed on release); arrow keys nudge a
  focused cue, Delete removes it; **Remove cue** / **Clear**; 2/4/8/16/32 even splits;
* a row of **audition pads** (one per slice) plays that slice on tap, independent of the sequence
  (`Playback.auditionSlice` -> `trigger({ region })`; a new pad cuts the previous one);
* slices are numbered to match the note's pitch; the Track Editor shows "Slice n" for chop tracks.

Tests: `test/chop.test.ts`.
