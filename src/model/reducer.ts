import type { AutomationEvent, AssetId, ChainEntryId, FxId, FxTarget, FxType, InstrumentKindId, NoteId, PatternId, PlaybackMode, Project, SampleEnvelope, SampleMode, TrackEventLfo, TrackId, TrackLfo, VoiceMode } from "./types";
import type { CopiedNote } from "./notes";
import type { CopiedTrackConfig } from "./trackConfig";
import type { Asset } from "./types";
import * as project from "./project";
import * as fx from "./fx";
import * as instruments from "./instruments";
import * as eventLfo from "./eventLfo";
import * as automation from "./automation";
import { sourceParamDefs } from "./modulation";
import * as trackConfig from "./trackConfig";
import * as edit from "./edit";
import { setTrackArp, type ArpVelocity, type TrackArp } from "./arp";
import { snapAddedNoteToScale } from "./scaleEntry";
import { setNoteChord, setNoteMode, type NoteChord } from "./chord";
import { applyRecipe } from "../guide/apply";
import type { Recipe } from "../guide/recipes";
import { setProjectScale, type ProjectScale } from "./scale";

export type Action =
  | { type: "SET_BPM"; bpm: number }
  | { type: "SET_SWING"; swing: number }
  | { type: "SET_PROJECT_NAME"; name: string }
  | { type: "SET_PROJECT_SCALE"; patch: Partial<ProjectScale> }
  | { type: "SET_TRACK_ARP"; trackId: TrackId; patch: Partial<Omit<TrackArp, "velocity">> & { velocity?: Partial<ArpVelocity> } }
  | { type: "APPLY_RECIPE"; recipe: Recipe; patternId: PatternId; trackId: TrackId | null; unavailableKinds?: InstrumentKindId[] }
  | { type: "ADD_ASSET"; asset: Asset }
  | { type: "ASSIGN_ASSET"; trackId: TrackId; assetId: AssetId }
  | { type: "RENAME_ASSET"; assetId: AssetId; name: string }
  | { type: "REMOVE_ASSET"; assetId: AssetId }
  | { type: "SET_TRACK_VOLUME"; trackId: TrackId; volume: number }
  | { type: "SET_TRACK_MUTED"; trackId: TrackId; muted: boolean }
  | { type: "SET_TRACK_SOLOED"; trackId: TrackId; soloed: boolean }
  | { type: "SET_TRACK_PLAYBACK_MODE"; trackId: TrackId; playbackMode: PlaybackMode }
  | { type: "SET_TRACK_VOICE_MODE"; trackId: TrackId; voiceMode: VoiceMode }
  | { type: "SET_TRACK_CHOKE_GROUP"; trackId: TrackId; chokeGroup: number | null }
  | { type: "SET_TRACK_PAN"; trackId: TrackId; pan: number }
  | { type: "SET_TRACK_OUTPUT"; trackId: TrackId; dest: TrackId | null }
  | { type: "SET_TRACK_SEND"; trackId: TrackId; dest: TrackId | null; amount?: number }
  | { type: "SET_TRACK_SEND_AMOUNT"; trackId: TrackId; amount: number }
  | { type: "SET_TRACK_INSTRUMENT"; trackId: TrackId; kind: InstrumentKindId | null }
  | { type: "SET_INSTRUMENT_PARAM"; trackId: TrackId; paramId: string; value: number }
  | { type: "SET_TRACK_EVENT_LFO"; trackId: TrackId; patch: Partial<TrackEventLfo> }
  | { type: "SET_NOTE_LFO"; patternId: PatternId; noteId: NoteId; amount: number }
  | { type: "SET_TRACK_NOTES_LFO"; patternId: PatternId; trackId: TrackId; amount: number }
  | { type: "ADD_INSTRUMENT_LFO"; trackId: TrackId; target: string }
  | { type: "SET_INSTRUMENT_LFO"; trackId: TrackId; index: number; patch: Partial<TrackLfo> }
  | { type: "REMOVE_INSTRUMENT_LFO"; trackId: TrackId; index: number }
  | { type: "SET_TRACK_SAMPLE_MODE"; trackId: TrackId; sampleMode: SampleMode }
  | { type: "SET_ASSET_CUES"; assetId: AssetId; cues: number[] }
  | { type: "SET_ASSET_CHOP_START"; assetId: AssetId; start: number }
  | { type: "SET_ASSET_ENVELOPE"; assetId: AssetId; envelope: Partial<SampleEnvelope> }
  | { type: "SET_ASSET_GAIN"; assetId: AssetId; gain: number }
  | { type: "SET_NOTE_PITCH"; patternId: PatternId; noteId: NoteId; pitch: number }
  | { type: "SET_NOTE_MODE"; patternId: PatternId; noteId: NoteId; mode: "note" | "chord" }
  | { type: "SET_NOTE_CHORD"; patternId: PatternId; noteId: NoteId; patch: Partial<NoteChord> }
  | { type: "SET_NOTE_VELOCITY"; patternId: PatternId; noteId: NoteId; velocity: number }
  | { type: "ADD_NOTE"; patternId: PatternId; trackId: TrackId; start: number }
  | { type: "REMOVE_NOTE"; patternId: PatternId; noteId: NoteId }
  | { type: "CLEAR_TRACK_NOTES"; patternId: PatternId; trackId: TrackId }
  | { type: "PASTE_NOTES"; patternId: PatternId; trackId: TrackId; notes: CopiedNote[] }
  | { type: "PASTE_TRACK_CONFIG"; trackId: TrackId; config: CopiedTrackConfig }
  | { type: "PASTE_TRACK"; trackId: TrackId; patternId: PatternId; clip: edit.TrackClip }
  | { type: "PASTE_INSTRUMENT"; trackId: TrackId; clip: edit.InstrumentClip }
  | { type: "PASTE_FX"; trackId: TrackId; clip: edit.FxClip }
  | { type: "PASTE_MODULATION"; trackId: TrackId; clip: edit.ModulationClip }
  | { type: "PASTE_BANK"; bank: number; clip: edit.BankClip }
  | { type: "DUPLICATE_SEQUENCE"; patternId: PatternId }
  | { type: "DUPLICATE_BAR"; patternId: PatternId; bar: number }
  | { type: "EXTEND_TRACK"; patternId: PatternId; trackId: TrackId; bars?: number }
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
  | { type: "MOVE_CHAIN_ENTRY"; entryId: ChainEntryId; toIndex: number }
  | { type: "ADD_FX_LFO"; target: FxTarget; fxId: FxId; param: string }
  | { type: "SET_FX_LFO"; target: FxTarget; fxId: FxId; index: number; patch: Partial<TrackLfo> }
  | { type: "REMOVE_FX_LFO"; target: FxTarget; fxId: FxId; index: number }
  | { type: "ADD_FX"; target: FxTarget; fxType: FxType }
  | { type: "REMOVE_FX"; target: FxTarget; fxId: FxId }
  | { type: "MOVE_FX"; target: FxTarget; fxId: FxId; index: number }
  | { type: "SET_FX_PARAM"; target: FxTarget; fxId: FxId; paramId: string; value: number }
  | { type: "SET_FX_ENABLED"; target: FxTarget; fxId: FxId; enabled: boolean }
  // Automation lanes: `fxId` null = the track's source (synth control / sample parameter).
  | { type: "SET_AUTOMATION_POINT"; target: FxTarget; fxId: FxId | null; parameter: string; position: number; value: number }
  | { type: "REMOVE_AUTOMATION_POINT"; target: FxTarget; fxId: FxId | null; parameter: string; position: number }
  | { type: "CLEAR_AUTOMATION_LANE"; target: FxTarget; fxId: FxId | null; parameter: string }
  | { type: "REPLACE_AUTOMATION_RANGE"; target: FxTarget; fxId: FxId | null; parameter: string; from: number; to: number; events: AutomationEvent[] }
  | { type: "LOAD_PROJECT"; project: Project };

