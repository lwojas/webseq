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
