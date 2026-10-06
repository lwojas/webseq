// Drives playback: a classic lookahead scheduler (same pattern as webdsp's own
// LookaheadPlayer example — see that package's ARCHITECTURE.md, "How scheduling works"),
// generalized from a single looping pattern to a *chain* of patterns of independent lengths.
// A JS timer only ever decides *when to top up* the schedule; the actual playback timing
// comes entirely from the absolute engine times handed to AudioRuntime.schedule(), which the
// engine (not this timer) executes sample-accurately.
//
// Pattern-chain continuity: the chain is walked by an ever-increasing step counter
// (`nextStepIndex`), resolved against the *current* project.patternChain each time a new step
// is about to be scheduled (see model/types.ts's resolveChainStep) — never precomputed in
// full. This is what makes editing the chain during playback behave the way section 6 of the
// brief asks: every event already handed to webdsp keeps playing exactly as scheduled
// (nothing here ever calls cancelScheduled() except on an explicit pause/stop), and only the
// *next* not-yet-scheduled step picks up a chain edit — so the currently-sounding pattern is
// never abruptly cut off or restarted merely because the chain changed underneath it. The
// same reasoning covers editing a pattern's notes while it's playing: getProject() is read
// fresh every tick, so an edit changes what the *next* playthrough of that pattern compiles
// to, never what's already been scheduled.
import type { AudioRuntime, BusId, SampleMetadata, VoiceHandle } from "webdsp";
import type { AutomationLane, FxInstance, FxTarget, PatternId, Project } from "../model/types";
import { effectiveVoiceMode, patternById, resolveChainStep, totalBeats, trackById } from "../model/types";
import { compilePatternIterationTracked, secondsPerBeat } from "./compile";
import { valueAtBeat } from "../model/automation";
import { applyAutomatedParam } from "./applyFx";
import type { Playback } from "./playback";

const LOOKAHEAD_SECONDS = 0.15;
const TICK_INTERVAL_MS = 25;
const LEAD_IN_SECONDS = 0.05;
// Bounds how many dangling chain entries (referencing a deleted pattern) tick() will skip
// past in one call before giving up for that tick — cheap insurance against an all-dangling
// chain spinning forever without ever advancing real time.
const MAX_STEP_SKIPS_PER_TICK = 256;

export type PlaybackStatus = "stopped" | "playing" | "paused";

/** A step of the chain that has been (or is being) scheduled, used purely to answer "what's
 * playing right now" for the UI (see currentPosition()) — never consulted by the scheduling
 * loop itself, which only ever looks forward from nextStepStartTime/nextStepIndex. */
interface StepWindow {
  stepIndex: number;
  patternId: PatternId;
  startTime: number;
  endTime: number;
}

interface Position {
  stepIndex: number;
  patternId: PatternId | null;
  beat: number;
}

export type ResampleStatus = "idle" | "armed" | "capturing";

export interface ResampleCaptureResult {
  metadata: SampleMetadata;
  channelData: ArrayBuffer[];
}

/** Tracks a resample request from armResample() through to the engine actually capturing it —
 * see armResample()'s doc comment for the full flow. `resolve`/`reject` settle the promise
 * armResample() handed back to its caller. */
interface ResampleState {
  status: "armed" | "capturing";
  targetPatternId: PatternId;
  resolve: (result: ResampleCaptureResult) => void;
  reject: (err: Error) => void;
}

export class Transport {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private status: PlaybackStatus = "stopped";

  private anchorTempo = 120;
  private nextStepIndex = 0;
  private nextStepStartTime = 0;
  private audibleFrom = 0;
  private startPosition: Position = { stepIndex: 0, patternId: null, beat: 0 };
  private pausedPosition: Position = { stepIndex: 0, patternId: null, beat: 0 };
  private stepWindows: StepWindow[] = [];

  private activeVoices = new Set<VoiceHandle>();
  // Mono choke (ECS-82/ECS-87) lives in playback.ts, shared with manual triggers (ECS-83):
  // every mono voice scheduled here is registered there, so a mono track's last note bleeding
  // into the next iteration is released by the same table a manual trigger uses. Known,
  // accepted imprecision: because tick() schedules up to LOOKAHEAD_SECONDS ahead, that release
  // can land up to that long before the new voice's actual start — webdsp's release() has no
  // scheduled-time parameter, so there's no way to make this sample-accurate from here. Not
  // worth a JS-timer workaround: that would undermine the lookahead scheduler's
  // sample-accuracy guarantee for a rare edge case.
  // Last automated value actually pushed per (bus, fx, parameter), so polling only calls
  // into webdsp when a value has actually changed rather than every tick.
  private lastAutomationValues = new Map<string, number>();
  // Non-null from armResample() until the target pattern's next iteration has been captured
  // (or the resample is abandoned by pause()/stop()) — see armResample()'s doc comment.
  private resampleState: ResampleState | null = null;

