// The Edit panel's content: the clipboard rows (Track / Sequence / Instrument / FX / Modulation /
// Bank copy-paste) and the Bar Tools, built from the app's selection and clipboard state. Pure
// construction — no hooks, no rendering — so App.tsx keeps the state and this keeps the Edit
// panel's rules. The model logic itself lives in model/edit.ts.
import type { Dispatch } from "react";
import type { Action } from "../model/reducer";
import type { Note, Pattern, Project, Track, TrackId } from "../model/types";
import { BANK_SIZE } from "../model/project";
import { MAX_PATTERN_BARS, trackBarExtent } from "../model/notes";
import type { CopiedNote } from "../model/notes";
import {
  canPasteSynthLfos,
  copyBank,
  copyFx,
  copyInstrument,
  copyModulation,
  copyTrack,
  hasInstrument,
  hasModulation,
  type BankClip,
  type FxClip,
  type InstrumentClip,
  type ModulationClip,
  type TrackClip,
} from "../model/edit";
import type { BarTool, ClipboardRow } from "../components/EditPanel";

/** The Edit panel's object clipboard: one slot per object kind (so copying FX never discards a
 * copied Track), each remembering where it came from for the panel's status text. Sequence has
 * no slot here: it is the note clipboard, so the Edit panel and Cmd+C/V share it. Cleared on
 * New/Load with the others. */
export interface EditClipboard {
  track?: { clip: TrackClip; from: string };
  instrument?: { clip: InstrumentClip; from: string };
  fx?: { clip: FxClip; from: string };
  modulation?: { clip: ModulationClip; from: string };
  bank?: { clip: BankClip; from: string };
}

/** The positional "Track 03" label the clipboard's transient feedback uses — the same numbering
 * TrackRow/MixerPanel already show per track, not `track.name` (which becomes the assigned
 * sample's filename once one is assigned, per project.ts's assignAsset). */
export function trackLabel(tracks: { id: TrackId }[], trackId: TrackId): string {
  const idx = tracks.findIndex((t) => t.id === trackId);
  return `Track ${String(idx + 1).padStart(2, "0")}`;
}

export interface EditPanelContext {
  project: Project;
  selectedTrack: Track | undefined;
  selectedPattern: Pattern;
  selectedNote: Note | null;
  selectedTrackHasNotes: boolean;
  editClipboard: EditClipboard;
  setEditClipboard: (update: (current: EditClipboard) => EditClipboard) => void;
  noteClipboard: { sourceTrackId: TrackId; notes: CopiedNote[] } | null;
  activeBank: number;
  dispatch: Dispatch<Action>;
  setClipboardStatus: (message: string) => void;
  onCopySequence: (trackId: TrackId) => void;
  onPasteSequence: () => void;
  onClearSequence: (trackId: TrackId) => void;
}

