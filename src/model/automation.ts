// Automation lane CRUD + playback evaluation. See types.ts's AutomationLane doc comment for
// the model (sparse points, linear interpolation, hold-last-value past the final point) —
// this file is the pure implementation of that contract, shared by the reducer (editing) and
// src/audio/transport.ts (playback polling).
//
// A lane is addressed by (owner, fxId | null, parameter): `fxId` names an FX instance, null the
// track's own source (synth control / sample parameter). Automation is one modulation source of a
// parameter (the other being its LFO stack, model/modulation.ts); it supplies the parameter's
// base value and the engine's LFOs ride on top.

import type { AutomationEvent, AutomationLane, FxId, FxTarget, Project } from "./types";
import { fxOwner } from "./types";

function updateAutomation(project: Project, target: FxTarget, update: (lanes: AutomationLane[]) => AutomationLane[]): Project {
  const owner = fxOwner(project, target);
  if (!owner) return project;
  const automation = update(owner.automation);
  if (target === "master") return { ...project, master: { ...owner, automation } };
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === target ? { ...t, automation } : t)),
  };
}

function laneKey(fxId: FxId | null | undefined, parameter: string) {
  return `${fxId ?? ""}::${parameter}`;
}

/** Sets (adding or replacing) the automation point at `position` for one FX parameter,
 * creating the lane if this is its first point. Positions are rounded to keep the lane's
 * points addressable from a beat-quantized UI. */
export function setAutomationPoint(
  project: Project,
  target: FxTarget,
  fxId: FxId | null,
  parameter: string,
  position: number,
  value: number,
): Project {
  const roundedPosition = Math.max(0, Math.round(position * 4) / 4); // quarter-beat resolution
  return updateAutomation(project, target, (lanes) => {
    const existing = lanes.find((l) => laneKey(l.fxId, l.parameter) === laneKey(fxId, parameter));
    const nextEvent: AutomationEvent = { position: roundedPosition, value };
    if (!existing) {
      return [...lanes, fxId != null ? { fxId, parameter, events: [nextEvent] } : { parameter, events: [nextEvent] }];
    }
    const withoutSamePosition = existing.events.filter((e) => e.position !== roundedPosition);
    const events = [...withoutSamePosition, nextEvent].sort((a, b) => a.position - b.position);
    return lanes.map((l) => (l === existing ? { ...l, events } : l));
  });
}

export function removeAutomationPoint(
  project: Project,
  target: FxTarget,
  fxId: FxId | null,
  parameter: string,
  position: number,
): Project {
  return updateAutomation(project, target, (lanes) =>
    lanes
      .map((l) =>
        laneKey(l.fxId, l.parameter) === laneKey(fxId, parameter)
          ? { ...l, events: l.events.filter((e) => e.position !== position) }
          : l,
      )
      .filter((l) => l.events.length > 0),
  );
}

export function clearAutomationLane(project: Project, target: FxTarget, fxId: FxId | null, parameter: string): Project {
  return updateAutomation(project, target, (lanes) => lanes.filter((l) => laneKey(l.fxId, l.parameter) !== laneKey(fxId, parameter)));
}

/** Replaces every point in [from, to] (beats, inclusive) of one lane with `events`, leaving the
 * rest of the lane as it was — how a template is applied to part of a sequence. An empty result
 * drops the lane. */
export function replaceAutomationRange(
  project: Project,
  target: FxTarget,
  fxId: FxId | null,
  parameter: string,
  from: number,
  to: number,
  events: AutomationEvent[],
): Project {
  return updateAutomation(project, target, (lanes) => {
    const key = laneKey(fxId, parameter);
    const existing = lanes.find((l) => laneKey(l.fxId, l.parameter) === key);
    const kept = (existing?.events ?? []).filter((e) => e.position < from || e.position > to);
    const merged = [...kept, ...events].sort((a, b) => a.position - b.position);
    if (merged.length === 0) return lanes.filter((l) => laneKey(l.fxId, l.parameter) !== key);
    if (!existing) return [...lanes, fxId != null ? { fxId, parameter, events: merged } : { parameter, events: merged }];
    return lanes.map((l) => (l === existing ? { ...l, events: merged } : l));
  });
}

/** Drops source lanes (no fxId) whose parameter the track's current source doesn't have — after
 * a synth kind change or a swap between synth and sample. FX lanes are untouched. */
export function pruneSourceLanes(project: Project, trackId: string, valid: (parameter: string) => boolean): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || !track.automation.some((l) => l.fxId == null && !valid(l.parameter))) return project;
  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === trackId ? { ...t, automation: t.automation.filter((l) => l.fxId != null || valid(l.parameter)) } : t)),
  };
}

export function findLane(lanes: AutomationLane[], fxId: FxId | null | undefined, parameter: string): AutomationLane | undefined {
  return lanes.find((l) => laneKey(l.fxId, l.parameter) === laneKey(fxId, parameter));
}

/** The automated value at a given beat position, or null if this parameter has no automation
 * (callers should fall back to the FX's own base `params` value in that case). Holds the
 * first point's value before it, linearly interpolates between points, and holds the last
 * point's value after it — see types.ts's AutomationLane doc comment. */
export function valueAtBeat(lane: AutomationLane | undefined, beat: number): number | null {
  if (!lane || lane.events.length === 0) return null;
  const events = lane.events; // already kept sorted by position on write
  if (beat <= events[0].position) return events[0].value;
  const last = events[events.length - 1];
  if (beat >= last.position) return last.value;
  for (let i = 0; i < events.length - 1; i++) {
    const a = events[i];
    const b = events[i + 1];
    if (beat >= a.position && beat <= b.position) {
      const span = b.position - a.position;
      const t = span === 0 ? 0 : (beat - a.position) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}
