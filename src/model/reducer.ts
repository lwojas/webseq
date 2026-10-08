import type { AssetId, ChainEntryId, FxId, FxTarget, FxType, NoteId, PatternId, PlaybackMode, Project, TrackId, VoiceMode } from "./types";
import type { CopiedNote } from "./notes";
import type { CopiedTrackConfig } from "./trackConfig";
import type { Asset } from "./types";
import * as project from "./project";
import * as fx from "./fx";
import * as automation from "./automation";
import * as trackConfig from "./trackConfig";

export type Action =
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_SWING"; swing: number }
  | { type: "SET_PROJECT_NAME"; name: string }
  | { type: "ADD_ASSET"; asset: Asset }
  | { type: "ASSIGN_ASSET"; trackId: TrackId; assetId: AssetId }
  | { type: "RENAME_ASSET"; assetId: AssetId; name: string }
  | { type: "REMOVE_ASSET"; assetId: AssetId }
  | { type: "SET_TRACK_VOLUME"; trackId: TrackId; volume: number }
  | { type: "SET_TRACK_MUTED"; trackId: TrackId; muted: boolean }
  | { type: "SET_TRACK_SOLOED"; trackId: TrackId; soloed: boolean }
  | { type: "SET_TRACK_PLAYBACK_MODE"; trackId: TrackId; playbackMode: PlaybackMode }
  | { type: "SET_TRACK_VOICE_MODE"; trackId: TrackId; voiceMode: VoiceMode }
  | { type: "ADD_NOTE"; patternId: PatternId; trackId: TrackId; start: number }
  | { type: "REMOVE_NOTE"; patternId: PatternId; noteId: NoteId }
  | { type: "CLEAR_TRACK_NOTES"; patternId: PatternId; trackId: TrackId }
  | { type: "PASTE_NOTES"; patternId: PatternId; trackId: TrackId; notes: CopiedNote[] }
  | { type: "PASTE_TRACK_CONFIG"; trackId: TrackId; config: CopiedTrackConfig }
  | { type: "RESIZE_NOTE"; patternId: PatternId; noteId: NoteId; duration: number; resolution?: number }
  | { type: "MOVE_NOTE"; patternId: PatternId; noteId: NoteId; start: number; resolution?: number }
  | { type: "SET_PATTERN_BARS"; patternId: PatternId; bars: number }
  | { type: "ADD_PATTERN" }
  | { type: "DUPLICATE_PATTERN"; patternId: PatternId }
  | { type: "REMOVE_PATTERN"; patternId: PatternId }
  | { type: "RENAME_PATTERN"; patternId: PatternId; name: string }
  | { type: "QUEUE_PATTERN_NEXT"; patternId: PatternId; afterEntryId: ChainEntryId | null }
  | { type: "REMOVE_FROM_QUEUE"; patternId: PatternId }
  | { type: "REMOVE_CHAIN_ENTRY"; entryId: ChainEntryId }
  | { type: "ADD_FX"; target: FxTarget; fxType: FxType }
  | { type: "REMOVE_FX"; target: FxTarget; fxId: FxId }
  | { type: "SET_FX_PARAM"; target: FxTarget; fxId: FxId; paramId: string; value: number }
  | { type: "SET_FX_ENABLED"; target: FxTarget; fxId: FxId; enabled: boolean }
  | { type: "SET_AUTOMATION_POINT"; target: FxTarget; fxId: FxId; parameter: string; position: number; value: number }
  | { type: "REMOVE_AUTOMATION_POINT"; target: FxTarget; fxId: FxId; parameter: string; position: number }
  | { type: "CLEAR_AUTOMATION_LANE"; target: FxTarget; fxId: FxId; parameter: string }
  | { type: "LOAD_PROJECT"; project: Project };

