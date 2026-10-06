import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AudioRuntime } from "webdsp";
import type { Asset, AssetId, FxId, FxTarget, FxType, NoteId, PlaybackMode, TrackId, VoiceMode } from "./model/types";
import { totalBeats, trackById } from "./model/types";
import { createInitialProject, summarizeBanks, withMissingTracks } from "./model/project";
import { DEFAULT_GRID_RESOLUTION, FREE_PLACEMENT_RESOLUTION, type GridResolution } from "./model/notes";
import { projectReducer } from "./model/reducer";
import { useAudioRuntime } from "./audio/useAudioRuntime";
import { useTimelineZoom } from "./hooks/useTimelineZoom";
import { Transport, type PlaybackStatus } from "./audio/transport";
import { Playback, type ManualPlaybackSnapshot } from "./audio/playback";
import { ensureTrackBuses, busIdForTarget, type TrackBusMap } from "./audio/buses";
import { syncBuses, type ConfiguredBuses } from "./audio/busSync";
import { encodeWav } from "./audio/wav";
import { saveProject, loadProject, listProjects, deleteProject } from "./persistence/projectStore";
import { remapAssetIds } from "./model/project";
import { TransportBar, type ResamplePhase } from "./components/TransportBar";
import { PatternBar } from "./components/PatternBar";
import { ChainEditor } from "./components/ChainEditor";
import { AssetsPanel } from "./components/AssetsPanel";
import { MidiPanel } from "./components/MidiPanel";
import { SequencerGrid } from "./components/SequencerGrid";
import { FxPanel } from "./components/FxPanel";
import { MixerPanel } from "./components/MixerPanel";
import { useMidiControls } from "./midi/useMidiControls";

/** The side panel (left of the timeline — see screenshots/concept.png) is tabbed so further
 * views can be added later without another layout change: add an entry here and a matching
 * branch in the side-panel-content render below. */
type SidePanelView = "assets" | "midi";
const SIDE_PANEL_VIEWS: { id: SidePanelView; label: string }[] = [
  { id: "assets", label: "Assets" },
  { id: "midi", label: "MIDI" },
];

/** The panel below the timeline (see screenshots/concept.png) switches between the FX rack
 * (contextual to whatever's selected in the timeline) and the Mixer (all tracks at once) —
 * same tabbed pattern as the side panel above. */
type BottomPanelView = "fx" | "mixer";
const BOTTOM_PANEL_VIEWS: { id: BottomPanelView; label: string }[] = [
  { id: "fx", label: "FX" },
  { id: "mixer", label: "Mixer" },
];

/** On a phone-sized viewport there isn't room for the side panel and bottom panel to sit
 * alongside the timeline the way they do on desktop (see index.css's `@media (max-width:
 * 768px)` block, which shows exactly one of these four sections at a time), so mobile gets
 * its own bottom tab bar covering all of them instead of the desktop's two separate tab
 * strips. This is pure navigation state — desktop's existing `sidePanelView`/`bottomPanelView`
 * still own which content actually renders inside each section (see handleSelectMobileTab). */
type MobileTab = "timeline" | "fx" | "mixer" | "assets";
const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "fx", label: "FX" },
  { id: "mixer", label: "Mixer" },
  { id: "assets", label: "Assets" },
];

/** Frees every sample the engine holds. New and Load replace the whole project, so the previous
 * project's decoded audio would otherwise stay resident for the rest of the session (ECS-84).
 * Callers stop the transport first, which silences any voice still reading one. */
function releaseEngineSamples(rt: AudioRuntime): void {
  for (const sample of rt.listSamples()) rt.removeSample(sample.id);
}

