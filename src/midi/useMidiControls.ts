// The only place in this app that talks to midi-core's Web MIDI adapter or Control Surface
// runtime -- everything else (App.tsx, the reducer, the model) stays unaware MIDI exists. connect()
// finds the connected input in midi-core's device registry (ECS-90), then attaches a midi-core
// `ControlSurface` with that device's profile and sequencer configuration, against this app's
// contract (sequencerContract.ts, which names the app's own controls). No device is named here: a
// port no profile matches is refused, not guessed at.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MidiInput, MidiMessage, MidiOutput, MidiPortInfo } from "midi-core";
import { createMidiInput, createMidiOutput } from "midi-core";
import { requestWebMidiAccess, type WebMidiAccess } from "midi-core/adapters/web-midi";
import { createAction, createSurfaceContext } from "midi-core/control-api";
import { createSequencerBindings, type SequencerDevices } from "midi-core/configurations";
import { findDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings, type ControlSurface } from "midi-core/surface";
import type { Action } from "../model/reducer";
import type { PatternId, Project } from "../model/types";
import { createSequencerRegistry, FADER_PAGE_SIZE, type SequencerRegistry } from "./sequencerContract";

export interface TransportCallbacks {
  readonly play: () => void;
  readonly stop: () => void;
}

export type MidiConnectionStatus = "unavailable" | "idle" | "connecting" | "connected" | "error";

const MAX_LOG_LINES = 20;