/** After a track's source changes, drops source automation lanes the new source can't honour. */
function pruneSourceLanes(state: Project, trackId: TrackId): Project {
  const track = state.tracks.find((t) => t.id === trackId);
  if (!track) return state;
  const valid = new Set(sourceParamDefs(track).map((p) => p.id));
  return automation.pruneSourceLanes(state, trackId, (parameter) => valid.has(parameter));
}

export function projectReducer(state: Project, action: Action): Project {
  switch (action.type) {
    case "SET_BPM":
      return project.setBpm(state, action.bpm);
    case "SET_SWING":
      return project.setSwing(state, action.swing);
    case "SET_PROJECT_SCALE":
      return setProjectScale(state, action.patch);
    case "SET_TRACK_ARP":
      return setTrackArp(state, action.trackId, action.patch);
    case "SET_PROJECT_NAME":
      return project.renameProject(state, action.name);
    case "APPLY_RECIPE": {
      // Musical Guide "Try this" (guide/apply.ts): the one way the guide changes a project.
      const unavailable = action.unavailableKinds ?? [];
      const result = applyRecipe(state, action.recipe, { patternId: action.patternId, trackId: action.trackId, isKindAvailable: (k) => !unavailable.includes(k) });
      return result.ok ? result.project : state;
    }
    case "ADD_ASSET":
      return project.addAsset(state, action.asset);
    case "ASSIGN_ASSET":
      return pruneSourceLanes(project.assignAsset(state, action.trackId, action.assetId), action.trackId);
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
    case "SET_TRACK_CHOKE_GROUP":
      return project.setTrackChokeGroup(state, action.trackId, action.chokeGroup);
    case "SET_TRACK_PAN":
      return project.setTrackPan(state, action.trackId, action.pan);
    case "SET_TRACK_OUTPUT":
      return project.setTrackOutput(state, action.trackId, action.dest);
    case "SET_TRACK_SEND":
      return project.setTrackSend(state, action.trackId, action.dest, action.amount);
    case "SET_TRACK_SEND_AMOUNT":
      return project.setTrackSendAmount(state, action.trackId, action.amount);
    case "SET_TRACK_INSTRUMENT":
      return pruneSourceLanes(instruments.setTrackInstrument(state, action.trackId, action.kind), action.trackId);
    case "SET_INSTRUMENT_PARAM":
      return instruments.setInstrumentParam(state, action.trackId, action.paramId, action.value);
    case "SET_TRACK_EVENT_LFO":
      return eventLfo.setTrackEventLfo(state, action.trackId, action.patch);
    case "SET_NOTE_LFO":
      return eventLfo.setNoteLfo(state, action.patternId, action.noteId, action.amount);
    case "SET_TRACK_NOTES_LFO":
      return eventLfo.setTrackNotesLfo(state, action.patternId, action.trackId, action.amount);
    case "ADD_INSTRUMENT_LFO":
      return instruments.addInstrumentLfo(state, action.trackId, action.target);
    case "SET_INSTRUMENT_LFO":
      return instruments.setInstrumentLfo(state, action.trackId, action.index, action.patch);
    case "REMOVE_INSTRUMENT_LFO":
      return instruments.removeInstrumentLfo(state, action.trackId, action.index);
    case "SET_TRACK_SAMPLE_MODE":
      return project.setTrackSampleMode(state, action.trackId, action.sampleMode);
    case "SET_ASSET_CUES":
      return project.setAssetCues(state, action.assetId, action.cues);
    case "SET_ASSET_CHOP_START":
      return project.setAssetChopStart(state, action.assetId, action.start);
    case "SET_ASSET_GAIN":
      return project.setAssetGain(state, action.assetId, action.gain);
    case "SET_ASSET_ENVELOPE":
      return project.setAssetEnvelope(state, action.assetId, action.envelope);
    case "SET_NOTE_PITCH":
      return project.setNotePitch(state, action.patternId, action.noteId, action.pitch);
    case "SET_NOTE_MODE":
      return setNoteMode(state, action.patternId, action.noteId, action.mode);
    case "SET_NOTE_CHORD":
      return setNoteChord(state, action.patternId, action.noteId, action.patch);
    case "SET_NOTE_VELOCITY":
      return project.setNoteVelocity(state, action.patternId, action.noteId, action.velocity);
    case "ADD_NOTE":
      return snapAddedNoteToScale(state, project.addNote(state, action.patternId, action.trackId, action.start), action.patternId, action.trackId);
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
    case "PASTE_TRACK":
      return edit.pasteTrack(state, action.trackId, action.patternId, action.clip);
    case "PASTE_INSTRUMENT":
      return edit.pasteInstrument(state, action.trackId, action.clip);
    case "PASTE_FX":
      return edit.pasteFx(state, action.trackId, action.clip);
    case "PASTE_MODULATION":
      return edit.pasteModulation(state, action.trackId, action.clip);
    case "PASTE_BANK":
      return edit.pasteBank(state, action.bank, action.clip);
    case "DUPLICATE_SEQUENCE":
      return edit.duplicateSequence(state, action.patternId);
    case "DUPLICATE_BAR":
      return edit.duplicateBar(state, action.patternId, action.bar);
    case "EXTEND_TRACK":
      return edit.extendTrack(state, action.patternId, action.trackId, action.bars);
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
    case "MOVE_CHAIN_ENTRY":
      return project.moveChainEntry(state, action.entryId, action.toIndex);
    case "ADD_FX":
      return fx.addFx(state, action.target, action.fxType);
    case "REMOVE_FX":
      return fx.removeFx(state, action.target, action.fxId);
    case "MOVE_FX":
      return fx.moveFx(state, action.target, action.fxId, action.index);
    case "SET_FX_PARAM":
      return fx.setFxParam(state, action.target, action.fxId, action.paramId, action.value);
    case "SET_FX_ENABLED":
      return fx.setFxEnabled(state, action.target, action.fxId, action.enabled);
    case "ADD_FX_LFO":
      return fx.addFxLfo(state, action.target, action.fxId, action.param);
    case "SET_FX_LFO":
      return fx.setFxLfo(state, action.target, action.fxId, action.index, action.patch);
    case "REMOVE_FX_LFO":
      return fx.removeFxLfo(state, action.target, action.fxId, action.index);
    case "REPLACE_AUTOMATION_RANGE":
      return automation.replaceAutomationRange(state, action.target, action.fxId, action.parameter, action.from, action.to, action.events);
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
