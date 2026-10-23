import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getHostState, hasEmbeddedHost, type AudioRuntime } from "webdsp";
import { forgetPeaks } from "./audio/peaks";
import type { Asset, AssetId, Project, ChainEntryId, FxId, FxTarget, FxType, InstrumentKindId, NoteId, PatternId, PlaybackMode, SampleEnvelope, SampleMode, Track, TrackEventLfo, TrackId, TrackLfo, VoiceMode } from "./model/types";
import { useAutomationEditing } from "./app/useAutomationEditing";
import { FX_KIND } from "./audio/fxChain";
import { notesForTrack, totalBeats, trackById, trackHasSource } from "./model/types";
import { BANK_SIZE, createInitialProject, pasteNotes, summarizeBanks, tracksInBank, withMissingTracks } from "./model/project";
import { DEFAULT_GRID_RESOLUTION, FREE_PLACEMENT_RESOLUTION, GRID_RESOLUTIONS, type CopiedNote, type GridResolution } from "./model/notes";
import { adjacentPatternId } from "./model/patternNav";
import { chainShiftForReorder, moveChainEntry } from "./model/project";
import { buildEditPanelModel, trackLabel, type EditClipboard } from "./app/editModel";
import { projectReducer } from "./model/reducer";
import { useAudioRuntime } from "./audio/useAudioRuntime";
import { createHostSync } from "./audio/hostSync";
import { attachPlainMidiInputs } from "./midi/dawNoteInput";
import { useTimelineZoom } from "./hooks/useTimelineZoom";
import { usePlayingPosition } from "./hooks/usePlayingPosition";
import { Transport, type PlaybackStatus } from "./audio/transport";
import { createSmoothClock } from "./audio/smoothClock";
import { Playback, type ManualPlaybackSnapshot } from "./audio/playback";
import { ensureTrackBuses, busIdForTarget, type TrackBusMap } from "./audio/buses";
import { syncBuses } from "./audio/busSync";
import { encodeWav } from "./audio/wav";
import { saveProject, loadProject, listProjects, deleteProject } from "./persistence/projectStore";
import { remapAssetIds } from "./model/project";
import type { NoteChord } from "./model/chord";
import { createRecoveryScheduler, timeAgo, type RecoveryRecord } from "./persistence/recovery";
import { fromHostSnapshot, publishRecord } from "./persistence/hostState";
import { putRecovery, getRecovery, getRecoveryAssets, clearRecovery, resetRecoveryAssetCache } from "./persistence/recoveryStore";
import type { ResamplePhase } from "./components/TransportBar";
import type { ImportBatchResult } from "./components/AssetsPanel";
import type { ModulationUi } from "./components/ModulationSlot";
import type { BarTool, ClipboardRow } from "./components/EditPanel";
import { Chrome } from "./app/Chrome";
import { MusicalGuide } from "./components/MusicalGuide";
import { INSTRUMENT_KINDS } from "./model/instruments";
import type { Recipe } from "./guide/recipes";
import { blockWhileGuideOpen, pauseForGuide } from "./guide/session";
import { Workspace } from "./app/Workspace";
import { PatternsView } from "./app/PatternsView";
import { MobileTabBar } from "./app/MobileTabBar";
import { deriveLayout, effectiveSideView, useLayout, type BottomPanelView, type LibraryView, type MainView, type MobileTab, type SidePanelView, type Takeover, type TrackSubTab } from "./app/layout";
import { useMidiControls } from "./midi/useMidiControls";
import { scaleOf, type ProjectScale } from "./model/scale";
import type { ArpVelocity, TrackArp } from "./model/arp";

/** Frees every sample the engine holds. New and Load replace the whole project, so the previous
 * project's decoded audio would otherwise stay resident for the rest of the session (ECS-84).
 * Callers stop the transport first, which silences any voice still reading one. */
function releaseEngineSamples(rt: AudioRuntime): void {
  for (const sample of rt.listSamples()) rt.removeSample(sample.id);
}

/** What the Edit panel gets while it isn't showing: shared empties, so nothing is allocated. */
const NO_EDIT_MODEL: { clipboardRows: ClipboardRow[]; barTools: BarTool[] } = { clipboardRows: [], barTools: [] };

