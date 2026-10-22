// Plain MIDI inputs (a keyboard, or a plugin host's MIDI) play the selected track. Inputs that match a
// controller profile in midi-core (Launchpad, Push) are left alone: their notes are pad presses, handled by
// the control-surface connection in useMidiControls.ts. This is a separate listener from that connection,
// which holds one device at a time.
//
// The module only knows Web MIDI and midi-core's device registry; where the notes go is the caller's
// (App.tsx hands it Playback.noteOn/noteOff for the selected track).
import { findDevice } from "midi-core/devices";

export interface NoteSink {
  noteOn(note: number, velocity01: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
}

/** Routes one raw MIDI message to the sink. Note-on with velocity 0 is a note-off; CC 123 (all notes off) and
 * CC 120 (all sound off) release everything. Anything else is ignored. */
export function routeMidiMessage(data: ArrayLike<number>, sink: NoteSink): void {
  const status = data[0] ?? 0;
  const kind = status >> 4;
  if (kind === 0x9 && (data[2] ?? 0) > 0) sink.noteOn(data[1] ?? 0, (data[2] ?? 0) / 127);
  else if (kind === 0x8 || kind === 0x9) sink.noteOff(data[1] ?? 0);
  else if (kind === 0xb && ((data[1] ?? 0) === 123 || (data[1] ?? 0) === 120)) sink.allNotesOff();
}

/** Listens on every connected MIDI input that no controller profile claims, now and as they come and go.
 * Returns a function that stops listening. Asking for access can fail (no Web MIDI, permission refused);
 * that is silent, like having no keyboard. */
export function attachPlainMidiInputs(sink: NoteSink, requestAccess: () => Promise<MIDIAccess> = () => navigator.requestMIDIAccess()): () => void {
  let detached = false;
  let access: MIDIAccess | null = null;
  const wired = new Set<MIDIInput>();

  const onMessage = (event: Event) => routeMidiMessage((event as MIDIMessageEvent).data ?? [], sink);

  const wire = (input: MIDIInput) => {
    if (wired.has(input) || findDevice({ name: input.name })) return;
    input.addEventListener("midimessage", onMessage);
    wired.add(input);
  };
  const unwire = (input: MIDIInput) => {
    input.removeEventListener("midimessage", onMessage);
    wired.delete(input);
  };
  const onStateChange = (event: Event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (!port || port.type !== "input") return;
    if (port.state === "connected") wire(port as MIDIInput);
    else unwire(port as MIDIInput);
  };

  Promise.resolve()
    .then(requestAccess)
    .then((granted) => {
      if (detached) return;
      access = granted;
      granted.inputs.forEach((input) => wire(input));
      granted.addEventListener("statechange", onStateChange);
    })
    .catch(() => {});

  return () => {
    detached = true;
    access?.removeEventListener("statechange", onStateChange);
    wired.forEach(unwire);
    sink.allNotesOff();
  };
}