export function App() {
  const { runtime, error, init } = useAudioRuntime();
  const [project, dispatch] = useReducer(projectReducer, undefined, () => createInitialProject());

  // Transport (and the FX-push effect below) read project state through this ref rather than
  // a closed-over value, so the lookahead tick (running on a setInterval outside React's
  // render cycle) always sees the latest project without needing to be reconstructed on
  // every edit — same rationale as the original prototype's stateRef.
  const projectRef = useRef(project);
  projectRef.current = project;

  const trackBusesRef = useRef<TrackBusMap>({});
  const configuredBusesRef = useRef<ConfiguredBuses>(new Set());
  const assetDataRef = useRef<Map<AssetId, ArrayBuffer>>(new Map());
  const transportRef = useRef<Transport | null>(null);
  const playbackRef = useRef<Playback | null>(null);

  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  // Which asset is auditioning and which tracks are looping (ECS-83). Written only when the
  // Playback actually changes, so this re-renders on starts/stops/ends, not per tick.
  const [manual, setManual] = useState<ManualPlaybackSnapshot>({ auditionAssetId: null, loopingTrackIds: [] });
  const [selectedPatternId, setSelectedPatternId] = useState(project.patterns[0].id);
  const [sidePanelView, setSidePanelView] = useState<SidePanelView>("assets");
  const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>("fx");
  const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");
  const [selectedTarget, setSelectedTarget] = useState<FxTarget>("master");
  const [selectedFxId, setSelectedFxId] = useState<FxId | null>(null);
  const [selectedAutomationParamId, setSelectedAutomationParamId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<NoteId | null>(null);
  // Which bank of 16 tracks the sequencer shows (ECS-84). View state only, not saved with the project.
  const [activeBank, setActiveBank] = useState(0);
  const [gridResolution, setGridResolution] = useState<GridResolution>(DEFAULT_GRID_RESOLUTION);
  const { pxPerBeat, zoomPercent, canZoomIn, canZoomOut, onZoomIn, onZoomOut } = useTimelineZoom();
  const [savedProjects, setSavedProjects] = useState<{ id: string; name: string }[]>([]);
  const [loadTargetId, setLoadTargetId] = useState<string>("");
  const [resamplePhase, setResamplePhase] = useState<ResamplePhase>("idle");
  const [resampleError, setResampleError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const getBusId = useCallback((target: FxTarget) => busIdForTarget(trackBusesRef.current, target), []);

  // Manual voices (ECS-83) and Transport share one Playback, which must exist before Transport
  // is built: Transport registers its mono voices with it. Refuses manual starts while a
  // resample is armed or capturing, the same guard as the Transport's own resample state.
  const ensurePlayback = useCallback(
    (rt: AudioRuntime): Playback => {
      if (!playbackRef.current) {
        const playback = new Playback(rt, getBusId, () => (transportRef.current?.getResampleStatus() ?? "idle") !== "idle");
        playback.subscribe(setManual);
        playbackRef.current = playback;
      }
      return playbackRef.current;
    },
    [getBusId],
  );

  // Keep every track's bus assignment up to date (idempotent — see ensureTrackBuses) whenever
  // the runtime is ready or the track list changes, and construct Transport once.
  useEffect(() => {
    if (!runtime) return;
    trackBusesRef.current = ensureTrackBuses(runtime, project.tracks.map((t) => t.id), trackBusesRef.current);
    if (!transportRef.current) {
      transportRef.current = new Transport(runtime, () => projectRef.current, getBusId, ensurePlayback(runtime));
    }
  }, [runtime, project.tracks, getBusId, ensurePlayback]);

  // Manual voices whose track or asset changed under them (reassigned, removed) are released
  // here. Cheap: it scans at most one entry per track.
  useEffect(() => {
    playbackRef.current?.reconcile(project);
  }, [project]);

  // Push the full FX + mixer state to the engine on every project change — covers live
  // parameter edits (including volume/mute/solo drags), FX add/remove, and a freshly-loaded
  // project. Automation's own per-tick updates (Transport.pollAutomation) only take over from
  // here once playback starts. This is the same "dispatch -> reducer -> effect -> engine call"
  // path for volume/mute/solo as for FX params — no separate mixer update mechanism.
  useEffect(() => {
    if (!runtime) return;
    syncBuses(runtime, project, trackBusesRef.current, configuredBusesRef.current);
  }, [runtime, project]);

  // Keep the pattern selection valid: jump to a newly-added pattern, or off a removed one.
  const prevPatternIds = useRef(project.patterns.map((p) => p.id));
  useEffect(() => {
    const ids = project.patterns.map((p) => p.id);
    const added = ids.find((id) => !prevPatternIds.current.includes(id));
    if (added) setSelectedPatternId(added);
    else if (!ids.includes(selectedPatternId)) setSelectedPatternId(ids[0]);
    prevPatternIds.current = ids;
  }, [project.patterns, selectedPatternId]);

  // Keep the FX/automation selection valid as the selected target's chain changes.
  useEffect(() => {
    const owner = selectedTarget === "master" ? project.master : trackById(project, selectedTarget);
    const fx = owner?.fx ?? [];
    if (selectedFxId && !fx.some((f) => f.id === selectedFxId)) {
      setSelectedFxId(null);
      setSelectedAutomationParamId(null);
    }
  }, [project, selectedTarget, selectedFxId]);

  const ensureTransport = useCallback(async (): Promise<Transport | null> => {
    if (transportRef.current) return transportRef.current;
    const rt = await init();
    if (!rt) return null;
    trackBusesRef.current = ensureTrackBuses(rt, projectRef.current.tracks.map((t) => t.id), trackBusesRef.current);
    syncBuses(rt, projectRef.current, trackBusesRef.current, configuredBusesRef.current);
    const t = new Transport(rt, () => projectRef.current, getBusId, ensurePlayback(rt));
    transportRef.current = t;
    return t;
  }, [init, getBusId, ensurePlayback]);

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

  const midi = useMidiControls(project, dispatch, { play: () => void handlePlay(), stop: handleStop }, selectedPatternId);

  const handleBpmChange = useCallback((bpm: number) => {
    dispatch({ type: "SET_BPM", bpm });
    // Live BPM changes only take audible effect once the transport re-anchors its schedule —
    // see Transport.retime()'s doc comment for why that's required for a click-free change.
    transportRef.current?.retime();
  }, []);

  const handleSwingChange = useCallback((swing: number) => {
    dispatch({ type: "SET_SWING", swing });
    // Same re-anchoring requirement as BPM — see handleBpmChange above.
    transportRef.current?.retime();
  }, []);

  const handleAddNote = useCallback(
    (trackId: TrackId, start: number) => dispatch({ type: "ADD_NOTE", patternId: selectedPatternId, trackId, start }),
    [selectedPatternId],
  );
  // `freePlacement` (Alt/Option held at drag-end, see NoteBlock) swaps the toolbar-selected
  // musical-grid resolution for a fixed fine resolution rather than snapping to no grid at
  // all — see model/notes.ts's resizeNote/moveNote doc comments for why.
  const handleResizeNote = useCallback(
    (noteId: NoteId, duration: number, freePlacement: boolean) =>
      dispatch({
        type: "RESIZE_NOTE",
        patternId: selectedPatternId,
        noteId,
        duration,
        resolution: freePlacement ? FREE_PLACEMENT_RESOLUTION : gridResolution,
      }),
    [selectedPatternId, gridResolution],
  );
  const handleMoveNote = useCallback(
    (noteId: NoteId, start: number, freePlacement: boolean) =>
      dispatch({
        type: "MOVE_NOTE",
        patternId: selectedPatternId,
        noteId,
        start,
        resolution: freePlacement ? FREE_PLACEMENT_RESOLUTION : gridResolution,
      }),
    [selectedPatternId, gridResolution],
  );

  // Decodes a local file via the runtime (unchanged mechanism — see the project brief's "the
  // existing ability to load and play local audio must continue working") and adds it to the
  // Asset Bin. Shared by the Assets panel's "+ Import" (import only) and each track's "Load"
  // button (import, then immediately assign — see handleImportAndAssignToTrack).
  const importAsset = useCallback(
    async (file: File): Promise<Asset | null> => {
      const runtimeInstance = runtime ?? (await init());
      if (!runtimeInstance) return null;
      const arrayBuffer = await file.arrayBuffer();
      const meta = await runtimeInstance.loadSample(arrayBuffer.slice(0), { name: file.name });
      assetDataRef.current.set(meta.id, arrayBuffer);
      const asset: Asset = {
        id: meta.id,
        name: meta.name,
        type: "audio",
        duration: meta.duration,
        sampleRate: meta.sampleRate,
        channels: meta.channels,
        origin: "import",
      };
      dispatch({ type: "ADD_ASSET", asset });
      return asset;
    },
    [runtime, init],
  );

  const handleImportAsset = useCallback((file: File) => void importAsset(file), [importAsset]);

  const handleImportAndAssignToTrack = useCallback(
    async (trackId: TrackId, file: File) => {
      const asset = await importAsset(file);
      if (asset) dispatch({ type: "ASSIGN_ASSET", trackId, assetId: asset.id });
    },
    [importAsset],
  );

  const handleAssignAsset = useCallback(
    (trackId: TrackId, assetId: AssetId) => dispatch({ type: "ASSIGN_ASSET", trackId, assetId }),
    [],
  );
  const handleRenameAsset = useCallback((assetId: AssetId, name: string) => dispatch({ type: "RENAME_ASSET", assetId, name }), []);

  // Manual playback (ECS-83). Each one makes sure the runtime, buses and Playback exist first,
  // since the first click may be the one that initialises audio. That await is still inside
  // the user gesture, the same as Play.
  const handleAuditionAsset = useCallback(
    async (assetId: AssetId) => {
      await ensureTransport();
      playbackRef.current?.auditionAsset(assetId);
    },
    [ensureTransport],
  );
  const handleTriggerTrack = useCallback(
    async (trackId: TrackId) => {
      await ensureTransport();
      const track = trackById(projectRef.current, trackId);
      if (track) playbackRef.current?.pressTrack(track);
    },
    [ensureTransport],
  );
  // The engine stops any voice still playing this asset before freeing its PCM (webdsp's
  // Engine::removeSample), so removing an asset mid-playback is safe. Its raw bytes are dropped
  // here as well, so they don't stay in memory for the rest of the session (ECS-84).
  const handleRemoveAsset = useCallback(
    (assetId: AssetId) => {
      runtime?.removeSample(assetId);
      assetDataRef.current.delete(assetId);
      dispatch({ type: "REMOVE_ASSET", assetId });
    },
    [runtime],
  );

  const handleResample = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return;
    const armed = transport.armResample();
    if (!armed.ok) {
      setResamplePhase("error");
      setResampleError(armed.reason);
      return;
    }
    setResamplePhase("pending");
    setResampleError(null);
    try {
      const { metadata, channelData } = await armed.result;
      setResamplePhase("processing");
      const wavBytes = encodeWav(channelData.map((buf) => new Float32Array(buf)), metadata.sampleRate);
      assetDataRef.current.set(metadata.id, wavBytes);
      const resampleCount = projectRef.current.assets.filter((a) => a.origin === "resample").length + 1;
      const asset: Asset = {
        id: metadata.id,
        name: `Resample ${String(resampleCount).padStart(2, "0")}`,
        type: "audio",
        duration: metadata.duration,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        origin: "resample",
        sourcePatternId: armed.patternId,
      };
      dispatch({ type: "ADD_ASSET", asset });
      setResamplePhase("complete");
    } catch (err) {
      setResamplePhase("error");
      setResampleError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Backspace" || e.key === "Delete") && selectedNoteId) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
        dispatch({ type: "REMOVE_NOTE", patternId: selectedPatternId, noteId: selectedNoteId });
        setSelectedNoteId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNoteId, selectedPatternId]);

  const getPositionText = useCallback(() => {
    const info = transportRef.current?.getPlayheadInfo();
    const pattern = project.patterns.find((p) => p.id === info?.patternId);
    if (!info || !pattern) return "— —";
    const bar = Math.floor(info.beat / project.beatsPerBar) + 1;
    const beatInBar = Math.floor(info.beat % project.beatsPerBar) + 1;
    return `${pattern.name}  BAR ${bar}  BEAT ${String(beatInBar).padStart(2, "0")}`;
  }, [project.patterns, project.beatsPerBar]);

  const getPlayheadBeat = useCallback((): number | null => {
    const info = transportRef.current?.getPlayheadInfo();
    if (!info || info.patternId !== selectedPatternId) return null;
    return info.beat;
  }, [selectedPatternId]);

  const getResampleLabel = useCallback(() => transportRef.current?.getResampleStatus() ?? "idle", []);

  // --- FX / automation handlers ---
  const handleAddFx = useCallback((type: FxType) => dispatch({ type: "ADD_FX", target: selectedTarget, fxType: type }), [selectedTarget]);
  const handleRemoveFx = useCallback((fxId: FxId) => dispatch({ type: "REMOVE_FX", target: selectedTarget, fxId }), [selectedTarget]);
  const handleSetFxParam = useCallback(
    (fxId: FxId, paramId: string, value: number) => dispatch({ type: "SET_FX_PARAM", target: selectedTarget, fxId, paramId, value }),
    [selectedTarget],
  );
  const handleSetFxEnabled = useCallback(
    (fxId: FxId, enabled: boolean) => dispatch({ type: "SET_FX_ENABLED", target: selectedTarget, fxId, enabled }),
    [selectedTarget],
  );
  const handleSetAutomationPoint = useCallback(
    (fxId: FxId, parameter: string, position: number, value: number) =>
      dispatch({ type: "SET_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position, value }),
    [selectedTarget],
  );
  const handleRemoveAutomationPoint = useCallback(
    (fxId: FxId, parameter: string, position: number) =>
      dispatch({ type: "REMOVE_AUTOMATION_POINT", target: selectedTarget, fxId, parameter, position }),
    [selectedTarget],
  );
  const handleClearAutomationLane = useCallback(
    (fxId: FxId, parameter: string) => dispatch({ type: "CLEAR_AUTOMATION_LANE", target: selectedTarget, fxId, parameter }),
    [selectedTarget],
  );

  // --- mixer (volume/mute/solo) ---
  const handleSetTrackVolume = useCallback(
    (trackId: TrackId, volume: number) => dispatch({ type: "SET_TRACK_VOLUME", trackId, volume }),
    [],
  );
  const handleSetTrackMuted = useCallback(
    (trackId: TrackId, muted: boolean) => dispatch({ type: "SET_TRACK_MUTED", trackId, muted }),
    [],
  );
  const handleSetTrackSoloed = useCallback(
    (trackId: TrackId, soloed: boolean) => dispatch({ type: "SET_TRACK_SOLOED", trackId, soloed }),
    [],
  );

  // --- playback mode / voice mode (ECS-82/ECS-87/ECS-88) ---
  const handleSetTrackPlaybackMode = useCallback(
    (trackId: TrackId, playbackMode: PlaybackMode) => dispatch({ type: "SET_TRACK_PLAYBACK_MODE", trackId, playbackMode }),
    [],
  );
  const handleSetTrackVoiceMode = useCallback(
    (trackId: TrackId, voiceMode: VoiceMode) => dispatch({ type: "SET_TRACK_VOICE_MODE", trackId, voiceMode }),
    [],
  );

  const handleSelectTarget = useCallback((target: FxTarget) => {
    setSelectedTarget(target);
    setSelectedFxId(null);
    setSelectedAutomationParamId(null);
  }, []);

  // Keeps desktop's bottomPanelView in sync when mobile nav picks FX/Mixer, so the same
  // state that already decides what renders inside .bottom-panel (see the workspace JSX
  // below) works unchanged for both layouts — mobile just has a different set of buttons
  // driving it.
  const handleSelectMobileTab = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    if (tab === "fx" || tab === "mixer") setBottomPanelView(tab);
  }, []);

  // --- persistence ---
  const refreshSavedProjects = useCallback(() => {
    listProjects().then(setSavedProjects);
  }, []);
  useEffect(() => refreshSavedProjects(), [refreshSavedProjects]);

  const handleSaveProject = useCallback(async () => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveProject(project, assetDataRef.current);
      refreshSavedProjects();
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [project, refreshSavedProjects]);

  // Clears the transient "Saved ✓" confirmation after a couple seconds — a UI-only timer for a
  // toast message, not anything audio-timed, so a plain setTimeout is fine here (see
  // audio/transport.ts for where wall-clock timers are actually forbidden).
  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timer = setTimeout(() => setSaveStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const handleLoadProject = useCallback(async () => {
    if (!loadTargetId) return;
    const loaded = await loadProject(loadTargetId);
    if (!loaded) return;
    const runtimeInstance = runtime ?? (await init());
    if (!runtimeInstance) return;

    transportRef.current?.stop();
    releaseEngineSamples(runtimeInstance);
    const idMap = new Map<AssetId, AssetId>();
    assetDataRef.current = new Map();
    for (const asset of loaded.project.assets) {
      const data = loaded.assetData.get(asset.id);
      if (!data) continue;
      const meta = await runtimeInstance.loadSample(data.slice(0), { name: asset.name });
      idMap.set(asset.id, meta.id);
      assetDataRef.current.set(meta.id, data);
    }
    const remapped = withMissingTracks(remapAssetIds(loaded.project, idMap));
    // Deliberately NOT resetting trackBusesRef here: webdsp's createBus() hands buses out
    // from a one-way counter (MAX_TRACK_BUSES = 32) with no release call, so wiping this map
    // on every load would force a brand-new set of buses per load and exhaust the pool after
    // just two — see ensureTrackBuses' doc comment. Every project has the same fixed,
    // deterministic track ids (createInitialTracks: "track-1".."track-64" — there is no add/
    // remove-track feature), so the existing id -> bus mapping is still correct for whatever
    // project is loaded next; ensureTrackBuses only ever allocates for an id it hasn't seen.
    dispatch({ type: "LOAD_PROJECT", project: remapped });
    setStatus("stopped");
  }, [loadTargetId, runtime, init]);

  const handleNewProject = useCallback(() => {
    transportRef.current?.stop();
    if (runtime) releaseEngineSamples(runtime);
    assetDataRef.current = new Map();
    // See handleLoadProject's comment just above: trackBusesRef is intentionally kept, not
    // reset, since webdsp has no way to release a bus and every project shares the same
    // track ids.
    dispatch({ type: "LOAD_PROJECT", project: createInitialProject() });
    setStatus("stopped");
  }, [runtime]);

  const handleDeleteProject = useCallback(async () => {
    if (!loadTargetId) return;
    await deleteProject(loadTargetId);
    setLoadTargetId("");
    refreshSavedProjects();
  }, [loadTargetId, refreshSavedProjects]);

  const selectedPattern = project.patterns.find((p) => p.id === selectedPatternId) ?? project.patterns[0];
  const bankSummaries = useMemo(
    () => summarizeBanks(project, selectedPattern, manual.loopingTrackIds),
    [project, selectedPattern, manual.loopingTrackIds],
  );
  const fxOwner = selectedTarget === "master" ? project.master : trackById(project, selectedTarget);
  const playheadInfo = transportRef.current?.getPlayheadInfo();

  return (
    <div className="app" data-mobile-tab={mobileTab}>
      <div className="topbar">
        <div>
          <span className="brand">WEBSEQ</span>
          <input
            className="project-name-input"
            value={project.name}
            onChange={(e) => dispatch({ type: "SET_PROJECT_NAME", name: e.target.value })}
          />
        </div>
        <div className="project-controls">
          <button className="btn small" onClick={handleNewProject}>
            New
          </button>
          <button className="btn small" onClick={handleSaveProject} disabled={saveStatus === "saving"}>
            {saveStatus === "saving" ? "Saving…" : "Save"}
          </button>
          {saveStatus === "saved" && <span className="save-status saved">Saved ✓</span>}
          {saveStatus === "error" && (
            <span className="save-status error" title={saveError ?? undefined}>
              Save failed
            </span>
          )}
          <select className="project-select" value={loadTargetId} onChange={(e) => setLoadTargetId(e.target.value)}>
            <option value="">— saved projects —</option>
            {savedProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={handleLoadProject} disabled={!loadTargetId}>
            Load
          </button>
          <button className="btn small danger" onClick={handleDeleteProject} disabled={!loadTargetId}>
            Delete
          </button>
        </div>
        <div className="subtitle">
          {totalBeats(selectedPattern, project.beatsPerBar)} beats / {selectedPattern.bars} bar
          {selectedPattern.bars > 1 ? "s" : ""}
        </div>
      </div>

      <TransportBar
        status={status}
        bpm={project.bpm}
        swing={project.swing}
        gridResolution={gridResolution}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onBpmChange={handleBpmChange}
        onSwingChange={handleSwingChange}
        onGridResolutionChange={setGridResolution}
        zoomPercent={zoomPercent}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        getPositionText={getPositionText}
        canResample={status === "playing" && playheadInfo?.patternId != null && resamplePhase !== "pending" && resamplePhase !== "processing"}
        onResample={handleResample}
        resamplePhase={resamplePhase}
        resampleError={resampleError}
        getResampleLabel={getResampleLabel}
      />

      <PatternBar
        patterns={project.patterns}
        selectedPatternId={selectedPatternId}
        onSelectPattern={setSelectedPatternId}
        onAddPattern={() => dispatch({ type: "ADD_PATTERN" })}
        onDuplicatePattern={(id) => dispatch({ type: "DUPLICATE_PATTERN", patternId: id })}
        onRemovePattern={(id) => dispatch({ type: "REMOVE_PATTERN", patternId: id })}
        onRenamePattern={(id, name) => dispatch({ type: "RENAME_PATTERN", patternId: id, name })}
        onSetBars={(id, bars) => dispatch({ type: "SET_PATTERN_BARS", patternId: id, bars })}
      />

      <ChainEditor
        chain={project.patternChain}
        patterns={project.patterns}
        playingPatternId={status === "playing" ? (playheadInfo?.patternId ?? null) : null}
        onAppend={(patternId) => dispatch({ type: "APPEND_TO_CHAIN", patternId })}
        onRemoveEntry={(entryId) => dispatch({ type: "REMOVE_CHAIN_ENTRY", entryId })}
        onMoveEntry={(from, to) => dispatch({ type: "MOVE_CHAIN_ENTRY", fromIndex: from, toIndex: to })}
        selectedPatternIdToAdd={selectedPatternId}
      />

      <div className="workspace">
        <aside className="side-panel">
          <div className="side-panel-tabs">
            {SIDE_PANEL_VIEWS.map((view) => (
              <button
                key={view.id}
                className={`side-panel-tab ${sidePanelView === view.id ? "active" : ""}`}
                onClick={() => setSidePanelView(view.id)}
              >
                {view.label}
              </button>
            ))}
          </div>
          <div className="side-panel-content">
            {sidePanelView === "assets" && (
              <AssetsPanel
                assets={project.assets}
                selectedTarget={selectedTarget}
                onImport={handleImportAsset}
                onAssign={handleAssignAsset}
                onRename={handleRenameAsset}
                onRemove={handleRemoveAsset}
                auditioningAssetId={manual.auditionAssetId}
                onAudition={handleAuditionAsset}
                auditionDisabled={resamplePhase === "pending"}
              />
            )}
            {sidePanelView === "midi" && (
              <MidiPanel
                status={midi.status}
                hasAccess={midi.hasAccess}
                error={midi.error}
                inputs={midi.inputs}
                outputs={midi.outputs}
                log={midi.log}
                onRequestAccess={midi.requestAccess}
                onConnect={midi.connect}
                onDisconnect={midi.disconnect}
              />
            )}
          </div>
        </aside>

        <div className="main">
          <SequencerGrid
            project={project}
            pattern={selectedPattern}
            selectedTarget={selectedTarget}
            onSelectTarget={handleSelectTarget}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
            onAddNote={handleAddNote}
            onResizeNote={handleResizeNote}
            onMoveNote={handleMoveNote}
            onLoadSample={handleImportAndAssignToTrack}
            bank={activeBank}
            bankSummaries={bankSummaries}
            onSelectBank={setActiveBank}
            loopingTrackIds={manual.loopingTrackIds}
            triggerDisabled={resamplePhase === "pending"}
            onTriggerTrack={handleTriggerTrack}
            getPlayheadBeat={getPlayheadBeat}
            pxPerBeat={pxPerBeat}
          />
          <div className="bottom-panel">
            <div className="bottom-panel-tabs">
              {BOTTOM_PANEL_VIEWS.map((view) => (
                <button
                  key={view.id}
                  className={`bottom-panel-tab ${bottomPanelView === view.id ? "active" : ""}`}
                  onClick={() => setBottomPanelView(view.id)}
                >
                  {view.label}
                </button>
              ))}
            </div>
            {bottomPanelView === "fx" && (
              <FxPanel
                target={selectedTarget}
                track={selectedTarget === "master" ? null : (trackById(project, selectedTarget) ?? null)}
                fx={fxOwner?.fx ?? []}
                automation={fxOwner?.automation ?? []}
                patternTotalBeats={totalBeats(selectedPattern, project.beatsPerBar)}
                pxPerBeat={pxPerBeat}
                selectedFxId={selectedFxId}
                selectedAutomationParamId={selectedAutomationParamId}
                onSelectFx={(id) => {
                  setSelectedFxId(id);
                  setSelectedAutomationParamId(null);
                }}
                onAddFx={handleAddFx}
                onRemoveFx={handleRemoveFx}
                onSetFxParam={handleSetFxParam}
                onSetFxEnabled={handleSetFxEnabled}
                onSelectAutomationParam={setSelectedAutomationParamId}
                onSetAutomationPoint={handleSetAutomationPoint}
                onRemoveAutomationPoint={handleRemoveAutomationPoint}
                onClearAutomationLane={handleClearAutomationLane}
                onSetPlaybackMode={handleSetTrackPlaybackMode}
                onSetVoiceMode={handleSetTrackVoiceMode}
              />
            )}
            {bottomPanelView === "mixer" && (
              <MixerPanel
                tracks={project.tracks}
                onSetVolume={handleSetTrackVolume}
                onSetMuted={handleSetTrackMuted}
                onSetSoloed={handleSetTrackSoloed}
              />
            )}
          </div>
        </div>
      </div>

      {/* Hidden on desktop (see index.css) — on a phone-sized viewport this replaces the
          desktop side-panel/bottom-panel tab strips as the one control that switches which
          of Timeline/FX/Mixer/Assets is visible (see the @media block's section-visibility
          rules keyed off .app's data-mobile-tab attribute above). */}
      <nav className="mobile-tabbar">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`mobile-tab ${mobileTab === tab.id ? "active" : ""}`}
            onClick={() => handleSelectMobileTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

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
