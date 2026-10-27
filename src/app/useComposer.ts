// The Composer's view state and behaviour: what is selected on the timeline, the copy buffer, and every handler the
// Composer toolbar, the lane headers and the Edit panel's Composer group call. The song itself (lanes, sequences) is the
// project (model/composer.ts); this holds only UI state, and every edit is a project action. App.tsx passes in the few
// things it owns that the Composer has to drive: pattern selection, the view, the FX target and the transport.
import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import type { Action } from "../model/reducer";
import { canInsertAt, composerLanes, copySequence, laneById, laneEnd, laneOfSequence, sequenceById, sequenceForPattern, type SequenceClip } from "../model/composer";
import type { LaneId, LaneModifiers, Pattern, PatternId, Project, SequenceId } from "../model/types";
import type { ComposerToolbarProps } from "../components/ComposerTimeline";
import type { ComposerDetailsProps } from "../components/ComposerDetails";
import type { MainView } from "./layout";

interface Deps {
  project: Project;
  dispatch: Dispatch<Action>;
  launcher: Pattern[];
  selectedPatternId: PatternId;
  setSelectedPatternId: (id: PatternId) => void;
  setMainView: (view: MainView) => void;
  /** Starts the song from `beat` (switching the transport to Song mode). */
  playSongFrom: (beat: number) => void;
}

