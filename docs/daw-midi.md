# Playing the selected track from a MIDI keyboard / a plugin host

In a plugin host the host's MIDI arrives as an ordinary Web MIDI input ("WebVST DAW MIDI"). The same path takes
any plain MIDI keyboard. Only inputs that match **no** controller profile in midi-core are used: Launchpad and Push
keep going through the control-surface connection (`useMidiControls.ts`), which holds one device at a time and is
untouched. The DAW input resolves to midi-core's generic device (no controls bound, no output needed).

- `midi/dawNoteInput.ts` listens on those inputs (own `MIDIAccess`, not the control surface's) and routes note on/off
  and CC 123/120 (all notes off) to a `NoteSink`. App.tsx hands it `Playback.noteOn/noteOff` for the **selected
  track** (select a track row or its FX target; the Master strip plays nothing).
- `Playback.noteOn(track, midiNote, velocity)`: samples and drums play at their own pitch from middle C (MIDI 60),
  chromatically; a chop track plays slice `note - 60`; a pitched synth sounds the key itself (its root key plays its
  tune). Velocity is the gain. A looping sample's voice and a held synth note end on key-up (a synth only when that key
  is the one it is playing); one-shots ring out like a pad hit.
- Only where the host provides MIDI without asking (`hasEmbeddedHost()`): a browser would show a permission prompt on
  page load. Enabling it for keyboards in the browser would be a setting, not an on-load default.
- Not forwarded: SysEx, pitch bend, sustain pedal, aftertouch.
- **Native routing (low latency).** When the host can play MIDI itself (`capabilities.midiRouting`, webdsp `docs/midi-routing.md`), the page
  does not play the notes: it declares a route for the selected track (`audio/midiRoute.ts`, the same mapping as `Playback.noteOn`: the sample
  chromatically or per chop slice, looping while held, mono; a pitched synth sounds the key, a drum plays from middle C) and the host plays
  incoming notes on its audio thread, sample-accurately, also with the window closed. The route follows the selected track (and the engine
  objects it needs; it is cleared during a resample and for MASTER). Without `midiRouting` (an older plugin) the page plays the notes as
  described above, roughly 10-30 ms plus a block behind.
