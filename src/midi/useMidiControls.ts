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
import { createSequencerBindings, sequencerFaderCount, type SequencerDevices } from "midi-core/configurations";
import { findDawPorts, requiresOutput, resolveDevice } from "midi-core/devices";
import { createControlSurface, generateControlMappings, type ControlSurface } from "midi-core/surface";
import type { Action } from "../model/reducer";
import type { ChainEntryId, PatternId, Project } from "../model/types";
import { createBankActions, createSequencerRegistry, faderPagesPerBank, type SequencerRegistry } from "./sequencerContract";

export interface TransportCallbacks {
  readonly play: () => void;
  readonly stop: () => void;
  /**
   * Current transport position (ECS-131) — the same `Transport.getPlayheadInfo()` the on-screen playhead already
   * reads (`App.tsx`'s `getPlayheadBeat`). Omitted means no playhead feedback on a connected device.
   */
  readonly getPlayheadInfo?: () => { readonly patternId: PatternId | null; readonly beat: number };
  /** Whether the transport is actually playing right now (ECS-131) — `Transport.getStatus() === "playing"`. */
  readonly isPlaying?: () => boolean;
  /** The queue entry currently playing — `Transport.getCurrentChainEntryId()`. */
  readonly getCurrentChainEntryId?: () => ChainEntryId | null;
}

export type MidiConnectionStatus = "unavailable" | "idle" | "connecting" | "connected" | "error";

const MAX_LOG_LINES = 20;

