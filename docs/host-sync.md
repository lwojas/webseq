# Following a host transport

When the audio runtime is hosted by something with its own clock (a DAW plugin), the sequencer follows it. In a
browser nothing here runs: `runtime.onHostTransport` never fires. Contract: webdsp's `docs/host-transport.md`.

- `audio/hostSync.ts` watches `runtime.onHostTransport` and drives `Transport.playAt(chainBeat, at, bpm)` /
  `stop()`. Host positions are quarter notes; webseq beats are sixteenth steps (`BEATS_PER_QUARTER = 4`).
- `Transport.playAt` starts the pattern queue at a chain beat (wrapping around the queue's length) so it sounds at
  engine time `at`, at `bpm`. It shares `begin()` with `play()`. The project's own BPM is untouched; while following,
  the transport bar shows the host tempo read-only ("BPM · host").
- Starting part-way into a pattern no longer schedules the notes before that point (`tick()` drops them). This also
  fixes pause/resume part-way into a pattern, which used to fire the earlier notes of the pattern at once.
- Policy: restart at the host's position when it starts, locates or loops; re-anchor on a tempo change; stop when the
  host stops, but only if the host started the playback. A Pause/Stop pressed by hand is respected until the host
  next starts or jumps (the periodic refresh does not restart it).
- A host with no user-gesture requirement (`hasEmbeddedHost()`) gets its runtime at startup (`App.tsx`) so the first
  host start is not missed.
- Known limits (v1): a tempo change restarts the schedule like `retime()` (notes already sounding are cut), and a host
  loop wrap resyncs after the fact rather than pre-scheduling across the loop point.

## Native sequence (the host plays the song)

A host that reports `capabilities.nativeSequence` (the WebSeq plugin) plays the song itself, so playback survives
closing the plugin window and renders in an offline bounce. The page stays the editor. Contract: webdsp
`docs/native-sequence.md`.

- `audio/nativeSequence.ts` compiles one cycle of the pattern queue into a webdsp `Sequence` (quarter notes). It is not a
  second compiler: every step goes through the same `compilePatternIterationTracked` / `compileInstrumentNotes` /
  `simultaneousChokeLosers` the lookahead Transport uses, at a fixed 120 bpm (so seconds map exactly to quarter notes),
  plus the automation lanes (`automationSequenceEvents`). Tempo is the DAW's, applied per block by the host.
- `App.tsx` sends the sequence after a short pause on every change of the song, and again when the engine becomes
  able to play more of it (a sample finished loading, an instrument was created). Only a changed result is sent.
- `hostSync` (`native: true`) never calls `playAt`. While the host plays it hands `Transport.attachHost(t)` the newest
  mapping (the playhead reads the position from it); a host stop calls `detachHost()`. While attached, Play/Pause/Stop
  do nothing (the host owns the transport) and resample is refused. With the host stopped, Play works as in a browser.
- Limits: the engine's tempo grid (tempo-aware synths such as Pulse) is the host's; track LFOs are evaluated on the
  120 bpm reference clock; a project edit is heard from the next block after the (150 ms) send; reopening the window
  starts a fresh engine and the sequence is sent again, so sound is cut for that moment.