  constructor(
    private readonly runtime: AudioRuntime,
    private readonly getProject: () => Project,
    private readonly getBusId: (target: FxTarget) => BusId | undefined,
    private readonly playback: Playback,
  ) {}

  getStatus(): PlaybackStatus {
    return this.status;
  }

  /** Starts (or resumes) playback. Resumes from the paused position if paused, otherwise
   * starts from the beginning of the pattern chain. */
  play(): void {
    if (this.status === "playing") return;
    const project = this.getProject();
    const resume = this.status === "paused" ? this.pausedPosition : this.chainStart(project);

    const now = this.runtime.getCurrentTime();
    const spb = secondsPerBeat(project.bpm);
    this.anchorTempo = project.bpm;
    this.nextStepIndex = resume.stepIndex;
    this.nextStepStartTime = now + LEAD_IN_SECONDS - resume.beat * spb;
    this.startPosition = resume;
    this.audibleFrom = now + LEAD_IN_SECONDS;
    this.stepWindows = [];
    this.lastAutomationValues.clear();
    this.playback.dropSequencerVoices();
    this.status = "playing";

    this.timerId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.tick();
  }

  /** Stops the schedule-ahead timer and cancels not-yet-fired events, remembering the
   * current musical position so a later play() resumes from here. */
  pause(): void {
    if (this.status !== "playing") return;
    this.pausedPosition = this.currentPosition();
    this.haltAudio();
    this.status = "paused";
  }

  /** Stops playback and resets position to the start of the pattern chain. Also silences
   * manual voices (auditions, track loops), and does so even when already stopped, so Stop is
   * always the universal silence control (ECS-83). */
  stop(): void {
    this.playback.stopAll();
    if (this.status === "stopped") return;
    this.haltAudio();
    this.pausedPosition = this.chainStart(this.getProject());
    this.status = "stopped";
  }

  /** Re-anchors playback to the current tempo/project without an audible jump, preserving
   * musical position. Call after a live BPM (or structural pattern/chain) change while
   * playing. Already-triggered notes finish under their original timing; only not-yet-
   * scheduled notes pick up the new tempo. */
  retime(): void {
    if (this.status !== "playing") return;
    // BPM/tempo changes are frozen while a resample is armed/capturing (project brief section
    // 9) — an armed capture's [startTime, stopTime) is already fixed against the *current*
    // schedule, and re-anchoring here would desync the sequencer's own timeline from it. The
    // UI is expected to disable the BPM control for the same reason; this is the enforcement
    // of that policy, not just a UI nicety.
    if (this.resampleState) return;
    const position = this.currentPosition();
    this.haltAudio();
    this.pausedPosition = position;
    this.status = "paused";
    this.play();
  }

  private haltAudio(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.runtime.cancelScheduled();
    for (const voice of this.activeVoices) this.runtime.release(voice);
    this.activeVoices.clear();
    this.playback.dropSequencerVoices();
    this.stepWindows = [];
    this.cancelResample(new Error("Resample cancelled: transport stopped or paused."));
  }

  private chainStart(project: Project): Position {
    const step = resolveChainStep(project, 0);
    return { stepIndex: 0, patternId: step?.pattern.id ?? null, beat: 0 };
  }

  /** Current playhead position — which chain step/pattern is audibly playing and how far
   * into it, purely derived from the engine's own clock. Checks already-scheduled windows
   * first (the normal case: tick()'s 150ms lookahead always keeps these well ahead of `now`),
   * and falls back to a pure, throwaway forward walk over the chain (same step-by-step logic
   * as tick(), just without scheduling anything) for the rare case this is queried before
   * tick() has next run — e.g. right at start-up, or a throttled background tab. That walk is
   * never cached: caching it here could race a chain edit against tick()'s own scheduling of
   * the same step and disagree with what was actually sent to webdsp. Holds `startPosition`
   * during the lead-in pre-roll, same rationale as the original single-pattern Transport. */
  private currentPosition(): Position {
    if (this.status !== "playing") return this.pausedPosition;
    const now = this.runtime.getCurrentTime();
    if (now < this.audibleFrom) return this.startPosition;
    const spb = secondsPerBeat(this.anchorTempo);
    for (const w of this.stepWindows) {
      if (now >= w.startTime && now < w.endTime) {
        return { stepIndex: w.stepIndex, patternId: w.patternId, beat: (now - w.startTime) / spb };
      }
    }

    const project = this.getProject();
    const last = this.stepWindows[this.stepWindows.length - 1];
    let stepIndex = last ? last.stepIndex + 1 : this.startPosition.stepIndex;
    let stepStartTime = last ? last.endTime : this.audibleFrom - this.startPosition.beat * spb;

    let guard = 0;
    while (guard < MAX_STEP_SKIPS_PER_TICK) {
      guard++;
      const step = resolveChainStep(project, stepIndex);
      if (!step) {
        if (project.patternChain.length === 0) return this.startPosition;
        stepIndex++;
        continue;
      }
      const beats = totalBeats(step.pattern, project.beatsPerBar);
      if (beats <= 0) {
        stepIndex++;
        continue;
      }
      const stepEndTime = stepStartTime + beats * spb;
      if (now < stepEndTime) {
        return { stepIndex, patternId: step.pattern.id, beat: Math.max(0, (now - stepStartTime) / spb) };
      }
      stepStartTime = stepEndTime;
      stepIndex++;
    }
    return this.startPosition;
  }