export function useMidiControls(
  project: Project,
  dispatch: (action: Action) => void,
  transport: TransportCallbacks,
  patternId: PatternId,
  activeBank: number,
  selectBank: (bank: number) => void,
) {
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
    output: MidiOutput | undefined;
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
  // The fader page (ECS-96): which group of the selected bank's tracks the faders show. Owned here, not by the device.
  const faderPageRef = useRef(0);
  transportRef.current = transport;
  const bankRef = useRef(activeBank);
  bankRef.current = activeBank;
  const selectBankRef = useRef(selectBank);
  selectBankRef.current = selectBank;

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
      const rawOutput = outputId ? access.getOutput(outputId) : null;
      if (!rawInput) {
        setError("Select an input port.");
        return;
      }
      // A device that matches no registry entry connects generically on its input alone (ECS-106). The output is asked for
      // only when the device's profile needs one.
      const inputInfo = ports.find((port) => port.id === inputId);
      const device = resolveDevice({ name: inputInfo?.name ?? null });
      if (requiresOutput(device) && !rawOutput) {
        setError(`${device.label} needs an output port. Select one.`);
        return;
      }

      // midi-core's surface/sequencer plumbing keys its ports by the profile's own port ids (e.g. the Launchpad's
      // "midi-in"/"daw-in", the Push's "user-port-in", the generic profile's "main-in") -- never a fixed name.
      // Resolving by role here, the same way midi-core's own createSequencerBindings does internally, instead of a
      // hardcoded "midi-in"/"daw-in" literal, since the latter only matched the Launchpad's own ids by coincidence.
      const mainInputPortId = device.profile.ports.find((port) => port.type === "input" && port.role === "main")?.id;
      const mainOutputPortId = device.profile.ports.find((port) => port.type === "output" && port.role === "main")?.id;
      const dawInputPortId = device.profile.ports.find((port) => port.type === "input" && port.role === "daw-control")?.id;
      const dawOutputPortId = device.profile.ports.find((port) => port.type === "output" && port.role === "daw-control")?.id;

      await disconnect();

      setStatus("connecting");
      setError(null);

      const input = createMidiInput(rawInput);
      const output = rawOutput ? createMidiOutput(rawOutput) : undefined;
      input.onError((e) => appendLog(`input error: ${e.code} ${e.message}`));
      output?.onError((e) => appendLog(`output error: ${e.code} ${e.message}`));

      // The device's DAW pair, found by the registry's port names from its MIDI pair (ECS-96, ECS-103). The mixer's fader modes
      // need it; a device with no DAW ports, or one the system doesn't report them for, has no fader modes, and the rest of
      // the surface works as before.
      const daw = findDawPorts(device, ports, { input: inputInfo?.name, output: ports.find((port) => port.id === outputId)?.name });
      const rawDawInput = daw.input ? access.getInput(daw.input.id) : null;
      const rawDawOutput = daw.output ? access.getOutput(daw.output.id) : null;
      const dawInput = rawDawInput ? createMidiInput(rawDawInput) : undefined;
      const dawOutput = rawDawOutput ? createMidiOutput(rawDawOutput) : undefined;
      dawInput?.onMessage((message) => appendLog(`daw in:  ${describeMessage(message)}`));

      // Logs the literal MidiMessage the surface hands to output.send() -- channel included --
      // rather than a Control's onChange value. The two are not interchangeable: a mapping with
      // no feedback target never calls send() at all, so logging onChange directly as "out:"
      // claimed something went out over MIDI when nothing did. Wrapping send() itself can't lie
      // about that.
      if (output) {
        const loggedSend = output.send.bind(output);
        output.send = (message) => {
          appendLog(`out: ${describeMessage(message)}`);
          loggedSend(message);
        };
      }
      const unlogInput = input.onMessage((message) => appendLog(`in:  ${describeMessage(message)}`));

      // The device's fader count sets the size of a fader page (ECS-102). A device with no fader banks has 0, and then no
      // fader page exists.
      const faderPageSize = sequencerFaderCount(device.profile);
      const registry = createSequencerRegistry({
        getProject: () => projectRef.current,
        getPatternId: () => patternIdRef.current,
        dispatch,
        getFaderPage: () => faderPageRef.current,
        getBank: () => bankRef.current,
        setBank: (bank) => selectBankRef.current(bank),
        faderPageSize,
        getPlayhead: () => transportRef.current.getPlayheadInfo?.() ?? { patternId: null, beat: 0 },
        isPlaying: () => transportRef.current.isPlaying?.() ?? false,
        getCurrentChainEntryId: () => transportRef.current.getCurrentChainEntryId?.() ?? null,
      });
      const actions = {
        play: createAction({ id: "transport.play", label: "Play" }, () => transportRef.current.play()),
        stop: createAction({ id: "transport.stop", label: "Stop" }, () => transportRef.current.stop()),
      };

      faderPageRef.current = 0;
      // A fader page turn moves the faders to the next or previous group of the selected bank's tracks, clamped to that bank (ECS-113).
      const turnFaderPage = (delta: number) => {
        const lastPage = faderPagesPerBank(faderPageSize) - 1;
        faderPageRef.current = Math.min(lastPage, Math.max(0, faderPageRef.current + delta));
        connectionRef.current?.registry.syncFromProject(projectRef.current);
        connectionRef.current?.registry.repaintFaders();
      };
      const faderActions = {
        pageLeft: createAction({ id: "faders.pageLeft", label: "Fader page left" }, () => turnFaderPage(-1)),
        pageRight: createAction({ id: "faders.pageRight", label: "Fader page right" }, () => turnFaderPage(1)),
      };

      // The DAW ports the system has. Each is passed on its own: the DAW input carries the bank arrows on any device that has one
      // (ECS-114), and midi-core builds a fader mode only when both of its required ports are here. Whether they connect is the
      // surface's to report: a fader mode whose port fails to connect is refused when entered (ECS-104).
      const outputsByPortId: Record<string, MidiOutput> = {};
      if (output && mainOutputPortId) outputsByPortId[mainOutputPortId] = output;
      if (dawOutput && dawOutputPortId) outputsByPortId[dawOutputPortId] = dawOutput;
      const devices: SequencerDevices = {
        outputs: outputsByPortId,
        inputs: dawInput && dawInputPortId ? { [dawInputPortId]: dawInput } : {},
      };

      const sequencer = createSequencerBindings(
        input,
        device.profile,
        {
          stepTemplate: "step.{row}.{column}",
          stepDurationTemplate: "step.{row}.{column}.duration",
          lengthControl: "steps.length",
          muteTemplate: "mute.{track}",
          trackCountControl: "tracks.count",
          playheadControl: "transport.playhead",
          actions,
          faderActions,
          faderTemplates: { volume: "mixer.volume.{index}" },
          // The bank buttons (ECS-114): the device's layout names which buttons they are; the app's bank is bank.active.
          bankActions: createBankActions(() => bankRef.current, (bank) => selectBankRef.current(bank)),
          bankControl: "bank.active",
        },
        devices,
      );
      for (const role of sequencer.unresolved) appendLog(`unresolved: ${role}`);

      const surface = createControlSurface({
        profile: device.profile,
        ports: {
          inputs: { ...(mainInputPortId ? { [mainInputPortId]: input } : {}), ...(dawInput && dawInputPortId ? { [dawInputPortId]: dawInput } : {}) },
          outputs: outputsByPortId,
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
        setError(describeThrown(err));
        return;
      }

      // midi-core moves the surface to "error" when a connected port drops on its own (the cable
      // is pulled). Release the device and say so, so the panel offers Connect again instead of
      // still showing "connected" (ECS-94). The project state is left alone: it is this app's own.
      // A refused mode switch (a fader mode whose port isn't connected, ECS-104) is reported here, so it isn't silent.
      surface.onError((error) => appendLog(`surface error [${error.code}]: ${error.message}`));
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

  // Drives the playhead's MIDI feedback from the same clock usePlayheadAnimation.ts already polls for the
  // on-screen playhead (ECS-131) -- not a second, hardware-specific timer. Only runs while a device is actually
  // connected: there's nothing to repaint otherwise, and this is the one place in this file with an animation-frame
  // loop of its own, so it starts and stops with the connection rather than running for the component's whole life.
  // pollPatternLaunch() rides the same frame: playing/queued pattern state (ECS-117) also moves on the
  // transport's own clock, not only on a Project dispatch.
  useEffect(() => {
    if (status !== "connected") return;
    let frame: number;
    const poll = () => {
      connectionRef.current?.registry.pollPlayhead();
      connectionRef.current?.registry.pollPatternLaunch();
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [status]);

  // Switching bank returns the faders to that bank's first page (ECS-113), so they start on the
  // tracks the screen shows at the bank's start rather than a page further in.
  useEffect(() => {
    faderPageRef.current = 0;
    connectionRef.current?.registry.syncFromProject(projectRef.current);
    connectionRef.current?.registry.repaintFaders();
  }, [activeBank]);

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

// surface.attach() can reject with a SurfaceError -- a plain {code, message, cause} object, not an Error
// instance (midi-core's own stance: surface failures are reported in the surface's own terms, not as
// Error subclasses). String(err) on that shape gives "[object Object]", so .message is read directly when
// present, same as the existing surface.onError handler already assumes.
export function describeThrown(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

function describeMessage(message: MidiMessage): string {
  const clone: Record<string, unknown> = { ...message };
  delete clone.raw;
  return JSON.stringify(clone);
}
