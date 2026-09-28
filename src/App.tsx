import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { NoteId, TrackId } from "./model/types";
import { totalBeats } from "./model/types";
import { createInitialState } from "./model/pattern";
import { sequencerReducer } from "./model/reducer";
import { useAudioRuntime } from "./audio/useAudioRuntime";
import { Transport, type PlaybackStatus } from "./audio/transport";
import { useMasterFilterModule } from "./modules/useMasterFilterModule";
import { TransportBar } from "./components/TransportBar";
import { SequencerGrid } from "./components/SequencerGrid";
import { ModuleStrip } from "./components/ModuleStrip";

export function App() {
  const { runtime, error, init } = useAudioRuntime();
  const [state, dispatch] = useReducer(sequencerReducer, undefined, () => createInitialState());

  // Transport reads sequencer state through this ref rather than a closed-over value, so
  // its lookahead tick (running on a setInterval outside React's render cycle) always sees
  // the latest pattern/tempo without needing to be reconstructed on every edit.
  const stateRef = useRef(state);
  stateRef.current = state;

  const transportRef = useRef<Transport | null>(null);
  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  const [selectedNoteId, setSelectedNoteId] = useState<NoteId | null>(null);

  const masterFilter = useMasterFilterModule(runtime);

  useEffect(() => {
    if (runtime && !transportRef.current) {
      transportRef.current = new Transport(runtime, () => stateRef.current);
    }
  }, [runtime]);

  const ensureTransport = useCallback(async (): Promise<Transport | null> => {
    if (transportRef.current) return transportRef.current;
    const rt = await init();
    if (!rt) return null;
    const t = new Transport(rt, () => stateRef.current);
    transportRef.current = t;
    return t;
  }, [init]);

  const handlePlay = useCallback(async () => {
    const transport = await ensureTransport();
    transport?.play();
    setStatus(transport?.getStatus() ?? "stopped");
  }, [ensureTransport]);

  const handlePause = useCallback(() => {
    transportRef.current?.pause();
    setStatus(transportRef.current?.getStatus() ?? "stopped");
  }, []);

  const handleStop = useCallback(() => {
    transportRef.current?.stop();
    setStatus(transportRef.current?.getStatus() ?? "stopped");
  }, []);

  const handleTempoChange = useCallback((tempo: number) => {
    dispatch({ type: "SET_TEMPO", tempo });
    // Live tempo changes only take audible effect once the transport re-anchors its
    // schedule — see Transport.retime()'s doc comment for why that's required for a
    // click-free change rather than a retroactive one.
    transportRef.current?.retime();
  }, []);

  const handleAddNote = useCallback((trackId: TrackId, start: number) => {
    dispatch({ type: "ADD_NOTE", trackId, start });
  }, []);

  const handleResizeNote = useCallback((noteId: NoteId, duration: number) => {
    dispatch({ type: "RESIZE_NOTE", noteId, duration });
  }, []);

  const handleMoveNote = useCallback((noteId: NoteId, start: number) => {
    dispatch({ type: "MOVE_NOTE", noteId, start });
  }, []);

  const handleLoadSample = useCallback(
    async (trackId: TrackId, file: File) => {
      const runtimeInstance = runtime ?? (await init());
      if (!runtimeInstance) return;
      const arrayBuffer = await file.arrayBuffer();
      const meta = await runtimeInstance.loadSample(arrayBuffer, { name: file.name });
      dispatch({ type: "ASSIGN_SAMPLE", trackId, sampleId: meta.id, name: meta.name });
    },
    [runtime, init],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && selectedNoteId) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
        dispatch({ type: "REMOVE_NOTE", noteId: selectedNoteId });
        setSelectedNoteId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNoteId]);

  const getPositionText = useCallback(() => {
    const beat = transportRef.current?.getPlayheadBeat() ?? 0;
    const beatsPerBar = stateRef.current.beatsPerBar;
    const bar = Math.floor(beat / beatsPerBar) + 1;
    const beatInBar = Math.floor(beat % beatsPerBar) + 1;
    return `BAR ${bar}  BEAT ${String(beatInBar).padStart(2, "0")}`;
  }, []);

  const getPlayheadBeat = useCallback(() => transportRef.current?.getPlayheadBeat() ?? 0, []);

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <span className="brand">WEBSEQ</span>
          <span className="subtitle">// tracker client for webdsp</span>
        </div>
        <div className="subtitle">
          {totalBeats(state)} beats / {state.bars} bar{state.bars > 1 ? "s" : ""}
        </div>
      </div>

      <TransportBar
        status={status}
        tempo={state.tempo}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onTempoChange={handleTempoChange}
        getPositionText={getPositionText}
      />

      <div className="main">
        <SequencerGrid
          state={state}
          selectedNoteId={selectedNoteId}
          onSelectNote={setSelectedNoteId}
          onAddNote={handleAddNote}
          onResizeNote={handleResizeNote}
          onMoveNote={handleMoveNote}
          onLoadSample={handleLoadSample}
          getPlayheadBeat={getPlayheadBeat}
        />
        <ModuleStrip modules={[masterFilter]} />
      </div>

      {error && <div className="gesture-veil">Audio engine failed to start: {error}</div>}
      {!runtime && !error && (
        <div className="gesture-veil">
          <div className="card">
            <p>Click Play to start the audio engine (browser autoplay policy requires a gesture).</p>
            <button className="btn" onClick={handlePlay}>
              ▶ Start
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