export function App() {
  const { runtime, capabilities, error, init } = useAudioRuntime();
  const [project, dispatch] = useReducer(projectReducer, undefined, () => createInitialProject());

  // Transport (and the FX-push effect below) read project state through this ref rather than
  // a closed-over value, so the lookahead tick (running on a setInterval outside React's
  // render cycle) always sees the latest project without needing to be reconstructed on
  // every edit — same rationale as the original prototype's stateRef.
  const projectRef = useRef(project);
  projectRef.current = project;

  const trackBusesRef = useRef<TrackBusMap>({});
  const assetDataRef = useRef<Map<AssetId, ArrayBuffer>>(new Map());
  const transportRef = useRef<Transport | null>(null);
  const playbackRef = useRef<Playback | null>(null);

  const [status, setStatus] = useState<PlaybackStatus>("stopped");
  // The host tempo while following an external clock (audio/hostSync.ts); null when playing on our own.
  const [followedBpm, setFollowedBpm] = useState<number | null>(null);
  // Which asset is auditioning and which tracks are looping (ECS-83). Written only when the
  // Playback actually changes, so this re-renders on starts/stops/ends, not per tick.
  const [manual, setManual] = useState<ManualPlaybackSnapshot>({ auditionAssetId: null, loopingTrackIds: [] });
  const [selectedPatternId, setSelectedPatternId] = useState(project.patterns[0].id);
  const [sidePanelView, setSidePanelView] = useState<SidePanelView>("assets");
  const [bottomPanelView, setBottomPanelView] = useState<BottomPanelView>("instrument");
  const [mobileTab, setMobileTab] = useState<MobileTab>("timeline");
  const [trackSubTab, setTrackSubTab] = useState<TrackSubTab>("instrument");
  const [libraryView, setLibraryView] = useState<LibraryView>("assets");
  const [takeover, setTakeover] = useState<Takeover>("none");
  const layout = useLayout();
  const [mainView, setMainView] = useState<MainView>("sequencer");
  const [selectedTarget, setSelectedTarget] = useState<FxTarget>("master");
  const [selectedFxId, setSelectedFxId] = useState<FxId | null>(null);
  // Declared here, ahead of its original call site further down, because useMidiControls (ECS-155) now
  // needs it too -- a device's contextual selection buttons and Master/clear button select through the
  // same function a track row's click already does, never a separate setSelectedTarget call of their own.
  const handleSelectTarget = useCallback((target: FxTarget) => {
    setSelectedTarget(target);
    setSelectedFxId(null);
  }, []);
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
  const [importBatchResult, setImportBatchResult] = useState<ImportBatchResult | null>(null);
  // ECS-112's clipboard contract: project-local (not the system clipboard), self-contained
  // plain data (CopiedNote has no id/trackId — see notes.ts's doc comment), cleared on
  // New/Load so a stale "copied from Track X" label can never outlive the project it names.
  const [noteClipboard, setNoteClipboard] = useState<{ sourceTrackId: TrackId; notes: CopiedNote[] } | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);
  // The Edit panel's object clipboard: one slot per object kind (so copying FX never discards a
  // copied Track), each remembering where it came from for the panel's status text. Sequence has
  // no slot here: it is the note clipboard above, so the Edit panel and Cmd+C/V share it. Cleared
  // on New/Load with the others.
  const [editClipboard, setEditClipboard] = useState<EditClipboard>({});

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
      transportRef.current = new Transport(runtime, () => projectRef.current, getBusId, ensurePlayback(runtime), createSmoothClock(() => runtime.getCurrentTime(), () => performance.now() / 1000));
    }
  }, [runtime, project.tracks, getBusId, ensurePlayback]);

  // A runtime hosted by a plugin needs no user gesture, and the host's transport can start before anyone
  // clicks Play: bring the runtime up at startup so it can follow. In a browser this does nothing.
  useEffect(() => {
    if (hasEmbeddedHost()) void init();
  }, [init]);

  // Follow the host's transport when the runtime has one (a plugin host); never fires in a browser.
  useEffect(() => {
    if (!runtime) return;
    const sync = createHostSync({
      runtime,
      getTransport: () => transportRef.current,
      onChange: (bpm) => {
        setStatus(transportRef.current?.getStatus() ?? "stopped");
        setFollowedBpm(bpm);
      },
    });
    return () => sync.dispose();
  }, [runtime]);

  // Plain MIDI inputs (a keyboard; a plugin host's MIDI) play the selected track. A browser would ask permission
  // for MIDI on page load, so this listens only where the host provides its MIDI without asking.
  const selectedTargetRef = useRef(selectedTarget);
  selectedTargetRef.current = selectedTarget;
  useEffect(() => {
    if (!runtime || !hasEmbeddedHost()) return;
    const playback = ensurePlayback(runtime);
    const heldTrack = new Map<number, Track>(); // the key's note-on track, so its note-off ends the same voice
    const targetTrack = () => {
      const target = selectedTargetRef.current;
      return target === "master" ? undefined : trackById(projectRef.current, target);
    };
    return attachPlainMidiInputs({
      noteOn: (note, velocity) => {
        const track = targetTrack();
        if (track && playback.noteOn(track, note, velocity)) heldTrack.set(note, track);
      },
      noteOff: (note) => {
        const track = heldTrack.get(note);
        if (track) playback.noteOff(track, note);
        heldTrack.delete(note);
      },
      allNotesOff: () => {
        for (const [note, track] of heldTrack) playback.noteOff(track, note);
        heldTrack.clear();
      },
    });
  }, [runtime, ensurePlayback]);

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
    syncBuses(runtime, project, trackBusesRef.current);
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
    }
  }, [project, selectedTarget, selectedFxId]);

  const ensureTransport = useCallback(async (): Promise<Transport | null> => {
    if (transportRef.current) return transportRef.current;
    const rt = await init();
    if (!rt) return null;
    trackBusesRef.current = ensureTrackBuses(rt, projectRef.current.tracks.map((t) => t.id), trackBusesRef.current);
    syncBuses(rt, projectRef.current, trackBusesRef.current);
    const t = new Transport(rt, () => projectRef.current, getBusId, ensurePlayback(rt), createSmoothClock(() => rt.getCurrentTime(), () => performance.now() / 1000));
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

  // Queuing/removing a pattern is an ordinary project edit (model/project.ts's
  // queuePatternNext/removeChainEntry) — "after whatever's currently playing" comes from
  // Transport.getCurrentChainEntryId(), the one thing Transport still needs to expose for this.
  const handleQueueNext = useCallback((patternId: PatternId) => {
    dispatch({ type: "QUEUE_PATTERN_NEXT", patternId, afterEntryId: transportRef.current?.getCurrentChainEntryId() ?? null });
  }, []);

  // Targets one specific queue entry (PatternQueue's per-row Remove), not every occurrence of
  // its pattern -- see model/project.ts's removeChainEntry doc comment.
  const handleRemoveChainEntry = useCallback((entryId: ChainEntryId) => {
    dispatch({ type: "REMOVE_CHAIN_ENTRY", entryId });
  }, []);

  // Reordering the queue while it plays: the transport walks the queue with an ever-increasing step
  // counter, so a plain reorder would make "now" jump to another row and could repeat the sounding
  // pattern next. Shift the counter by the playing entry's change of position, in the same event
  // handler as the dispatch (a click: React flushes it before any scheduler tick can run), so the
  // sounding entry stays "now" and the next step follows ITS successor in the new order.
  const handleMoveChainEntry = useCallback((entryId: ChainEntryId, toIndex: number) => {
    const current = projectRef.current;
    const reordered = moveChainEntry(current, entryId, toIndex);
    if (reordered === current) return;
    const transport = transportRef.current;
    if (transport && transport.getStatus() !== "stopped") {
      transport.shiftChainSteps(chainShiftForReorder(current.patternChain, reordered.patternChain, transport.getCurrentChainEntryId()));
    }
    dispatch({ type: "MOVE_CHAIN_ENTRY", entryId, toIndex });
  }, []);

  // "bar 2 / 4" for whatever the transport is sounding. Reads refs only, so the callback is stable
  // and the RafText readouts that use it never re-subscribe.
  const getPlayingBarText = useCallback(() => {
    const info = transportRef.current?.getPlayheadInfo();
    if (!info || info.patternId == null) return "";
    const current = projectRef.current;
    const pattern = current.patterns.find((p) => p.id === info.patternId);
    if (!pattern) return "";
    const bar = Math.min(pattern.bars, Math.floor(info.beat / current.beatsPerBar) + 1);
    return `bar ${bar} / ${pattern.bars}`;
  }, []);

  // Musical Guide open state — declared ahead of the MIDI hookup because that must ignore input
  // while the guide is open (see the Musical Guide section below).
  const [guideOpen, setGuideOpen] = useState(false);
  const guideOpenRef = useRef(false);
  guideOpenRef.current = guideOpen;
  // Input that bypasses the inert DOM subtree is ignored while the guide is open.
  const guardedDispatch = useMemo(() => blockWhileGuideOpen(() => guideOpenRef.current, dispatch), []);

  const midi = useMidiControls(
    project,
    guardedDispatch,
    {
      play: blockWhileGuideOpen(() => guideOpenRef.current, () => void handlePlay()),
      stop: handleStop,
      pause: handlePause,
      // ECS-131: the same Transport.getPlayheadInfo()/getStatus() the on-screen playhead already reads.
      getPlayheadInfo: () => transportRef.current?.getPlayheadInfo() ?? { patternId: null, beat: 0 },
      isPlaying: () => transportRef.current?.getStatus() === "playing",
      getCurrentChainEntryId: () => transportRef.current?.getCurrentChainEntryId() ?? null,
    },
    selectedPatternId,
    activeBank,
    setActiveBank,
    setSelectedPatternId,
    selectedTarget,
    handleSelectTarget,
    selectedFxId,
    setSelectedFxId,
  );

  const handleBpmChange = useCallback((bpm: number) => {
    dispatch({ type: "SET_BPM", bpm });
    // Live BPM changes only take audible effect once the transport re-anchors its schedule —
    // see Transport.retime()'s doc comment for why that's required for a click-free change.
    transportRef.current?.retime();
  }, []);

  const handleScaleChange = useCallback((patch: Partial<ProjectScale>) => {
    dispatch({ type: "SET_PROJECT_SCALE", patch });
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
  const handleRemoveNote = useCallback(
    (noteId: NoteId) => dispatch({ type: "REMOVE_NOTE", patternId: selectedPatternId, noteId }),
    [selectedPatternId],
  );
  // Deliberate whole-track clear (ECS-107). Only ever called with an explicit trackId — the
  // keydown handler below gates it on selectedTarget already being a track (not "master"), and
  // TrackRow's header button only renders for the selected track — so a highlighted track alone
  // never clears by itself without a second, explicit action.
  const handleClearTrack = useCallback(
    (trackId: TrackId) => dispatch({ type: "CLEAR_TRACK_NOTES", patternId: selectedPatternId, trackId }),
    [selectedPatternId],
  );

  // ECS-112: whole-track copy/paste. Copy scope is deliberately "every note on the selected
  // track" rather than any finer selection — this app has no multi-note range-selection system,
  // and building one solely for copy/paste would be exactly the kind of feature-specific
  // machinery the parent brief (ECS-81) asks to avoid. `start` is carried through unchanged
  // (see notes.ts's CopiedNote doc comment) — there's no "paste cursor" concept, so paste always
  // reproduces the original beat positions, just under the destination trackId/pattern.
  const handleCopyTrack = useCallback(
    (trackId: TrackId) => {
      const pattern = project.patterns.find((p) => p.id === selectedPatternId) ?? project.patterns[0];
      const copied: CopiedNote[] = notesForTrack(pattern, trackId).map((n) => ({
        start: n.start,
        duration: n.duration,
        velocity: n.velocity,
        pitch: n.pitch,
        chord: n.chord,
        lfo: n.lfo,
      }));
      if (copied.length === 0) return;
      setNoteClipboard({ sourceTrackId: trackId, notes: copied });
      setClipboardStatus(`${trackLabel(project.tracks, trackId)} · ${copied.length} note${copied.length === 1 ? "" : "s"}`);
    },
    [project, selectedPatternId],
  );
  const handlePasteNotes = useCallback(() => {
    if (!noteClipboard || selectedTarget === "master") return;
    // Computed once here (for the feedback message) and again by the reducer below when
    // PASTE_NOTES is actually applied — both calls are pure and see the same project, so they
    // make identical pasted/skipped placement decisions (only the generated note ids differ,
    // and those aren't shown to the user). See reducer.ts's PASTE_NOTES case for why this
    // can't just dispatch the already-computed project directly.
    const preview = pasteNotes(project, selectedPatternId, selectedTarget, noteClipboard.notes);
    dispatch({ type: "PASTE_NOTES", patternId: selectedPatternId, trackId: selectedTarget, notes: noteClipboard.notes });
    const label = trackLabel(project.tracks, selectedTarget);
    setClipboardStatus(
      preview.skipped === 0
        ? `${label} · ${preview.pasted} note${preview.pasted === 1 ? "" : "s"}`
        : `${label} · ${preview.pasted}/${preview.pasted + preview.skipped} notes — ${preview.skipped} skipped (no room)`,
    );
  }, [noteClipboard, selectedTarget, selectedPatternId, project]);

  // Clears the transient clipboard feedback after a couple seconds — same pattern as
  // saveStatus's own timer above.
  useEffect(() => {
    if (!clipboardStatus) return;
    const timer = setTimeout(() => setClipboardStatus(null), 2000);
    return () => clearTimeout(timer);
  }, [clipboardStatus]);

  // Decodes a local file via the runtime (unchanged mechanism — see the project brief's "the
  // existing ability to load and play local audio must continue working") and adds it to the
  // Asset Bin. Shared by the Assets panel's batch "+ Import" (import only, see importAssets
  // below) and each track's "Load" button (import, then immediately assign — see
  // handleImportAndAssignToTrack).
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

  // Multi-file import for the Asset Bin's "+ Import" (ECS-130). Sequential, not Promise.all —
  // each call allocates the next engine sample id and mutates the shared assetDataRef, same
  // ordering concern as handleLoadProject's per-asset loop below. One file failing to decode
  // doesn't stop the rest; the result is surfaced as a single end-of-batch summary rather than
  // per-file UI, since importAsset itself had no error feedback before this.
  const importAssets = useCallback(
    async (files: File[]) => {
      const failed: { name: string; message: string }[] = [];
      for (const file of files) {
        try {
          const asset = await importAsset(file);
          if (!asset) failed.push({ name: file.name, message: "Audio engine unavailable" });
        } catch (err) {
          failed.push({ name: file.name, message: err instanceof Error ? err.message : String(err) });
        }
      }
      setImportBatchResult({ total: files.length, failed });
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
  const handleAuditionSlice = useCallback((assetId: AssetId, slice: number) => {
    playbackRef.current?.auditionSlice(assetId, slice);
  }, []);
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
      forgetPeaks(assetId);
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

  // Pattern navigation. ◀ ▶ and the [ ] keys step without opening the picker; picking from the
  // picker selects AND closes it.
  const handleStepPattern = useCallback(
    (direction: -1 | 1) => setSelectedPatternId((current) => adjacentPatternId(projectRef.current.patterns, current, direction)),
    [],
  );
  const handlePickPattern = useCallback((id: PatternId) => {
    setSelectedPatternId(id);
    setTakeover("none");
  }, []);
  const handleTogglePicker = useCallback(() => setTakeover((t) => (t === "picker" ? "none" : "picker")), []);
  const handleToggleSettings = useCallback(() => setTakeover((t) => (t === "settings" ? "none" : "settings")), []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (guideOpenRef.current) return; // the Musical Guide owns the keyboard while it is open
      if (e.key === "Escape") {
        setTakeover("none");
        return;
      }
      // [ and ] step to the previous/next pattern. Not while typing (the rename field etc.).
      if ((e.key === "[" || e.key === "]") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        if (target && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
        handleStepPattern(e.key === "[" ? -1 : 1);
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "SELECT")) return;
        // ECS-107: an individually selected step always takes precedence over whole-track
        // clearing — merely having a track highlighted (selectedTarget, used for the FX panel)
        // must never escalate a step deletion into a track clear.
        if (selectedNoteId) {
          dispatch({ type: "REMOVE_NOTE", patternId: selectedPatternId, noteId: selectedNoteId });
          setSelectedNoteId(null);
          return;
        }
        // No step selected: an explicitly selected track (not "master", which has no sequence)
        // clears that track's notes in the current pattern only. Requires two deliberate
        // actions — select the track, then press Delete/Backspace — the same explicitness
        // TrackRow's equivalent header button requires for touch (see ECS-107's investigation).
        if (selectedTarget !== "master") {
          dispatch({ type: "CLEAR_TRACK_NOTES", patternId: selectedPatternId, trackId: selectedTarget });
        }
        return;
      }
      // ECS-128: Space toggles the existing transport, but only once the gesture veil is
      // already dismissed (runtime truthy) — before that, Start must be an explicit click, not
      // a key first pressed before the engine exists. `e.repeat` guards against holding the key
      // down re-firing play/stop on every repeat event. Checks transportRef directly (as
      // useMidiControls' isPlaying already does for ECS-131) rather than the `status` state, so
      // this closure can't act on a stale play/stop value.
      if (e.code === "Space" && runtime && !e.repeat) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName))
        ) {
          return;
        }
        e.preventDefault();
        if (transportRef.current?.getStatus() === "playing") {
          handleStop();
        } else {
          void handlePlay();
        }
        return;
      }
      // ECS-112: Cmd/Ctrl+C / Cmd/Ctrl+V for the whole-track note clipboard. Guarded the same
      // way as Space above (text-entry/button targets excluded), plus `e.repeat` so holding the
      // key doesn't re-copy/re-paste every repeat event. Only preventDefault once a track is
      // actually selected and there's something to do, so a plain Cmd+C/V elsewhere on the page
      // (no track selected, or copying real text in a focused field) is left alone.
      if ((e.key === "c" || e.key === "C" || e.key === "v" || e.key === "V") && (e.metaKey || e.ctrlKey) && !e.repeat) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName))
        ) {
          return;
        }
        if (selectedTarget === "master") return;
        if (e.key === "c" || e.key === "C") {
          e.preventDefault();
          handleCopyTrack(selectedTarget);
        } else if (noteClipboard) {
          e.preventDefault();
          handlePasteNotes();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedNoteId,
    selectedPatternId,
    selectedTarget,
    runtime,
    handlePlay,
    handleStop,
    noteClipboard,
    handleCopyTrack,
    handlePasteNotes,
    handleStepPattern,
  ]);

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
  const handleMoveFx = useCallback(
    (fxId: FxId, index: number) => dispatch({ type: "MOVE_FX", target: selectedTarget, fxId, index }),
    [selectedTarget],
  );
  const handleSetFxEnabled = useCallback(
    (fxId: FxId, enabled: boolean) => dispatch({ type: "SET_FX_ENABLED", target: selectedTarget, fxId, enabled }),
    [selectedTarget],
  );
  const handleAddFxLfo = useCallback(
    (fxId: FxId, param: string) => dispatch({ type: "ADD_FX_LFO", target: selectedTarget, fxId, param }),
    [selectedTarget],
  );
  const handleSetFxLfo = useCallback(
    (fxId: FxId, index: number, patch: Partial<TrackLfo>) => dispatch({ type: "SET_FX_LFO", target: selectedTarget, fxId, index, patch }),
    [selectedTarget],
  );
  const handleRemoveFxLfo = useCallback(
    (fxId: FxId, index: number) => dispatch({ type: "REMOVE_FX_LFO", target: selectedTarget, fxId, index }),
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

  const handleSetTrackSend = useCallback(
    (trackId: TrackId, dest: TrackId | null, amount?: number) =>
      dispatch(
        dest === null || amount === undefined
          ? { type: "SET_TRACK_SEND", trackId, dest }
          : { type: "SET_TRACK_SEND_AMOUNT", trackId, amount },
      ),
    [],
  );

  const handleSetTrackOutput = useCallback(
    (trackId: TrackId, dest: TrackId | null) => dispatch({ type: "SET_TRACK_OUTPUT", trackId, dest }),
    [],
  );

  const handleSetTrackPan = useCallback(
    (trackId: TrackId, pan: number) => dispatch({ type: "SET_TRACK_PAN", trackId, pan }),
    [],
  );

  // --- instrument (synth source, sample envelope, selected-note pitch/velocity) ---
  const handleSetInstrument = useCallback(
    (trackId: TrackId, kind: InstrumentKindId | null) => dispatch({ type: "SET_TRACK_INSTRUMENT", trackId, kind }),
    [],
  );
  const handleSetInstrumentParam = useCallback(
    (trackId: TrackId, paramId: string, value: number) => dispatch({ type: "SET_INSTRUMENT_PARAM", trackId, paramId, value }),
    [],
  );
  const handleAddLfo = useCallback(
    (trackId: TrackId, target: string) => dispatch({ type: "ADD_INSTRUMENT_LFO", trackId, target }),
    [],
  );
  const handleSetLfo = useCallback(
    (trackId: TrackId, index: number, patch: Partial<TrackLfo>) => dispatch({ type: "SET_INSTRUMENT_LFO", trackId, index, patch }),
    [],
  );
  const handleRemoveLfo = useCallback(
    (trackId: TrackId, index: number) => dispatch({ type: "REMOVE_INSTRUMENT_LFO", trackId, index }),
    [],
  );
  const handleSetEnvelope = useCallback(
    (assetId: AssetId, envelope: Partial<SampleEnvelope>) => dispatch({ type: "SET_ASSET_ENVELOPE", assetId, envelope }),
    [],
  );
  const handleSetNotePitch = useCallback(
    (noteId: NoteId, pitch: number) => dispatch({ type: "SET_NOTE_PITCH", patternId: selectedPatternId, noteId, pitch }),
    [selectedPatternId],
  );
  // Length from the Track Editor's select: exact values, so snapped to the free-placement
  // resolution rather than the toolbar grid (which would round 1/4 to 1 on a 1-step grid).
  const handleSetNoteDuration = useCallback(
    (noteId: NoteId, duration: number) =>
      dispatch({ type: "RESIZE_NOTE", patternId: selectedPatternId, noteId, duration, resolution: FREE_PLACEMENT_RESOLUTION }),
    [selectedPatternId],
  );
  const handleSetTrackEventLfo = useCallback(
    (trackId: TrackId, patch: Partial<TrackEventLfo>) => dispatch({ type: "SET_TRACK_EVENT_LFO", trackId, patch }),
    [],
  );
  const handleSetTrackArp = useCallback(
    (trackId: TrackId, patch: Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> }) => dispatch({ type: "SET_TRACK_ARP", trackId, patch }),
    [],
  );
  const handleSetNoteLfo = useCallback(
    (noteId: NoteId, amount: number) => dispatch({ type: "SET_NOTE_LFO", patternId: selectedPatternId, noteId, amount }),
    [selectedPatternId],
  );
  const handleSetTrackNotesLfo = useCallback(
    (trackId: TrackId, amount: number) => dispatch({ type: "SET_TRACK_NOTES_LFO", patternId: selectedPatternId, trackId, amount }),
    [selectedPatternId],
  );
  const handleSetNoteMode = useCallback(
    (noteId: NoteId, mode: "note" | "chord") => dispatch({ type: "SET_NOTE_MODE", patternId: selectedPatternId, noteId, mode }),
    [selectedPatternId],
  );
  const handleSetNoteChord = useCallback(
    (noteId: NoteId, patch: Partial<NoteChord>) => dispatch({ type: "SET_NOTE_CHORD", patternId: selectedPatternId, noteId, patch }),
    [selectedPatternId],
  );
  const handleSetNoteVelocity = useCallback(
    (noteId: NoteId, velocity: number) => dispatch({ type: "SET_NOTE_VELOCITY", patternId: selectedPatternId, noteId, velocity }),
    [selectedPatternId],
  );

  // --- playback mode / voice mode (ECS-82/ECS-87/ECS-88) ---
  const handleSetTrackPlaybackMode = useCallback(
    (trackId: TrackId, playbackMode: PlaybackMode) => dispatch({ type: "SET_TRACK_PLAYBACK_MODE", trackId, playbackMode }),
    [],
  );
  const handleSetSampleMode = useCallback(
    (trackId: TrackId, sampleMode: SampleMode) => dispatch({ type: "SET_TRACK_SAMPLE_MODE", trackId, sampleMode }),
    [],
  );
  const handleSetCues = useCallback((assetId: AssetId, cues: number[]) => dispatch({ type: "SET_ASSET_CUES", assetId, cues }), []);
  const handleSetChopStart = useCallback((assetId: AssetId, start: number) => dispatch({ type: "SET_ASSET_CHOP_START", assetId, start }), []);
  const getAssetBytes = useCallback((assetId: AssetId) => assetDataRef.current.get(assetId), []);
  const handleSetTrackVoiceMode = useCallback(
    (trackId: TrackId, voiceMode: VoiceMode) => dispatch({ type: "SET_TRACK_VOICE_MODE", trackId, voiceMode }),
    [],
  );

  const handleSetTrackChokeGroup = useCallback(
    (trackId: TrackId, chokeGroup: number | null) => dispatch({ type: "SET_TRACK_CHOKE_GROUP", trackId, chokeGroup }),
    [],
  );

  // Changing tab always leaves a takeover view (picker / settings), which only exist on the Timeline.
  const handleSelectMobileTab = useCallback((tab: MobileTab) => {
    setMobileTab(tab);
    setTakeover("none");
  }, []);
  const handleSelectLibraryView = useCallback((view: LibraryView) => {
    setLibraryView(view);
    if (view !== "patterns") setSidePanelView(view);
  }, []);

  // --- Musical Guide ---
  // A modal over the sequencer. Opening pauses playback and makes everything behind it inert
  // (focus, clicks, keys); the guard ref also covers the window key handler and MIDI input,
  // which are not part of the inert subtree. Closing just removes the overlay: it never resumes
  // playback and never touches the project (only "Try this" does, via APPLY_RECIPE).
  const appRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    appRef.current?.toggleAttribute("inert", guideOpen);
  }, [guideOpen]);
  const handleOpenGuide = useCallback(() => {
    if (pauseForGuide(transportRef.current)) setStatus(transportRef.current?.getStatus() ?? "stopped");
    setGuideOpen(true);
  }, []);
  const handleCloseGuide = useCallback(() => setGuideOpen(false), []);
  const getGuideRuntime = useCallback(async (): Promise<AudioRuntime | null> => runtime ?? (await init()), [runtime, init]);
  const unavailableKinds = useMemo(() => {
    const provided = capabilities?.instruments;
    return provided ? INSTRUMENT_KINDS.filter((k) => !provided.some((i) => i.id === k)) : [];
  }, [capabilities]);
  const handleApplyRecipe = useCallback(
    (recipe: Recipe) => dispatch({ type: "APPLY_RECIPE", recipe, patternId: selectedPatternId, trackId: selectedTarget === "master" ? null : selectedTarget, unavailableKinds }),
    [selectedPatternId, selectedTarget, unavailableKinds],
  );

  // --- persistence ---
  // A host with its own session (a plugin) keeps the project there; otherwise the local recovery slot does.
  const hostState = useMemo(() => getHostState(), []);
  const recoveryScheduler = useMemo(
    () =>
      createRecoveryScheduler({
        write: async (record) => {
          if (hostState) publishRecord(hostState, record, assetDataRef.current);
          else await putRecovery(record, assetDataRef.current);
        },
      }),
    [hostState],
  );
  // A recoverable previous session found at startup, shown as a prompt until the user picks.
  const [recoveryPrompt, setRecoveryPrompt] = useState<RecoveryRecord | null>(null);
  // Snapshots stay off until the startup check has resolved (and its prompt been answered), so
  // an edit made while the prompt is up can't overwrite the very record it offers. The check
  // result also gates the first run: the pristine initial project is never snapshotted.
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  useEffect(() => {
    if (hostState) {
      // The host's session is the source of truth: no recovery prompt, and edits publish from the start.
      setRecoveryChecked(true);
      return;
    }
    let cancelled = false;
    getRecovery().then((record) => {
      if (cancelled) return;
      setRecoveryPrompt(record);
      setRecoveryChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [hostState]);
  // The project object with nothing unsaved (initial / just New'd / just Loaded). Every reducer
  // edit yields a new object, so `project !== baseline` means "edited since".
  const cleanBaselineRef = useRef<Project>(project);
  useEffect(() => {
    if (!recoveryChecked || recoveryPrompt) return;
    if (project === cleanBaselineRef.current) return;
    recoveryScheduler.schedule({
      project,
      ui: { selectedPatternId, selectedTarget, activeBank, gridResolution },
    });
  }, [recoveryChecked, recoveryPrompt, project, selectedPatternId, selectedTarget, activeBank, gridResolution, recoveryScheduler]);
  useEffect(() => () => recoveryScheduler.cancel(), [recoveryScheduler]);

  const refreshSavedProjects = useCallback(() => {
    listProjects().then(setSavedProjects);
  }, []);
  useEffect(() => refreshSavedProjects(), [refreshSavedProjects]);

  const handleSaveProject = useCallback(async () => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveProject(project, assetDataRef.current);
      // The recovery snapshot only covers the gap before a save (same as webtracker) — drop it
      // so this saved session doesn't prompt for a restore next startup. A host's session is not
      // a recovery slot: it keeps tracking the project.
      if (!hostState) {
        recoveryScheduler.cancel();
        void clearRecovery();
      }
      refreshSavedProjects();
      setSaveStatus("saved");
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [project, refreshSavedProjects, recoveryScheduler, hostState]);

  // Clears the transient "Saved ✓" confirmation after a couple seconds — a UI-only timer for a
  // toast message, not anything audio-timed, so a plain setTimeout is fine here (see
  // audio/transport.ts for where wall-clock timers are actually forbidden).
  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timer = setTimeout(() => setSaveStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  // Replaces the open project with `loaded` (a saved project or a recovery record's project):
  // re-registers each asset's bytes with the engine, remaps ids, and swaps the project in.
  // Shared by Load and Restore so both go through one path.
  const installProject = useCallback(
    async (runtimeInstance: AudioRuntime, source: Project, assetData: Map<AssetId, ArrayBuffer>): Promise<Project> => {
      transportRef.current?.stop();
      releaseEngineSamples(runtimeInstance);
      const idMap = new Map<AssetId, AssetId>();
      assetDataRef.current = new Map();
      for (const asset of source.assets) {
        const data = assetData.get(asset.id);
        if (!data) continue;
        const meta = await runtimeInstance.loadSample(data.slice(0), { name: asset.name });
        idMap.set(asset.id, meta.id);
        assetDataRef.current.set(meta.id, data);
      }
      const remapped = withMissingTracks(remapAssetIds(source, idMap));
      // Deliberately NOT resetting trackBusesRef here: webdsp's createBus() hands buses out
      // from a one-way counter (MAX_TRACK_BUSES = 32) with no release call, so wiping this map
      // on every load would force a brand-new set of buses per load and exhaust the pool after
      // just two — see ensureTrackBuses' doc comment. Every project has the same fixed,
      // deterministic track ids (createInitialTracks: "track-1".."track-64" — there is no add/
      // remove-track feature), so the existing id -> bus mapping is still correct for whatever
      // project is loaded next; ensureTrackBuses only ever allocates for an id it hasn't seen.
      // A pending recovery write belongs to the project being replaced (webtracker's ordering rule).
      recoveryScheduler.cancel();
      resetRecoveryAssetCache();
      dispatch({ type: "LOAD_PROJECT", project: remapped });
      setStatus("stopped");
      // Not a correctness fix (track ids are fixed/deterministic across every project, so the
      // clipboard's positions would still make sense, and a stale copied assetId already falls
      // back to null on paste — see trackConfig.ts) — just avoids a copy from a previous
      // project session confusingly outliving it (ECS-112/ECS-124).
      setNoteClipboard(null);
      setEditClipboard({});
      return remapped;
    },
    [recoveryScheduler],
  );

  const handleLoadProject = useCallback(async () => {
    if (!loadTargetId) return;
    const loaded = await loadProject(loadTargetId);
    if (!loaded) return;
    const runtimeInstance = runtime ?? (await init());
    if (!runtimeInstance) return;
    // A freshly loaded project has nothing unsaved: don't snapshot it until it's edited.
    const installed = await installProject(runtimeInstance, loaded.project, loaded.assetData);
    cleanBaselineRef.current = installed;
  }, [loadTargetId, runtime, init, installProject]);

  // --- crash recovery (persistence/recovery.ts; modelled on webtracker's resume) ---
  // Installs a recovered/hosted record: the project and its assets, then the view state, validated against the
  // project actually installed.
  const restoreRecord = useCallback(
    async (runtimeInstance: AudioRuntime, record: RecoveryRecord, assetData: Map<AssetId, ArrayBuffer>) => {
      const installed = await installProject(runtimeInstance, record.project, assetData);
      const { ui } = record;
      const patternId = installed.patterns.some((p) => p.id === ui.selectedPatternId) ? ui.selectedPatternId : installed.patterns[0].id;
      setSelectedPatternId(patternId);
      setSelectedTarget(ui.selectedTarget === "master" || installed.tracks.some((t) => t.id === ui.selectedTarget) ? ui.selectedTarget : "master");
      setSelectedFxId(null);
      setActiveBank(Number.isInteger(ui.activeBank) && ui.activeBank >= 0 ? ui.activeBank : 0);
      if (GRID_RESOLUTIONS.includes(ui.gridResolution)) setGridResolution(ui.gridResolution);
    },
    [installProject],
  );

  const handleRestoreRecovery = useCallback(async () => {
    if (!recoveryPrompt) return;
    const record = recoveryPrompt;
    const runtimeInstance = runtime ?? (await init());
    if (!runtimeInstance) return;
    try {
      const assetData = await getRecoveryAssets(record);
      await restoreRecord(runtimeInstance, record, assetData);
      // The record stays in the slot: a restored session is still unsaved work, so (like
      // webtracker) it keeps prompting until saved or discarded. The restore itself re-writes it.
      setRecoveryPrompt(null);
    } catch {
      // Unreadable/incompatible data must never wedge startup: drop it and carry on.
      void clearRecovery();
      setRecoveryPrompt(null);
    }
  }, [recoveryPrompt, runtime, init, restoreRecord]);

  // The host handed back the session's project: install it, silently (no prompt: the session is the truth).
  // Re-subscribing (the runtime appearing) is handed the same snapshot again; it is installed once.
  const restoredSnapshotRef = useRef<unknown>(null);
  useEffect(() => {
    if (!hostState) return;
    return hostState.onRestore((snapshot) => {
      if (!snapshot || restoredSnapshotRef.current === snapshot) return; // null: a new session, nothing saved
      restoredSnapshotRef.current = snapshot;
      const restored = fromHostSnapshot(snapshot);
      if (!restored) return; // not ours, an unknown format or malformed: start fresh
      void (async () => {
        const runtimeInstance = runtime ?? (await init());
        if (!runtimeInstance) return;
        try {
          await restoreRecord(runtimeInstance, restored.record, restored.assetData);
        } catch {
          // keep running on the fresh project rather than wedge startup
        }
      })();
    });
  }, [hostState, runtime, init, restoreRecord]);

  const handleDismissRecovery = useCallback(() => {
    void clearRecovery();
    setRecoveryPrompt(null);
  }, []);

  const handleNewProject = useCallback(() => {
    transportRef.current?.stop();
    if (runtime) releaseEngineSamples(runtime);
    assetDataRef.current = new Map();
    // See handleLoadProject's comment just above: trackBusesRef is intentionally kept, not
    // reset, since webdsp has no way to release a bus and every project shares the same
    // track ids.
    const fresh = createInitialProject();
    recoveryScheduler.cancel();
    resetRecoveryAssetCache();
    hostState?.clear(); // the session now starts from nothing too
    cleanBaselineRef.current = fresh;
    dispatch({ type: "LOAD_PROJECT", project: fresh });
    setStatus("stopped");
    setNoteClipboard(null);
    setEditClipboard({});
  }, [runtime, recoveryScheduler, hostState]);

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
  // ECS-107: whether FxPanel's "Clear sequence" control has anything to clear — master has no
  // sequence, so this is always false for it. Checked here (not inside FxPanel) so the panel
  // stays a pure render of what it's given, consistent with its existing props.
  const selectedTrackHasNotes = selectedTarget !== "master" && notesForTrack(selectedPattern, selectedTarget).length > 0;
  // ECS-124: same rationale as selectedTrackHasNotes above, for the "Copy config" control.
  const selectedTrack = selectedTarget !== "master" ? trackById(project, selectedTarget) : undefined;
  // The modulation slot's option lists come from the engine (never per-synth tables here): the
  // selected synth's own modulation targets plus the shared waveform / division lists.
  const selectedKindId = selectedTrack?.instrument?.kind;
  const modulationUi = useMemo<ModulationUi | null>(() => {
    if (!runtime || !selectedKindId || !runtime.getModulationInfo) return null;
    const kind = runtime.getCapabilities().instruments.find((k) => k.id === selectedKindId)?.kind;
    if (kind === undefined) return null;
    const info = runtime.getModulationInfo();
    return {
      maxLfos: info.maxLfos,
      waveforms: info.waveforms,
      divisions: info.divisions.map((d) => d.name),
      targets: runtime.getModulationTargets(kind).map((p) => p.name),
    };
  }, [runtime, selectedKindId]);
  const selectedTrackAsset =
    selectedTrack?.assetId != null ? (project.assets.find((a) => a.id === selectedTrack.assetId) ?? null) : null;
  const selectedTrackAssetUseCount =
    selectedTrackAsset == null ? 0 : project.tracks.filter((t) => t.assetId === selectedTrackAsset.id).length;
  const selectedNote =
    selectedNoteId && selectedTrack ? (selectedPattern.notes[selectedNoteId] ?? null) : null;
  // The Edit panel's rows are closures over the selection and clipboard; build them only while the
  // panel is actually showing (the Edit tab of the side panel on desktop, the Track tab's Edit
  // sub-tab on a phone) instead of on every render of the app.
  const editShowing = layout.isPhone ? mobileTab === "track" && trackSubTab === "edit" : sidePanelView === "edit";
  const { clipboardRows, barTools } = editShowing
    ? buildEditPanelModel({
        project,
        selectedTrack,
        selectedPattern,
        selectedNote,
        selectedTrackHasNotes,
        editClipboard,
        setEditClipboard,
        noteClipboard,
        activeBank,
        dispatch,
        setClipboardStatus,
        onCopySequence: handleCopyTrack,
        onPasteSequence: handlePasteNotes,
        onClearSequence: handleClearTrack,
      })
    : NO_EDIT_MODEL;
  const playheadInfo = transportRef.current?.getPlayheadInfo();
  // Polled, unlike playheadInfo above -- the queue now advances on its own (see
  // Project.patternChain's doc comment), so PatternStrip/PatternList/PatternQueue's highlighting
  // needs a real state update on a boundary crossing even when nothing else re-renders the
  // app (see usePlayingPosition's doc comment).
  const { patternId: playingPatternId, chainEntryId: playingChainEntryId } = usePlayingPosition(transportRef, status === "playing");

  // --- layout ---
  // What is showing where is decided by deriveLayout (and rendered by Chrome / Workspace); App only
  // owns the state and the behaviour.
  const derived = deriveLayout(layout, { mobileTab, mainView, takeover, bottomPanelView, trackSubTab, libraryView });
  // Automation (a base-value curve) and the engine's LFO bank are two kinds of modulation source;
  // both are edited through the same card. The focused lane is drawn as a row of the timeline.
  const { automationFor, row: automationRow } = useAutomationEditing({
    project,
    dispatch,
    selectedTarget,
    pattern: selectedPattern,
    pxPerBeat,
    timelineVisible: derived.timelineVisible,
  });
  // The engine's LFO options for an FX type (its own modulation targets plus the shared waveform /
  // division lists), like modulationUi below does for a synth.
  const fxLfoUi = useCallback(
    (type: FxType): ModulationUi | null => {
      if (!runtime?.getModulationInfo || !runtime.getEffectModulationTargets) return null;
      const info = runtime.getModulationInfo();
      return {
        maxLfos: info.maxLfos,
        waveforms: info.waveforms,
        divisions: info.divisions.map((d) => d.name),
        targets: runtime.getEffectModulationTargets(FX_KIND[type]).map((p) => p.name),
      };
    },
    [runtime],
  );
  const handleSelectDockView = (view: BottomPanelView) => {
    if (layout.isPhone) setTrackSubTab(view as TrackSubTab);
    else setBottomPanelView(view);
  };
  const handleSelectMainView = (view: MainView) => {
    setMainView(view);
    setTakeover("none");
  };
  // "Edit ▸" on the Patterns page: open that pattern in the timeline (Sequencer view / Timeline tab).
  const handleEditPattern = (id: PatternId) => {
    setSelectedPatternId(id);
    setTakeover("none");
    if (layout.isPhone) setMobileTab("timeline");
    else setMainView("sequencer");
  };

  // Track stepping (◀ ▶ in the Track column / phone Track tab): across all banks, moving the bank
  // with the selection so the selected row is always the one on screen.
  const selectedIndex = selectedTrack ? project.tracks.findIndex((t) => t.id === selectedTrack.id) : -1;
  const handleStepTrack = (direction: -1 | 1) => {
    const next = selectedIndex === -1 ? (direction === 1 ? 0 : -1) : selectedIndex + direction;
    const track = project.tracks[next];
    if (!track) return;
    handleSelectTarget(track.id);
    setActiveBank(Math.floor(next / BANK_SIZE));
  };
  const trackHeadLabel = selectedTrack
    ? `${String(selectedIndex + 1).padStart(2, "0")} · ${trackHasSource(selectedTrack) ? selectedTrack.name : "empty"}`
    : selectedTarget === "master"
      ? "MASTER"
      : "—";

  // Stable identity until the project's scale changes, so the memoised Track Editor isn't re-rendered
  // by every unrelated project edit.
  const projectScale = useMemo(() => scaleOf(project), [project.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectBarProps = {
    saveStatus,
    saveError,
    savedProjects,
    loadTargetId,
    onNew: handleNewProject,
    onSave: handleSaveProject,
    onSelectSaved: setLoadTargetId,
    onLoad: handleLoadProject,
    onDelete: handleDeleteProject,
  };
  const transportProps = {
    status,
    bpm: project.bpm,
    followedBpm,
    swing: project.swing,
    gridResolution,
    scale: projectScale,
    onScaleChange: handleScaleChange,
    onOpenGuide: handleOpenGuide,
    onPlay: handlePlay,
    onPause: handlePause,
    onStop: handleStop,
    onBpmChange: handleBpmChange,
    onSwingChange: handleSwingChange,
    onGridResolutionChange: setGridResolution,
    zoomPercent,
    canZoomIn,
    canZoomOut,
    onZoomIn,
    onZoomOut,
    getPositionText,
    canResample: status === "playing" && playheadInfo?.patternId != null && resamplePhase !== "pending" && resamplePhase !== "processing",
    onResample: handleResample,
    resamplePhase,
    resampleError,
    getResampleLabel,
  };
  const instrumentProps = {
    track: selectedTrack ?? null,
    asset: selectedTrackAsset,
    assetUseCount: selectedTrackAssetUseCount,
    onSetInstrument: handleSetInstrument,
    onSetInstrumentParam: handleSetInstrumentParam,
    modulation: modulationUi,
    onAddLfo: handleAddLfo,
    onSetLfo: handleSetLfo,
    onRemoveLfo: handleRemoveLfo,
    onSetEnvelope: handleSetEnvelope,
    automation: automationFor(null),
    onSetPlaybackMode: handleSetTrackPlaybackMode,
    onSetVoiceMode: handleSetTrackVoiceMode,
    onSetChokeGroup: handleSetTrackChokeGroup,
    onSetSampleMode: handleSetSampleMode,
    onSetCues: handleSetCues,
    onSetChopStart: handleSetChopStart,
    onAuditionSlice: handleAuditionSlice,
    getAssetBytes,
  };
  const editProps = { clipboard: clipboardRows, barTools, feedback: clipboardStatus };
  const trackHeaderProps = {
    track: selectedTrack ?? null,
    label: trackHeadLabel,
    canPrev: selectedIndex > 0,
    canNext: selectedIndex < project.tracks.length - 1,
    onStep: handleStepTrack,
    onSetMuted: handleSetTrackMuted,
    onSetSoloed: handleSetTrackSoloed,
    playing: status === "playing",
    onTogglePlay: () => (status === "playing" ? handleStop() : void handlePlay()),
  };
  const addPattern = () => dispatch({ type: "ADD_PATTERN" });
  const setPatternBars = (id: PatternId, bars: number) => dispatch({ type: "SET_PATTERN_BARS", patternId: id, bars });
  const duplicatePattern = (id: PatternId) => dispatch({ type: "DUPLICATE_PATTERN", patternId: id });
  const removePattern = (id: PatternId) => dispatch({ type: "REMOVE_PATTERN", patternId: id });
  const renamePattern = (id: PatternId, name: string) => dispatch({ type: "RENAME_PATTERN", patternId: id, name });

  return (
    <>
    <div className="app" ref={appRef} data-mobile-tab={mobileTab} data-main-view={mainView} data-takeover={derived.takeover} data-library-view={libraryView}>
      {recoveryPrompt && (
        <div className="recovery-banner" role="alert">
          <span>
            Previous session detected{recoveryPrompt.projectName ? ` — "${recoveryPrompt.projectName}"` : ""}, unsaved,{" "}
            {timeAgo(recoveryPrompt.savedAt)}. Restore it?
          </span>
          <div className="recovery-banner-actions">
            <button className="btn small" onClick={() => void handleRestoreRecovery()}>
              Restore
            </button>
            <button className="btn small" onClick={handleDismissRecovery}>
              Discard
            </button>
          </div>
        </div>
      )}
      <Chrome
        layout={layout}
        mainView={mainView}
        onSelectMainView={handleSelectMainView}
        mobileTab={mobileTab}
        libraryView={libraryView}
        onSelectLibraryView={handleSelectLibraryView}
        projectName={project.name}
        onRenameProject={(name) => dispatch({ type: "SET_PROJECT_NAME", name })}
        subtitle={`${totalBeats(selectedPattern, project.beatsPerBar)} beats / ${selectedPattern.bars} bar${selectedPattern.bars > 1 ? "s" : ""}`}
        projectBar={projectBarProps}
        transport={transportProps}
        patternStrip={{
          patterns: project.patterns,
          selectedPatternId,
          playingPatternId,
          onStep: handleStepPattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
          onDuplicate: duplicatePattern,
          onAddPattern: addPattern,
          onEditPlaying: () => playingPatternId && setSelectedPatternId(playingPatternId),
          getPlayingBarText,
        }}
        mobileTopBar={{
          status,
          onPlay: () => void handlePlay(),
          onStop: handleStop,
          patterns: project.patterns,
          selectedPatternId,
          bpm: project.bpm,
          pickerOpen: derived.takeover === "picker",
          settingsOpen: derived.takeover === "settings",
          onStep: handleStepPattern,
          onTogglePicker: handleTogglePicker,
          onToggleSettings: handleToggleSettings,
        }}
      />

      <Workspace
        layout={layout}
        derived={derived}
        mobileTab={mobileTab}
        sidePanel={{
          view: effectiveSideView(layout, sidePanelView),
          onSelectView: setSidePanelView,
          assets: {
            assets: project.assets,
            selectedTarget,
            onImport: importAssets,
            importStatus: importBatchResult,
            onAssign: handleAssignAsset,
            onRename: handleRenameAsset,
            onRemove: handleRemoveAsset,
            auditioningAssetId: manual.auditionAssetId,
            onAudition: handleAuditionAsset,
            auditionDisabled: resamplePhase === "pending",
          },
          midi: {
            status: midi.status,
            hasAccess: midi.hasAccess,
            error: midi.error,
            inputs: midi.inputs,
            outputs: midi.outputs,
            log: midi.log,
            onRequestAccess: midi.requestAccess,
            onConnect: midi.connect,
            onDisconnect: midi.disconnect,
          },
          edit: editProps,
        }}
        grid={{
          project,
          pattern: selectedPattern,
          selectedTarget,
          onSelectTarget: handleSelectTarget,
          selectedNoteId,
          onSelectNote: setSelectedNoteId,
          onAddNote: handleAddNote,
          onResizeNote: handleResizeNote,
          onMoveNote: handleMoveNote,
          onRemoveNote: handleRemoveNote,
          onSetMuted: handleSetTrackMuted,
          onSetSoloed: handleSetTrackSoloed,
          bank: activeBank,
          bankSummaries,
          onSelectBank: setActiveBank,
          loopingTrackIds: manual.loopingTrackIds,
          triggerDisabled: resamplePhase === "pending",
          onTriggerTrack: handleTriggerTrack,
          getPlayheadBeat,
          pxPerBeat,
          automationRow,
          active: derived.timelineVisible,
          bankPlacement: layout.isPhone ? "row" : "corner",
        }}
        picker={{
          patterns: project.patterns,
          selectedPatternId,
          playingPatternId,
          onPick: handlePickPattern,
          onAddPattern: addPattern,
          onDuplicate: duplicatePattern,
          onRemove: removePattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
        }}
        settings={{
          projectName: project.name,
          onRenameProject: (name) => dispatch({ type: "SET_PROJECT_NAME", name }),
          projectBar: projectBarProps,
          transport: transportProps,
        }}
        trackHeader={trackHeaderProps}
        dock={{
          onSelect: handleSelectDockView,
          fx: {
            target: selectedTarget,
            track: selectedTarget === "master" ? null : (trackById(project, selectedTarget) ?? null),
            tracks: project.tracks,
            onSetOutput: handleSetTrackOutput,
            onSetSend: handleSetTrackSend,
            fx: fxOwner?.fx ?? [],
            selectedFxId,
            onSelectFx: setSelectedFxId,
            onAddFx: handleAddFx,
            onRemoveFx: handleRemoveFx,
            onMoveFx: handleMoveFx,
            onSetFxParam: handleSetFxParam,
            onSetFxEnabled: handleSetFxEnabled,
            automationFor: (fxId: FxId) => automationFor(fxId),
            lfoUiFor: fxLfoUi,
            onAddFxLfo: handleAddFxLfo,
            onSetFxLfo: handleSetFxLfo,
            onRemoveFxLfo: handleRemoveFxLfo,
          },
          instrument: instrumentProps,
          editor: {
            track: selectedTrack ?? null,
            pattern: selectedPattern,
            beatsPerBar: project.beatsPerBar,
            selectedNoteId,
            onSelectNote: setSelectedNoteId,
            onAddNote: handleAddNote,
            onResizeNote: handleResizeNote,
            onMoveNote: handleMoveNote,
            onRemoveNote: handleRemoveNote,
            onSetNotePitch: handleSetNotePitch,
            onSetNoteVelocity: handleSetNoteVelocity,
            onSetNoteDuration: handleSetNoteDuration,
            onSetNoteMode: handleSetNoteMode,
            onSetNoteChord: handleSetNoteChord,
            chopAsset: selectedTrackAsset,
            scale: projectScale,
            onSetTrackArp: handleSetTrackArp,
            onSetTrackEventLfo: handleSetTrackEventLfo,
            onSetNoteLfo: handleSetNoteLfo,
            onSetTrackNotesLfo: handleSetTrackNotesLfo,
          },
          edit: editProps,
          mixer: {
            tracks: tracksInBank(project, activeBank),
            trackNumberOffset: activeBank * BANK_SIZE,
            onSetVolume: handleSetTrackVolume,
            onSetMuted: handleSetTrackMuted,
            onSetSoloed: handleSetTrackSoloed,
            onSetPan: handleSetTrackPan,
            runtime,
            getBusId,
          },
        }}
      />

      <PatternsView
        active={derived.patternsVisible}
        header={{
          editing: selectedPattern,
          playing: playingPatternId ? project.patterns.find((p) => p.id === playingPatternId) : undefined,
          onEditSelected: () => handleEditPattern(selectedPatternId),
          onAdd: addPattern,
          getPlayingBarText,
          backLabel: layout.isPhone ? "back to timeline" : "back to sequencer",
        }}
        list={{
          patterns: project.patterns,
          selectedPatternId,
          playingPatternId,
          onSelect: setSelectedPatternId,
          onEdit: handleEditPattern,
          onDuplicate: duplicatePattern,
          onRemove: removePattern,
          onRename: renamePattern,
          onSetBars: setPatternBars,
          onQueueNext: handleQueueNext,
        }}
        queue={{
          patternChain: project.patternChain,
          patterns: project.patterns,
          playingChainEntryId,
          onRemoveEntry: handleRemoveChainEntry,
          onMoveEntry: handleMoveChainEntry,
          getPlayingBarText,
        }}
      />

      <MobileTabBar active={mobileTab} onSelect={handleSelectMobileTab} />

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
    {guideOpen && (
      <MusicalGuide
        project={project}
        selectedPatternId={selectedPatternId}
        selectedTrackId={selectedTarget === "master" ? null : selectedTarget}
        getRuntime={getGuideRuntime}
        unavailableKinds={unavailableKinds}
        onApplyRecipe={handleApplyRecipe}
        onClose={handleCloseGuide}
      />
    )}
    </>
  );
}
