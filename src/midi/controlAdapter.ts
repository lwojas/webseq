// Adapts webseq's own state shape (a Project snapshot + reducer dispatch) to midi-core's
// Control contract, without webseq's model ever importing midi-core and without midi-core
// (or anything in src/midi/) reaching into the reducer/model beyond this one file's read/
// write functions. This is the one adapter boundary ECS-38 asked for: MIDI CC handling,
// device detection, and protocol/device logic all stay in src/midi/ and in midi-core itself
// — nothing about a Control's identity, range, or change notification leaks into
// src/model/ or src/components/, which still only know "track volume"/"track muted" as
// plain Project fields set via dispatch(), exactly as before this file existed.
//
// midi-core's Control is built for a live, mutable object (getValue/setValue/onChange); this
// app's state is an immutable Project snapshot replaced on every dispatch. A ProjectControl
// bridges that: getValue() reads the latest snapshot (via `getProject`), setValue() dispatches
// an action, and onChange() listeners are fired by syncFromProject() — called once per Project
// change (see useMidiControls' project-watching effect) — so a control also reports changes
// that didn't originate from MIDI (a UI fader drag, a project load), the same as any other
// Control implementation would for state that can change from multiple sources.

import type { BooleanControlDef, Control, ControlDef, ControlValue, NumericControlDef } from "midi-core/control-api";
import { MAX_TRACK_VOLUME, MIN_TRACK_VOLUME } from "../model/project";
import { trackById } from "../model/types";
import type { Project, TrackId } from "../model/types";
import type { Action } from "../model/reducer";

export interface ProjectControl<D extends ControlDef> extends Control<D> {
  /** Re-reads `project` and fires onChange() listeners if this control's value moved. Not
   * part of midi-core's Control contract -- this adapter's own sync hook, called by
   * useMidiControls' project-watching effect, never by a binding itself. */
  syncFromProject(project: Project): void;
}

function createProjectControl<D extends ControlDef>(
  def: D,
  getProject: () => Project,
  dispatch: (action: Action) => void,
  read: (project: Project) => ControlValue<D>,
  write: (value: ControlValue<D>) => Action,
): ProjectControl<D> {
  let current = read(getProject());
  const listeners = new Set<(value: ControlValue<D>, previous: ControlValue<D>) => void>();

  return {
    def,
    getValue: () => current,
    setValue: (value) => dispatch(write(value)),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncFromProject: (project) => {
      const next = read(project);
      if (next === current) return;
      const previous = current;
      current = next;
      for (const listener of listeners) listener(current, previous);
    },
  };
}

export function createTrackVolumeControl(
  trackId: TrackId,
  getProject: () => Project,
  dispatch: (action: Action) => void,
): ProjectControl<NumericControlDef> {
  const def: NumericControlDef = {
    id: `track.${trackId}.volume`,
    label: `${trackId} volume`,
    kind: "number",
    min: MIN_TRACK_VOLUME,
    max: MAX_TRACK_VOLUME,
    default: 1,
  };
  return createProjectControl(
    def,
    getProject,
    dispatch,
    (project) => trackById(project, trackId)?.volume ?? def.default,
    (volume) => ({ type: "SET_TRACK_VOLUME", trackId, volume }),
  );
}

export function createTrackMutedControl(
  trackId: TrackId,
  getProject: () => Project,
  dispatch: (action: Action) => void,
): ProjectControl<BooleanControlDef> {
  const def: BooleanControlDef = {
    id: `track.${trackId}.muted`,
    label: `${trackId} mute`,
    kind: "boolean",
    default: false,
  };
  return createProjectControl(
    def,
    getProject,
    dispatch,
    (project) => trackById(project, trackId)?.muted ?? def.default,
    (muted) => ({ type: "SET_TRACK_MUTED", trackId, muted }),
  );
}