export function buildEditPanelModel(ctx: EditPanelContext): { clipboardRows: ClipboardRow[]; barTools: BarTool[] } {
  const {
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
  } = ctx;
  const handleCopyTrack = ctx.onCopySequence;
  const handlePasteNotes = ctx.onPasteSequence;
  const handleClearTrack = ctx.onClearSequence;
  const bankName = (bank: number) => `Bank ${String.fromCharCode(65 + bank)}`;
  const trackWhere = (trackId: TrackId) =>
    `${bankName(Math.floor(project.tracks.findIndex((t) => t.id === trackId) / BANK_SIZE))} / ${trackLabel(project.tracks, trackId)}`;
  const noTrack = "Select a track";
  const trackBlock = (track: Track | undefined, has: boolean, empty: string) => (!track ? noTrack : has ? null : empty);
  const clipboardRows: ClipboardRow[] = (() => {
    const t = selectedTrack;
    const paste = (has: boolean, what: string) => (!t ? noTrack : has ? null : `No ${what} copied`);
    const ec = editClipboard;
    const noteFrom = noteClipboard
      ? `${trackWhere(noteClipboard.sourceTrackId)} · ${noteClipboard.notes.length} note${noteClipboard.notes.length === 1 ? "" : "s"}`
      : null;
    const done = (msg: string) => setClipboardStatus(msg);
    return [
      {
        id: "track", label: "Track", copied: ec.track?.from ?? null,
        copyBlocked: trackBlock(t, true, ""),
        pasteBlocked: paste(!!ec.track, "Track"),
        onCopy: () => {
          const clip = t && copyTrack(project, t.id, selectedPattern.id);
          if (!t || !clip) return;
          setEditClipboard((c) => ({ ...c, track: { clip, from: trackWhere(t.id) } }));
          done(`Track copied · ${trackWhere(t.id)}`);
        },
        onPaste: () => {
          if (!t || !ec.track) return;
          dispatch({ type: "PASTE_TRACK", trackId: t.id, patternId: selectedPattern.id, clip: ec.track.clip });
          done(`Track pasted → ${trackWhere(t.id)}`);
        },
      },
      {
        id: "sequence", label: "Sequence", copied: noteFrom,
        copyBlocked: trackBlock(t, selectedTrackHasNotes, "No steps on this track"),
        pasteBlocked: paste(!!noteClipboard, "Sequence"),
        onCopy: () => t && handleCopyTrack(t.id),
        onPaste: handlePasteNotes,
      },
      {
        id: "instrument", label: "Instrument", copied: ec.instrument?.from ?? null,
        copyBlocked: trackBlock(t, !!t && hasInstrument(t), "Track has no sample or synth"),
        pasteBlocked: paste(!!ec.instrument, "Instrument"),
        onCopy: () => {
          if (!t) return;
          setEditClipboard((c) => ({ ...c, instrument: { clip: copyInstrument(t), from: trackWhere(t.id) } }));
          done(`Instrument copied · ${trackWhere(t.id)}`);
        },
        onPaste: () => {
          if (!t || !ec.instrument) return;
          const stale = ec.instrument.clip.assetId != null && !project.assets.some((a) => a.id === ec.instrument!.clip.assetId);
          dispatch({ type: "PASTE_INSTRUMENT", trackId: t.id, clip: ec.instrument.clip });
          done(`Instrument pasted → ${trackWhere(t.id)}${stale ? " — copied asset no longer exists" : ""}`);
        },
      },
      {
        id: "fx", label: "FX", copied: ec.fx?.from ?? null,
        copyBlocked: trackBlock(t, !!t && t.fx.length > 0, "Track has no FX"),
        pasteBlocked: paste(!!ec.fx, "FX"),
        onCopy: () => {
          if (!t) return;
          setEditClipboard((c) => ({ ...c, fx: { clip: copyFx(t), from: trackWhere(t.id) } }));
          done(`FX copied · ${trackWhere(t.id)}`);
        },
        onPaste: () => {
          if (!t || !ec.fx) return;
          dispatch({ type: "PASTE_FX", trackId: t.id, clip: ec.fx.clip });
          done(`FX pasted → ${trackWhere(t.id)}`);
        },
      },
      {
        id: "modulation", label: "Modulation", copied: ec.modulation?.from ?? null,
        copyBlocked: trackBlock(t, !!t && hasModulation(t), "Track has no modulation"),
        pasteBlocked: paste(!!ec.modulation, "Modulation"),
        onCopy: () => {
          if (!t) return;
          setEditClipboard((c) => ({ ...c, modulation: { clip: copyModulation(t), from: trackWhere(t.id) } }));
          done(`Modulation copied · ${trackWhere(t.id)}`);
        },
        onPaste: () => {
          if (!t || !ec.modulation) return;
          const clip = ec.modulation.clip;
          dispatch({ type: "PASTE_MODULATION", trackId: t.id, clip });
          const skipped = clip.lfos.length > 0 && !canPasteSynthLfos(t, clip);
          done(`Modulation pasted → ${trackWhere(t.id)}${skipped ? " — synth LFOs skipped (different synth)" : ""}`);
        },
      },
      {
        id: "bank", label: "Bank", copied: ec.bank?.from ?? null,
        copyBlocked: null,
        pasteBlocked: ec.bank ? null : "No Bank copied",
        onCopy: () => {
          setEditClipboard((c) => ({ ...c, bank: { clip: copyBank(project, activeBank), from: bankName(activeBank) } }));
          done(`Bank copied · ${bankName(activeBank)}`);
        },
        onPaste: () => {
          if (!ec.bank) return;
          dispatch({ type: "PASTE_BANK", bank: activeBank, clip: ec.bank.clip });
          done(`Bank pasted → ${bankName(activeBank)}`);
        },
      },
    ];
  })();
  // "Current bar" is derived from existing selection, not a new one: the bar holding the selected
  // step in the selected pattern.
  const selectedStepBar =
    selectedNote && selectedNote.trackId === selectedTrack?.id ? Math.floor(selectedNote.start / project.beatsPerBar) : null;
  const barTools: BarTool[] = [
    {
      id: "clear-sequence", label: "Clear Sequence",
      blocked: !selectedTrack ? noTrack : selectedTrackHasNotes ? null : "No steps on this track",
      hint: selectedTrack ? `${trackLabel(project.tracks, selectedTrack.id)} · this pattern` : null,
      onRun: () => {
        if (!selectedTrack) return;
        handleClearTrack(selectedTrack.id);
        setClipboardStatus(`${trackLabel(project.tracks, selectedTrack.id)} · sequence cleared`);
      },
    },
    {
      id: "duplicate-sequence", label: "Duplicate Sequence",
      blocked: selectedPattern.bars * 2 > MAX_PATTERN_BARS ? `Would exceed ${MAX_PATTERN_BARS} bars` : null,
      hint: `${selectedPattern.bars} → ${selectedPattern.bars * 2} bars`,
      onRun: () => {
        dispatch({ type: "DUPLICATE_SEQUENCE", patternId: selectedPattern.id });
        setClipboardStatus(`Sequence duplicated · ${selectedPattern.bars * 2} bars`);
      },
    },
    {
      id: "duplicate-bar", label: "Duplicate Bar",
      blocked:
        selectedStepBar === null
          ? "Select a step to choose its bar"
          : selectedPattern.bars + 1 > MAX_PATTERN_BARS
            ? `Would exceed ${MAX_PATTERN_BARS} bars`
            : null,
      hint: selectedStepBar === null ? null : `Bar ${selectedStepBar + 1} → end (bar ${selectedPattern.bars + 1})`,
      onRun: () => {
        if (selectedStepBar === null) return;
        dispatch({ type: "DUPLICATE_BAR", patternId: selectedPattern.id, bar: selectedStepBar });
        setClipboardStatus(`Bar ${selectedStepBar + 1} appended as bar ${selectedPattern.bars + 1}`);
      },
    },
  ];
  // Extend Track: tracks have no length of their own, so the extent is derived from the steps.
  const extent = selectedTrack ? trackBarExtent(selectedPattern, selectedTrack.id, project.beatsPerBar) : 0;
  const extendBlocked = !selectedTrack
    ? noTrack
    : extent < 1
      ? "No steps on this track"
      : extent >= selectedPattern.bars
        ? "Track already reaches the sequence end"
        : null;
  const extendTool = (id: string, label: string, bars: number | undefined): BarTool => ({
    id, label, blocked: extendBlocked,
    hint: extendBlocked ? null : `Repeat bar ${extent} → bar ${bars === undefined ? selectedPattern.bars : extent + bars}`,
    onRun: () => {
      if (!selectedTrack || extendBlocked) return;
      dispatch({ type: "EXTEND_TRACK", patternId: selectedPattern.id, trackId: selectedTrack.id, bars });
      setClipboardStatus(`${trackLabel(project.tracks, selectedTrack.id)} · bar ${extent} repeated`);
    },
  });
  barTools.push(extendTool("extend-track-1", "Extend Track 1 Bar", 1), extendTool("extend-track-end", "Extend Track to Sequence End", undefined));
  return { clipboardRows, barTools };
}