export function projectReducer(state: Project, action: Action): Project {
  switch (action.type) {
    case "SET_BPM":
      return project.setBpm(state, action.bpm);
    case "SET_SWING":
      return project.setSwing(state, action.swing);
    case "SET_PROJECT_NAME":
      return project.renameProject(state, action.name);
    case "ADD_ASSET":
      return project.addAsset(state, action.asset);
    case "ASSIGN_ASSET":
      return project.assignAsset(state, action.trackId, action.assetId);
    case "RENAME_ASSET":
      return project.renameAsset(state, action.assetId, action.name);
    case "REMOVE_ASSET":
      return project.removeAsset(state, action.assetId);
    case "SET_TRACK_VOLUME":
      return project.setTrackVolume(state, action.trackId, action.volume);
    case "SET_TRACK_MUTED":
      return project.setTrackMuted(state, action.trackId, action.muted);
    case "SET_TRACK_SOLOED":
      return project.setTrackSoloed(state, action.trackId, action.soloed);
    case "SET_TRACK_PLAYBACK_MODE":
      return project.setTrackPlaybackMode(state, action.trackId, action.playbackMode);
    case "SET_TRACK_VOICE_MODE":
      return project.setTrackVoiceMode(state, action.trackId, action.voiceMode);
    case "ADD_NOTE":
      return project.addNote(state, action.patternId, action.trackId, action.start);
    case "REMOVE_NOTE":
      return project.removeNote(state, action.patternId, action.noteId);
    case "CLEAR_TRACK_NOTES":
      return project.clearTrackNotes(state, action.patternId, action.trackId);
    case "PASTE_NOTES":
      // The App.tsx handler already called project.pasteNotes once itself to get the
      // pasted/skipped counts for its transient feedback message — this re-derives the same
      // deterministic placement decisions (only the generated note ids differ) to apply it as
      // a normal declarative action, consistent with every other note operation here.
      return project.pasteNotes(state, action.patternId, action.trackId, action.notes).project;
    case "PASTE_TRACK_CONFIG":
      return trackConfig.pasteTrackConfig(state, action.trackId, action.config);
    case "RESIZE_NOTE":
      return project.resizeNote(state, action.patternId, action.noteId, action.duration, action.resolution);
    case "MOVE_NOTE":
      return project.moveNote(state, action.patternId, action.noteId, action.start, action.resolution);
    case "SET_PATTERN_BARS":
      return project.setPatternBars(state, action.patternId, action.bars);
    case "ADD_PATTERN":
      return project.addPattern(state);
    case "DUPLICATE_PATTERN":
      return project.duplicatePattern(state, action.patternId);
    case "REMOVE_PATTERN":
      return project.removePattern(state, action.patternId);
    case "RENAME_PATTERN":
      return project.renamePattern(state, action.patternId, action.name);
    case "QUEUE_PATTERN_NEXT":
      return project.queuePatternNext(state, action.patternId, action.afterEntryId);
    case "REMOVE_FROM_QUEUE":
      return project.removePatternFromQueue(state, action.patternId);
    case "REMOVE_CHAIN_ENTRY":
      return project.removeChainEntry(state, action.entryId);
    case "ADD_FX":
      return fx.addFx(state, action.target, action.fxType);
    case "REMOVE_FX":
      return fx.removeFx(state, action.target, action.fxId);
    case "SET_FX_PARAM":
      return fx.setFxParam(state, action.target, action.fxId, action.paramId, action.value);
    case "SET_FX_ENABLED":
      return fx.setFxEnabled(state, action.target, action.fxId, action.enabled);
    case "SET_AUTOMATION_POINT":
      return automation.setAutomationPoint(state, action.target, action.fxId, action.parameter, action.position, action.value);
    case "REMOVE_AUTOMATION_POINT":
      return automation.removeAutomationPoint(state, action.target, action.fxId, action.parameter, action.position);
    case "CLEAR_AUTOMATION_LANE":
      return automation.clearAutomationLane(state, action.target, action.fxId, action.parameter);
    case "LOAD_PROJECT":
      return action.project;
  }
}
