// The only place in this app that talks to midi-core's Web MIDI adapter or calls
// bindControlMapping() -- everything else (App.tsx, the reducer, the model) stays unaware
// MIDI exists, the same "one bootstrap module, everyone else is an ordinary client" shape
// useAudioRuntime.ts already uses for webdsp (see its own doc comment). ECS-38's whole point
// is that this file could be deleted and nothing in src/model/ or the rest of src/components/
// would need to change.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiInput, MidiMessage, MidiOutput, MidiPortInfo, Unsubscribe } from "midi-core";
import { createMidiInput, createMidiOutput } from "midi-core";
import { requestWebMidiAccess, type WebMidiAccess } from "midi-core/adapters/web-midi";
import { bindControlMapping } from "midi-core/mapping";
import type { ControlDef } from "midi-core/control-api";
import type { Action } from "../model/reducer";
import type { Project } from "../model/types";
import { createTrack1Bindings } from "./mappings";
import type { ProjectControl } from "./controlAdapter";

export type MidiConnectionStatus = "unavailable" | "idle" | "connecting" | "connected" | "error";

const MAX_LOG_LINES = 20;

export function useMidiControls(project: Project, dispatch: (action: Action) => void) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [ports, setPorts] = useState<readonly MidiPortInfo[]>([]);
  const [status, setStatus] = useState<MidiConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Transport (input/output) and the unsubscribes bindControlMapping() returned -- torn down
  // together on disconnect() or unmount. A ref, not state: nothing here needs a re-render when
  // these change, only when `status` does.
  const connectionRef = useRef<{
    input: MidiInput;
    output: MidiOutput;
    unbinds: Unsubscribe[];
    controls: ProjectControl<ControlDef>[];
  } | null>(null);

  // Project is read through this ref inside the sync effect below and inside each
  // ProjectControl's getValue()/setValue(), the same "always current, never stale-closed-over"
  // pattern App.tsx's own projectRef already uses for Transport.
  const projectRef = useRef(project);
  projectRef.current = project;

  const appendLog = useCallback((line: string) => {
    setLog((lines) => [...lines.slice(-(MAX_LOG_LINES - 1)), line]);
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      const granted = await requestWebMidiAccess();
      setAccess(granted);
      setPorts(granted.discovery.listPorts());
      granted.discovery.onChange(() => setPorts(granted.discovery.listPorts()));
    } catch (err) {
      setStatus("unavailable");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const disconnect = useCallback(async () => {
    const connection = connectionRef.current;
    if (!connection) return;
    for (const unbind of connection.unbinds) unbind();
    await Promise.all([connection.input.disconnect(), connection.output.disconnect()]);
    connectionRef.current = null;
    setStatus("idle");
  }, []);

  const connect = useCallback(
    async (inputId: string, outputId: string) => {
      if (!access) return;
      const rawInput = access.getInput(inputId);
      const rawOutput = access.getOutput(outputId);
      if (!rawInput || !rawOutput) {
        setError("Select both an input and an output port.");
        return;
      }

      await disconnect();
      setStatus("connecting");
      setError(null);

      const input = createMidiInput(rawInput);
      const output = createMidiOutput(rawOutput);
      input.onError((e) => appendLog(`input error: ${e.code} ${e.message}`));
      output.onError((e) => appendLog(`output error: ${e.code} ${e.message}`));

      try {
        await Promise.all([input.connect(), output.connect()]);
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      // Logs the literal MidiMessage bindControlMapping() hands to output.send() -- channel
      // included -- rather than a Control's onChange value. The two are not interchangeable:
      // a mapping with no `feedback` (volume, deliberately -- see mappings.ts) never calls
      // send() at all, so logging onChange directly as "out:" claimed something went out over
      // MIDI when nothing did. Wrapping send() itself can't lie about that.
      const loggedSend = output.send.bind(output);
      output.send = (message) => {
        appendLog(`out: ${describeMessage(message)}`);
        loggedSend(message);
      };

      const bindings = createTrack1Bindings(() => projectRef.current, dispatch);
      const unbinds = bindings.map(({ mapping, control }) => bindControlMapping(mapping, input, output, control));
      unbinds.push(input.onMessage((message) => appendLog(`in:  ${describeMessage(message)}`)));

      connectionRef.current = { input, output, unbinds, controls: bindings.map(({ control }) => control) };
      setStatus("connected");
    },
    [access, dispatch, disconnect, appendLog],
  );

  // Keeps every connected control's cached value (and therefore its feedback) in sync with
  // Project changes from *any* source -- a UI mixer-fader drag included, not just MIDI -- by
  // re-deriving each binding's syncFromProject() from the current connection on every Project
  // change. Connecting/disconnecting doesn't touch this effect; it just has nothing to sync
  // while connectionRef is empty.
  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection) return;
    for (const control of connection.controls) control.syncFromProject(project);
  });

  useEffect(() => () => void disconnect(), [disconnect]);

  return {
    status,
    hasAccess: access !== null,
    error,
    inputs: ports.filter((p) => p.type === "input"),
    outputs: ports.filter((p) => p.type === "output"),
    log,
    requestAccess,
    connect,
    disconnect,
  };
}

function describeMessage(message: MidiMessage): string {
  const clone: Record<string, unknown> = { ...message };
  delete clone.raw;
  return JSON.stringify(clone);
}
