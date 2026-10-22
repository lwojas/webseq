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
- Latency: notes travel DAW -> native -> WebView -> `runtime.instrumentNoteOn`, roughly 10-30 ms plus a block. Fine for
  entering and auditioning; a native fast path (note routing in the plugin) is the planned fix for tight live playing.