export function useMidiControls(project: Project, dispatch: (action: Action) => void, transport: TransportCallbacks, patternId: PatternId) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [ports, setPorts] = useState<readonly MidiPortInfo[]>([]);
  const [status, setStatus] = useState<MidiConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // The live surface and the raw ports/controls it was built from -- torn down together on
  // disconnect() or unmount. A ref, not state: nothing here needs a re-render when these
  // change, only when `status` does.
  const connectionRef = useRef<{
    input: MidiInput;
    output: MidiOutput;
    surface: ControlSurface;
    registry: SequencerRegistry;
    unwatchSurface: () => void;
  } | null>(null);

  // Project is read through this ref inside the sync effect below and inside each
  // ProjectControl's getValue()/setValue(), the same "always current, never stale-closed-over"
  // pattern App.tsx's own projectRef already uses for Transport.
  const projectRef = useRef(project);
  projectRef.current = project;
  const patternIdRef = useRef(patternId);
  patternIdRef.current = patternId;
  const transportRef = useRef(transport);
  // The fader page (ECS-96): which group of eight tracks the mixer faders show. Owned here, not by the device.
  const faderPageRef = useRef(0);
  transportRef.current = transport;

  const appendLog = useCallback((line: string) => {
    setLog((lines) => [...lines.slice(-(MAX_LOG_LINES - 1)), line]);
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      // SysEx permission is needed up front: the device's setup (Device Inquiry, Programmer mode)
      // is SysEx, and the browser rejects SysEx sends unless access was requested with it (ECS-94).
      const granted = await requestWebMidiAccess({ sysex: true });
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
    connection.unwatchSurface();
    connectionRef.current = null;
    await connection.surface.detach();
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
      const inputInfo = ports.find((port) => port.id === inputId);
      const device = findDevice({ name: inputInfo?.name ?? null });
      if (!device) {
        setStatus("error");
        setError(`Unsupported device: ${inputInfo?.name ?? inputId}. No device profile matches this input.`);
        return;
      }

      setStatus("connecting");
      setError(null);

      const input = createMidiInput(rawInput);
      const output = createMidiOutput(rawOutput);
      input.onError((e) => appendLog(`input error: ${e.code} ${e.message}`));
      output.onError((e) => appendLog(`output error: ${e.code} ${e.message}`));

      // The device's DAW pair, found by name from its MIDI pair (ECS-96). The mixer's fader modes need it; without it the
      // device has no fader modes, and the rest of the surface works as before.
      const dawInfo = (portName: string | null | undefined, type: "input" | "output", from: string, to: string) =>
        portName ? ports.find((port) => port.type === type && port.name === portName.replace(from, to)) : undefined;
      const dawInputInfo = dawInfo(inputInfo?.name, "input", "MIDI Out", "DAW Out");
      const dawOutputInfo = dawInfo(ports.find((port) => port.id === outputId)?.name, "output", "MIDI In", "DAW In");
      const rawDawInput = dawInputInfo ? access.getInput(dawInputInfo.id) : null;
      const rawDawOutput = dawOutputInfo ? access.getOutput(dawOutputInfo.id) : null;
      const dawInput = rawDawInput ? createMidiInput(rawDawInput) : undefined;
      const dawOutput = rawDawOutput ? createMidiOutput(rawDawOutput) : undefined;
      dawInput?.onMessage((message) => appendLog(`daw in:  ${describeMessage(message)}`));

      // Logs the literal MidiMessage the surface hands to output.send() -- channel included --
      // rather than a Control's onChange value. The two are not interchangeable: a mapping with
      // no feedback target never calls send() at all, so logging onChange directly as "out:"
      // claimed something went out over MIDI when nothing did. Wrapping send() itself can't lie
      // about that.
      const loggedSend = output.send.bind(output);
      output.send = (message) => {
        appendLog(`out: ${describeMessage(message)}`);
        loggedSend(message);
      };
      const unlogInput = input.onMessage((message) => appendLog(`in:  ${describeMessage(message)}`));

      const registry = createSequencerRegistry({
        getProject: () => projectRef.current,
        getPatternId: () => patternIdRef.current,
        dispatch,
        getFaderPage: () => faderPageRef.current,
      });
      const actions = {
        play: createAction({ id: "transport.play", label: "Play" }, () => transportRef.current.play()),
        stop: createAction({ id: "transport.stop", label: "Stop" }, () => transportRef.current.stop()),
      };

      faderPageRef.current = 0;
      // A fader page turn moves the faders to the next or previous group of eight tracks, clamped to the project's tracks.
      const turnFaderPage = (delta: number) => {
        const tracks = projectRef.current.tracks.length;
        const lastPage = Math.max(0, Math.ceil(tracks / FADER_PAGE_SIZE) - 1);
        faderPageRef.current = Math.min(lastPage, Math.max(0, faderPageRef.current + delta));
        connectionRef.current?.registry.syncFromProject(projectRef.current);
      };
      const faderActions = {
        pageLeft: createAction({ id: "faders.pageLeft", label: "Fader page left" }, () => turnFaderPage(-1)),
        pageRight: createAction({ id: "faders.pageRight", label: "Fader page right" }, () => turnFaderPage(1)),
      };

      const devices: SequencerDevices = dawInput && dawOutput
        ? {
            outputs: { "midi-out": output, "daw-out": dawOutput },
            inputs: { "daw-in": dawInput },
            connectedPortIds: ["midi-in", "midi-out", "daw-in", "daw-out"],
          }
        : { outputs: { "midi-out": output }, inputs: {}, connectedPortIds: ["midi-in", "midi-out"] };

      const sequencer = createSequencerBindings(
        input,
        device.profile,
        {
          stepTemplate: "step.{row}.{column}",
          lengthControl: "steps.length",
          muteTemplate: "mute.{track}",
          trackCountControl: "tracks.count",
          actions,
          faderActions,
          faderTemplates: { volume: "mixer.volume.{index}" },
        },
        devices,
      );
      for (const role of sequencer.unresolved) appendLog(`unresolved: ${role}`);

      const surface = createControlSurface({
        profile: device.profile,
        ports: {
          inputs: { "midi-in": input, ...(dawInput ? { "daw-in": dawInput } : {}) },
          outputs: { "midi-out": output, ...(dawOutput ? { "daw-out": dawOutput } : {}) },
        },
        bindingTable: sequencer.bindings,
        context: createSurfaceContext(),
        registry,
        generate: generateControlMappings,
        initialNavigation: { mode: "steps", gridOffset: { row: 0, column: 0 } },
      });

      try {
        await surface.attach();
      } catch (err) {
        unlogInput();
        await surface.detach().catch(() => {}); // best-effort: release whatever attach() connected before it failed
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      // midi-core moves the surface to "error" when a connected port drops on its own (the cable
      // is pulled). Release the device and say so, so the panel offers Connect again instead of
      // still showing "connected" (ECS-94). The project state is left alone: it is this app's own.
      const unwatchSurface = surface.onStateChange(({ to }) => {
        if (to !== "error" || connectionRef.current?.surface !== surface) return;
        unwatchSurface();
        connectionRef.current = null;
        appendLog("device disconnected");
        setStatus("error");
        setError(`${inputInfo?.name ?? inputId} disconnected. Plug it back in and connect again.`);
        surface.detach().catch((err) => appendLog(`release error: ${err instanceof Error ? err.message : String(err)}`));
      });

      connectionRef.current = { input, output, surface, registry, unwatchSurface };
      setStatus("connected");
    },
    [access, ports, dispatch, disconnect, appendLog],
  );

  // Keeps every connected control's cached value (and therefore its feedback) in sync with
  // Project changes from *any* source -- a UI mixer-fader drag included, not just MIDI -- by
  // re-deriving each binding's syncFromProject() from the current connection on every Project
  // change. Connecting/disconnecting doesn't touch this effect; it just has nothing to sync
  // while connectionRef is empty.
  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection) return;
    connection.registry.syncFromProject(project);
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
