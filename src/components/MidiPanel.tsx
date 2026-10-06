import type { MidiPortInfo } from "midi-core";
import { requiresOutput, resolveDevice } from "midi-core/devices";
import { useState } from "react";
import type { MidiConnectionStatus } from "../midi/useMidiControls";

interface Props {
  status: MidiConnectionStatus;
  hasAccess: boolean;
  error: string | null;
  inputs: readonly MidiPortInfo[];
  outputs: readonly MidiPortInfo[];
  log: readonly string[];
  onRequestAccess: () => void;
  onConnect: (inputId: string, outputId: string) => void;
  onDisconnect: () => void;
}

function portLabel(port: MidiPortInfo): string {
  return `${port.name ?? port.id}${port.manufacturer ? ` (${port.manufacturer})` : ""}`;
}

/** MIDI device connect/status surface — see ECS-38 and src/midi/ for the integration itself.
 * This panel only ever does three things: request Web MIDI access, pick an input (and an output, when the device needs one)
 * and connect, and show a short log of what crossed the wire. It has no idea what "track-1 volume" or "CC7" means, and no
 * idea which devices exist: midi-core's device registry (ECS-90) names the device for the selected input, falling back to
 * the generic device for one it doesn't know, and src/midi/useMidiControls.ts connects it. */
export function MidiPanel({ status, hasAccess, error, inputs, outputs, log, onRequestAccess, onConnect, onDisconnect }: Props) {
  const [inputId, setInputId] = useState("");
  const [outputId, setOutputId] = useState("");
  const connected = status === "connected" || status === "connecting";
  const selectedInput = inputs.find((port) => port.id === inputId);
  const device = selectedInput ? resolveDevice(selectedInput) : undefined;
  const outputNeeded = device !== undefined && requiresOutput(device);

  return (
    <div className="midi-panel">
      <div className="midi-panel-header">
        <span className="pattern-bar-label">MIDI</span>
        {!hasAccess && (
          <button className="btn small" onClick={onRequestAccess}>
            Request Access
          </button>
        )}
      </div>

      {status === "unavailable" && (
        <div className="midi-status error">
          Web MIDI unavailable{error ? `: ${error}` : ""}
        </div>
      )}

      {hasAccess && (
        <>
          <div className="midi-panel-row">
            <select value={inputId} onChange={(e) => setInputId(e.target.value)} disabled={connected}>
              <option value="">— input —</option>
              {inputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {portLabel(port)}
                </option>
              ))}
            </select>
            <select value={outputId} onChange={(e) => setOutputId(e.target.value)} disabled={connected}>
              <option value="">{outputNeeded ? "— output —" : "— output (optional) —"}</option>
              {outputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {portLabel(port)}
                </option>
              ))}
            </select>
          </div>

          {device && <div className="midi-status connected">Device: {device.label}</div>}

          <div className="midi-panel-row">
            {!connected ? (
              <button className="btn small" disabled={!inputId || (outputNeeded && !outputId)} onClick={() => onConnect(inputId, outputId)}>
                Connect
              </button>
            ) : (
              <button className="btn small" onClick={onDisconnect} disabled={status === "connecting"}>
                {status === "connecting" ? "Connecting…" : "Disconnect"}
              </button>
            )}
            <span className={`midi-status ${status}`}>{status}</span>
          </div>

          {error && status === "error" && <div className="midi-status error">{error}</div>}

          {device && <div className="midi-panel-hint">{device.help}</div>}

          <div className="midi-log">
            {log.length === 0 && <span className="chain-empty">no messages yet</span>}
            {log.map((line, i) => (
              <div key={i} className="midi-log-line">
                {line}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
