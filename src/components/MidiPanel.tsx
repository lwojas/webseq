import type { MidiPortInfo } from "midi-core";
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
 * This panel only ever does three things: request Web MIDI access, pick an input+output port
 * pair and connect, and show a short log of what crossed the wire. It has no idea what
 * "track-1 volume" or "CC7" means; src/midi/mappings.ts owns that, same separation the FX
 * panel keeps from applyFx.ts's engine translation. */
export function MidiPanel({ status, hasAccess, error, inputs, outputs, log, onRequestAccess, onConnect, onDisconnect }: Props) {
  const [inputId, setInputId] = useState("");
  const [outputId, setOutputId] = useState("");
  const connected = status === "connected" || status === "connecting";

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
              <option value="">— output —</option>
              {outputs.map((port) => (
                <option key={port.id} value={port.id}>
                  {portLabel(port)}
                </option>
              ))}
            </select>
          </div>

          <div className="midi-panel-row">
            {!connected ? (
              <button className="btn small" disabled={!inputId || !outputId} onClick={() => onConnect(inputId, outputId)}>
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

          <div className="midi-panel-hint">
            Track 1 only: CC7 on channel 0 → volume (input-only), pad note 0 → mute (echoes
            light/unlight feedback) — see src/midi/mappings.ts.
          </div>

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