  /** `{ patternId, beat }` for the UI: which pattern is currently sounding (null if the
   * chain is empty or every entry is dangling) and how far into it, in beats. A pattern
   * editor should only draw a playhead when its own pattern id matches this one. */
  getPlayheadInfo(): { patternId: PatternId | null; beat: number } {
    const { patternId, beat } = this.currentPosition();
    return { patternId, beat };
  }

  getPlayheadBeat(): number {
    return this.currentPosition().beat;
  }

  /** `"idle"` | `"armed"` (waiting for the target pattern's next boundary) | `"capturing"`
   * (the engine has been told to record and is waiting for it to finish) — a plain getter,
   * meant to be polled from the UI the same way getPlayheadInfo()/getPlayheadBeat() already
   * are (e.g. via useRafText), not a subscription. */
  getResampleStatus(): ResampleStatus {
    return this.resampleState?.status ?? "idle";
  }

  /** Arms a resample of exactly one iteration of whichever pattern is currently sounding —
   * see ARCHITECTURE-level brief section 6/7: "capture exactly one iteration of the currently
   * active pattern", starting and stopping on that pattern's exact boundaries, no wall-clock
   * timing anywhere. Refuses synchronously (no engine call at all) if there's nothing to
   * resample, a resample is already in flight, or the pattern's duration exceeds the engine's
   * capture capacity — the brief's "before starting a capture... do not start capture, show a
   * deterministic error" requirement.
   *
   * Otherwise returns the id of the pattern being captured and a promise that resolves once
   * it actually has been: tick() (below) already walks the chain forward in order to schedule
   * playback, so it also recognizes the first future step whose pattern matches — by
   * construction the *next real occurrence* of that pattern in the chain, however far away
   * (e.g. on A -> A -> B -> C -> B with B currently active, that's the later B, not the
   * intervening C) — and arms the engine capture for exactly that step's [start, end). */
  armResample(): { ok: true; patternId: PatternId; result: Promise<ResampleCaptureResult> } | { ok: false; reason: string } {
    if (this.status !== "playing") return { ok: false, reason: "Nothing is playing." };
    if (this.resampleState) return { ok: false, reason: "A resample is already in progress." };
    const project = this.getProject();
    const { patternId } = this.currentPosition();
    const pattern = patternId ? patternById(project, patternId) : undefined;
    if (!patternId || !pattern) return { ok: false, reason: "No pattern is currently active." };

    const durationSeconds = totalBeats(pattern, project.beatsPerBar) * secondsPerBeat(project.bpm);
    const capacitySeconds = this.runtime.getCapabilities().maxCaptureSeconds;
    if (durationSeconds > capacitySeconds) {
      return {
        ok: false,
        reason: `"${pattern.name}" is ${durationSeconds.toFixed(1)}s, which exceeds the ${capacitySeconds}s capture capacity.`,
      };
    }

    const result = new Promise<ResampleCaptureResult>((resolve, reject) => {
      this.resampleState = { status: "armed", targetPatternId: patternId, resolve, reject };
    });
    // Manual voices already sounding would be captured too, since the capture records master
    // output. Silence them now; new manual starts are refused until the capture completes.
    this.playback.stopAll();
    return { ok: true, patternId, result };
  }

  /** Abandons an in-flight resample (armed or already capturing), rejecting its promise.
   * There is no wire command to abort an already-armed engine-side capture (see
   * webdsp's Capture — it has no cancel, only run-to-completion), so if the engine had
   * already been told to arm one, it still runs to completion and its result is simply
   * discarded here rather than reaching any Asset. */
  private cancelResample(err: Error): void {
    if (!this.resampleState) return;
    this.resampleState.reject(err);
    this.resampleState = null;
  }