export function useComposer({ project, dispatch, launcher, selectedPatternId, setSelectedPatternId, setMainView, playSongFrom }: Deps) {
  const [selectedSequenceId, setSelectedSequenceId] = useState<SequenceId | null>(null);
  const [selectedLaneId, setSelectedLaneId] = useState<LaneId | null>(null);
  const [clip, setClip] = useState<SequenceClip | null>(null);
  /** The timeline's horizontal scroll, kept here because the view unmounts while the Sequencer shows. */
  const scrollMemory = useRef(0);
  /** The marker: a bar boundary (0 = before bar 1) on the timeline, separate from the playhead. Where "▶ From here" starts and
   * where New sequence, Paste and Add pattern insert; null = not set (inserts go to the end of the lane, From here uses the
   * selected sequence). */
  const [marker, setMarker] = useState<number | null>(null);

  const sequence = sequenceById(project, selectedSequenceId);
  const lane = laneById(project, sequence ? (laneOfSequence(project, sequence.id)?.id ?? null) : selectedLaneId);
  /** The sequence the Sequencer is editing, if its pattern belongs to one: it is what "back to Composer" returns to. */
  const editingSequence = sequenceForPattern(project, selectedPatternId);

  const selectSequence = useCallback(
    (id: SequenceId) => {
      const seq = sequenceById(project, id);
      const owner = laneOfSequence(project, id);
      if (!seq || !owner) return;
      setSelectedSequenceId(id);
      setSelectedLaneId(owner.id);
      setSelectedPatternId(seq.patternId); // the grid, instrument and dock follow the sequence's pattern
    },
    [project, setSelectedPatternId],
  );

  const selectLane = useCallback(
    (id: LaneId | null) => {
      setSelectedLaneId(id);
      if (id === null) {
        setSelectedSequenceId(null);
        return;
      }
      // Clicking a lane that holds the selected sequence keeps it; any other lane clears the sequence.
      if (selectedSequenceId !== null && laneOfSequence(project, selectedSequenceId)?.id !== id) setSelectedSequenceId(null);
    },
    [project, selectedSequenceId],
  );

  /** A pattern appeared in the project (App's selection effect): if it is a Composer sequence's — added, duplicated or
   * pasted — that sequence becomes the selected one. */
  const onPatternAdded = useCallback(
    (patternId: PatternId) => {
      const seq = sequenceForPattern(project, patternId);
      if (seq) selectSequence(seq.id);
    },
    [project, selectSequence],
  );

  // A freshly added, empty lane becomes the selected one (a lane created along with its first sequence is left to
  // onPatternAdded, which selects that sequence and so its lane).
  const laneIds = composerLanes(project).map((l) => l.id);
  const prevLaneIds = useRef(laneIds);
  useEffect(() => {
    const added = laneIds.find((id) => !prevLaneIds.current.includes(id));
    prevLaneIds.current = laneIds;
    if (added && (laneById(project, added)?.sequences.length ?? 0) === 0) {
      setSelectedSequenceId(null);
      setSelectedLaneId(added);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneIds.join(",")]);

  const edit = useCallback(() => {
    if (!sequence) return;
    setSelectedPatternId(sequence.patternId);
    setMainView("sequencer");
  }, [sequence, setSelectedPatternId, setMainView]);

  const returnToComposer = useCallback(() => {
    if (editingSequence) selectSequence(editingSequence.id);
    setMainView("composer");
  }, [editingSequence, selectSequence, setMainView]);

  const removeSequence = useCallback(() => {
    if (!sequence) return;
    dispatch({ type: "COMPOSER_REMOVE", sequenceId: sequence.id });
    setSelectedSequenceId(null);
  }, [sequence, dispatch]);

  // Inserting at the marker is allowed only where the new sequence fits on the lane (the marker is in a gap, or at a sequence's end
  // with room after it). Where it does not, the action is off, not moved elsewhere. Afterwards the marker moves to the end of
  // what was inserted, so the next insert chains onto it.
  const fits = (bars: number) => marker === null || canInsertAt(project, lane?.id, marker, bars);
  const blockedReason = "The marker is on a sequence, or too close to the next one: move it to a free bar";
  const insertedAt = (bars: number) => {
    if (marker !== null) setMarker(marker + bars);
  };

  const toolbar: ComposerToolbarProps = {
    hasSelection: sequence !== undefined,
    hasMarker: marker !== null,
    canNewSequence: fits(1),
    canPaste: clip !== null && fits(clip.bars),
    blockedReason,
    onNewSequence: () => {
      dispatch({ type: "COMPOSER_ADD_BLANK", laneId: lane?.id, at: marker ?? undefined });
      insertedAt(1);
    },
    onAddLane: () => dispatch({ type: "COMPOSER_ADD_LANE" }),
    onDuplicate: () => sequence && dispatch({ type: "COMPOSER_DUPLICATE", sequenceId: sequence.id }),
    onCopy: () => sequence && setClip(copySequence(project, sequence.id)),
    onPaste: () => {
      if (!clip) return;
      if (marker !== null) dispatch({ type: "COMPOSER_PASTE", clip, laneId: lane?.id, at: marker, exact: true });
      else dispatch({ type: "COMPOSER_PASTE", clip, laneId: lane?.id, at: sequence ? sequence.start : laneEnd(project, lane) });
      insertedAt(clip.bars);
    },
    onDelete: removeSequence,
    onEdit: edit,
    onPlayFromHere: () => {
      if (marker !== null) playSongFrom(marker * project.beatsPerBar);
      else if (sequence) playSongFrom(sequence.start * project.beatsPerBar);
    },
  };

  const details: ComposerDetailsProps = {
    project,
    sequence,
    lane,
    launcher,
    onRename: (name: string) => sequence && dispatch({ type: "RENAME_PATTERN", patternId: sequence.patternId, name }),
    onResize: (bars: number) => sequence && dispatch({ type: "COMPOSER_RESIZE", sequenceId: sequence.id, bars }),
    onColor: (color: string) => sequence && dispatch({ type: "COMPOSER_SET_COLOR", sequenceId: sequence.id, color }),
    canInsertBars: fits,
    blockedReason,
    onAddPattern: (patternId: PatternId) => {
      dispatch({ type: "COMPOSER_ADD_PATTERN", patternId, laneId: lane?.id, at: marker ?? undefined });
      insertedAt(launcher.find((p) => p.id === patternId)?.bars ?? 1);
    },
    onSetLaneModifiers: (patch: Partial<LaneModifiers>) => lane && dispatch({ type: "COMPOSER_SET_LANE_MODIFIERS", laneId: lane.id, patch }),
  };

  const laneHandlers = {
    onRenameLane: (id: LaneId, name: string) => dispatch({ type: "COMPOSER_RENAME_LANE", laneId: id, name }),
    onMoveLane: (id: LaneId, index: number) => dispatch({ type: "COMPOSER_MOVE_LANE", laneId: id, index }),
    onRemoveLane: (id: LaneId) => {
      dispatch({ type: "COMPOSER_REMOVE_LANE", laneId: id });
      if (lane?.id === id) {
        setSelectedLaneId(null);
        setSelectedSequenceId(null);
      }
    },
  };

  return {
    sequence,
    lane,
    editingSequence,
    scrollMemory,
    marker,
    setMarker,
    selectSequence,
    selectLane,
    onPatternAdded,
    returnToComposer,
    toolbar,
    details,
    laneHandlers,
    onMove: (id: SequenceId, start: number, laneId: LaneId) => dispatch({ type: "COMPOSER_MOVE", sequenceId: id, start, laneId }),
    onResize: (id: SequenceId, bars: number) => dispatch({ type: "COMPOSER_RESIZE", sequenceId: id, bars }),
  };
}
