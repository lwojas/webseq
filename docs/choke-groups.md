# Track choke groups

A **choke group** lets tracks cut each other off: when a track plays a note, the sounding notes of the *other* tracks in
the same group stop at that exact moment. The standard use is an open and a closed hi-hat.

| Track | Choke Group |
|---|---|
| Kick | None |
| Open Hat | 1 |
| Closed Hat | 1 |
| Snare | None |

A Closed Hat note cuts a ringing Open Hat (and an Open Hat note cuts a ringing Closed Hat). Kick and Snare are never
affected, and tracks in group 2 never touch group 1.

## Using it

Select a sample track and open its settings (the instrument panel): **Choke Group** → *None*, or 1–8. Every track in the
same group can cut every other. A track does not cut itself: its own overlapping notes behave as set by **Voice**
(Poly / Mono), unchanged.

## How it works

`Track.chokeGroup` (`number | null`) is compiled onto each scheduled event as webdsp's `chokeGroup`
(`audio/compile.ts`), and onto manual pad hits (`audio/playback.ts`). The cut itself is made by the engine on the audio
thread at the new note's exact start frame — see webdsp's [`docs/choke-groups.md`](https://github.com/lwojas/webdsp/blob/main/docs/choke-groups.md) — so it is sample-accurate, including across pattern
repeats, and nothing in the UI or the lookahead scheduler is involved. The cut fades out over ~2 ms (no click) and
ignores the sample's envelope release, so a long open-hat tail is cut rather than left to decay.

webdsp identifies "another track" by its bus; every webseq track has its own bus.

### Not the same as Mono or voice stealing

- **Voice: Mono** is a track against itself (its voices never overlap).
- **Choke group** is one track against other tracks, an explicit musical choice.
- **Voice stealing** is the engine reclaiming a voice when its pool is full; it is unrelated and unchanged. A choke
  happens even when plenty of voices are free.

## Persistence

`chokeGroup` is part of the track in the saved project and in session recovery. New tracks start with `null`. A project
saved before this existed has no such field and loads as *None* (`effectiveChokeGroup` in `model/types.ts` treats absent,
0, negative or non-integer as none); no migration is needed. Copy/paste of a track's configuration (and of the instrument
clip) carries the group.

## Limits (MVP)

- Synth-instrument tracks choke too, in the same groups as sample tracks (a synth closed hat cuts a sample open hat).
- Every member chokes every other member; there are no send/receive roles, per-note choke or choke-time controls.
- Two notes starting on the very same frame in one group: the later-scheduled one wins.

Tests: `test/chokeGroup.test.ts` (model, persistence, compile, manual triggers); the voice behaviour itself is tested in
webdsp (`native/test/choke_test.cpp`).