  /** Called from tick() as each future step is scheduled: if a resample is armed for this
   * step's pattern, this *is* that "next boundary" (see armResample()'s doc comment for why
   * the first future step tick() ever offers is, by construction, the right one) — arm the
   * actual engine capture for this step's exact [start, end) and let its result settle
   * armResample()'s promise. No timer anywhere in this path: the capture's start/stop times
   * are the same absolute engine times already being handed to runtime.schedule() for this
   * step's notes. */
  private armResampleIfTargetStep(patternId: PatternId, startTime: number, endTime: number): void {
    const state = this.resampleState;
    if (!state || state.status !== "armed" || state.targetPatternId !== patternId) return;
    state.status = "capturing";
    try {
      const { result } = this.runtime.armCapture({ startTime, stopTime: endTime });
      result.then(
        (r) => {
          if (this.resampleState === state) this.resampleState = null;
          state.resolve(r);
        },
        (err: unknown) => {
          if (this.resampleState === state) this.resampleState = null;
          state.reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    } catch (err) {
      this.resampleState = null;
      state.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private tick(): void {
    const project = this.getProject();
    const now = this.runtime.getCurrentTime();
    const horizon = now + LOOKAHEAD_SECONDS;
    const spb = secondsPerBeat(this.anchorTempo);

    let guard = 0;
    while (this.nextStepStartTime < horizon && guard < MAX_STEP_SKIPS_PER_TICK) {
      guard++;
      const step = resolveChainStep(project, this.nextStepIndex);
      if (!step) {
        if (project.patternChain.length === 0) break; // nothing will ever resolve
        this.nextStepIndex++; // dangling entry (deleted pattern) — skip it, try the next
        continue;
      }
      const { pattern } = step;
      const beats = totalBeats(pattern, project.beatsPerBar);
      if (beats <= 0) {
        this.nextStepIndex++;
        continue;
      }
      const stepStartTime = this.nextStepStartTime;
      const compiled = compilePatternIterationTracked(
        pattern,
        project.tracks,
        this.anchorTempo,
        stepStartTime,
        (trackId) => this.getBusId(trackId),
        project.swing,
      );
      if (compiled.length > 0) {
        const handles = this.runtime.schedule(compiled.map((c) => c.event));
        handles.forEach((handle, i) => {
          this.activeVoices.add(handle);
          const { trackId } = compiled[i];
          const track = trackById(project, trackId);
          if (track && effectiveVoiceMode(track) === "mono") this.playback.registerMonoVoice(trackId, handle, "sequencer");
        });
      }
      const stepEndTime = stepStartTime + beats * spb;
      this.stepWindows.push({
        stepIndex: this.nextStepIndex,
        patternId: pattern.id,
        startTime: stepStartTime,
        endTime: stepEndTime,
      });
      this.armResampleIfTargetStep(pattern.id, stepStartTime, stepEndTime);
      this.nextStepStartTime += beats * spb;
      this.nextStepIndex++;
    }

    this.stepWindows = this.stepWindows.filter((w) => w.endTime > now - 1.0);
    this.pollAutomation(project);
  }

  /** Applies each active FX automation lane's current value (track and master) as ordinary
   * bus-parameter changes — see model/types.ts's AutomationLane doc comment for the
   * position/interpolation contract this evaluates. Polled at the same ~25ms tick rate as
   * note scheduling rather than sample-accurately ramped (webdsp has no automation-ramp
   * primitive); this is an intentional, documented simplification appropriate for this
   * project's "no automation curves/envelopes yet" scope (see project brief section 16).
   * Automation is track/master-level (not per-pattern) and is evaluated against the beat
   * offset within whichever chain step is currently sounding — i.e. it restarts every time a
   * new pattern instance begins playing on that track, which is what lets one lane apply
   * consistently across patterns of different lengths without per-pattern duplication. */
  private pollAutomation(project: Project): void {
    if (this.status !== "playing") return;
    const { beat } = this.currentPosition();
    this.applyAutomationFor(project.master, this.getBusId("master"), beat);
    for (const track of project.tracks) {
      this.applyAutomationFor(track, this.getBusId(track.id), beat);
    }
  }

  private applyAutomationFor(owner: { fx: FxInstance[]; automation: AutomationLane[] }, busId: BusId | undefined, beat: number): void {
    if (busId === undefined) return;
    for (const lane of owner.automation) {
      const instance = owner.fx.find((f) => f.id === lane.fxId);
      if (!instance || !instance.enabled) continue;
      const value = valueAtBeat(lane, beat);
      if (value === null) continue;
      const key = `${busId}:${lane.fxId}:${lane.parameter}`;
      if (this.lastAutomationValues.get(key) === value) continue;
      this.lastAutomationValues.set(key, value);
      applyAutomatedParam(this.runtime, busId, instance.type, lane.parameter, value);
    }
  }
}
