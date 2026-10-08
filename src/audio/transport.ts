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
//
// --- Manual pattern launch contract (ECS-117) ---------------------------------------------
// `queuedPatternId` is the one piece of shared state a manual "launch this pattern" request
// adds: a single nullable slot, owned here (not Project — it's transient playback state, not
// something a saved project should remember). It extends the existing chain-walk mechanism
// rather than building a second state machine next to it, which is why the chain-position
// counter had to be split in two:
//   * `nextStepIndex` — still just "how many steps have been scheduled so far", used only for
//     stepWindows bookkeeping (see currentPosition()). Advances on every scheduled step.
//   * `chainPosition` — which `project.patternChain` entry resolveChainStep() will consult
//     next. Advances only when a step was actually *resolved from the chain* — a manually
//     substituted step leaves it untouched, so the chain doesn't lose the entry it would have
//     played. Without this split, a one-step manual substitution would permanently skip
//     whatever chain entry it stood in for (verified by the "chain resumes" test below).
//
//   State                 | Meaning
//   ---------------------- | ------------------------------------------------------------
//   playing pattern        | currentPosition().patternId — unchanged, still just "whichever
//                           | step's [startTime,endTime) contains now" (or pausedPosition
//                           | while not playing). Never written directly by a launch request.
//   queued pattern          | `queuedPatternId` — the pattern a manual request wants to play
//                           | next; null means no request pending. Independent of
//                           | project.patternChain and of whether playback is currently a
//                           | chain at all (a launch works with an empty chain, per ECS-115).
//
//   Transition table (tick(), one entry per not-yet-scheduled step boundary):
//   Chain state            | queuedPatternId | Pattern scheduled for this step | queuedPatternId after | chainPosition after
//   ----------------------- | --------------- | -------------------------------- | ---------------------- | --------------------
//   any (incl. empty)       | set, valid       | the queued pattern (wins)        | cleared (consumed once) | unchanged (chain "paused" for this step)
//   any (incl. empty)       | set, deleted     | falls through to the chain step  | cleared (consumed once) | advances (that chain step did play)
//   any                     | null             | resolveChainStep(chainPosition)  | null                    | advances
//   empty, queued null      | null             | nothing (silence, as today)      | null                    | unchanged
//
//   requestPatternLaunch(id) / cancelQueuedLaunch() / getQueuedPatternId() (decisions):
//   * Replacement: calling requestPatternLaunch() again overwrites any still-pending request
//     — last request wins, there is only ever at most one queued pattern.
//   * Returning to the playing pattern: requesting the pattern that's already playing
//     (currentPosition().patternId) is treated as a cancellation, not a same-pattern relaunch
//     — nothing here ever interrupts already-scheduled audio, so there's no way to "restart"
//     the current pattern anyway; the sensible reading of that request is "never mind".
//   * Precedence vs. the chain: a pending request always wins over whatever
//     resolveChainStep() would have produced for that one step — manual intent over the
//     ambient chain. This holds even when the chain is empty.
//   * Chain continuation after a manual transition: the chain is effectively paused, not
//     advanced, for the one step a manual launch takes over — `chainPosition` only moves when
//     a step actually came from resolveChainStep(). So on a chain [A, C] playing A with B
//     manually launched at the boundary: B plays once, and C — not A again — plays next,
//     exactly the entry the chain would have reached had the manual launch never happened.
//     (Whether a future device should instead realign the chain to the launched pattern's own
//     slot, if it has one, is explicitly deferred to ECS-121 — "integrate... using the agreed
//     contract" — not decided here.)
//   * Completion with no request pending: unchanged — normal chain behavior, including
//     staying silent on an empty chain.
//   * Stop/restart: stop() always clears queuedPatternId, consistent with stop() already being
//     documented as "the universal silence control" — a stopped transport has no pending
//     launch, and play() after a stop begins at chain start (chainPosition reset to 0 along
//     with nextStepIndex) with nothing queued. pause() does NOT clear it, nor does it touch
//     chainPosition: no boundary has been crossed, so resuming with play() continues exactly
//     as if pause() had never happened.
//   * Duplication / editing vs. playback: duplicating a pattern (PatternBar's "Duplicate") only
//     ever changes `selectedPatternId` (the editing selection) — it never reads or writes
//     queuedPatternId/playing state, same as the pre-existing selection/playback separation
//     this file's module comment above already describes for chain edits and note edits.
//
//   Test cases (see "Transport manual pattern launch" in test/transport.test.ts):
//   1. requestPatternLaunch(B) while A plays and the chain is empty → B becomes active at A's
//      boundary, chain stays empty afterwards.
//   2. requestPatternLaunch(B) while a chain [A, C] plays A → B plays once at the boundary,
//      then C plays next (chainPosition untouched by the substitution, so C's slot survives).
//   3. requestPatternLaunch(B) twice in a row (before any boundary) → only the second request
//      is honored (replacement).
//   4. requestPatternLaunch(current playing pattern) → queuedPatternId becomes null, playback
//      continues uninterrupted (cancellation, not relaunch).
//   5. requestPatternLaunch(B) then cancelQueuedLaunch() before the boundary → the chain's own
//      next step plays, unchanged.
//   6. requestPatternLaunch(B) then the project deletes pattern B before the boundary → falls
//      through to the chain's own next step (dangling request, same "skip it" policy as a
//      dangling chain entry) — and that chain step's own completion still advances chainPosition.
//   7. requestPatternLaunch(B) then stop() before the boundary → queuedPatternId is null; the
//      next play() starts at chain start with nothing queued.
//   8. requestPatternLaunch(B) then pause() before the boundary, then play() → B still becomes
//      active at the (now-resumed) boundary; pausing never consumed the request.
//   9. Duplicating the playing pattern mid-playback changes only selectedPatternId; playing and
//      queued state are untouched.
// --------------------------------------------------------------------------------------------
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
  /** `chainPosition`'s value just before this step was resolved (ECS-117) — carried into
   * Position so a pause() mid-step can hand it back to play() on resume; see tick()'s
   * chainPosition/nextStepIndex split in the module comment above. For a step that came from
   * a manual launch, this is simply wherever the chain was left sitting, unconsumed. */
  chainPositionBefore: number;
}

interface Position {
  stepIndex: number;
  patternId: PatternId | null;
  beat: number;
  /** The `chainPosition` to resume into if this position is paused on mid-step (ECS-117). */
  chainPosition: number;
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
  // Which project.patternChain entry resolveChainStep() will consult next — separate from
  // nextStepIndex (ECS-117) so a manually-substituted step leaves the chain's own position
  // untouched; see the "Manual pattern launch contract" module comment above.
  private chainPosition = 0;
  private nextStepStartTime = 0;
  private audibleFrom = 0;
  private startPosition: Position = { stepIndex: 0, patternId: null, beat: 0, chainPosition: 0 };
  private pausedPosition: Position = { stepIndex: 0, patternId: null, beat: 0, chainPosition: 0 };
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
  // The one pending manual-launch request, or null — see the "Manual pattern launch contract"
  // module comment above for the full transition table this participates in.
  private queuedPatternId: PatternId | null = null;
  // One-shot guard: true for exactly the first step tick() resolves after a play() that
  // resumed mid-step (ECS-117) — a pending launch must not hijack that step, since it's really
  // just finishing the pattern the transport was paused on, not a fresh boundary. Cleared by
  // tick() itself on its first loop iteration; see play()'s doc comment.
  private suppressLaunchForResume = false;

  constructor(
    private readonly runtime: AudioRuntime,
    private readonly getProject: () => Project,
    private readonly getBusId: (target: FxTarget) => BusId | undefined,
    private readonly playback: Playback,
  ) {
    // Forget each sequenced voice once the engine reports it ended. activeVoices then holds only
    // voices that may still sound, which is all haltAudio needs to release. Without this the set
    // grew by one entry per note for the whole playback session (ECS-84).
    runtime.onVoiceEnded((voice) => this.activeVoices.delete(voice));
  }

  getStatus(): PlaybackStatus {
    return this.status;
  }

  /** Starts (or resumes) playback. Resumes from the paused position if paused, otherwise
   * starts from the beginning of the pattern chain. */
  play(): void {
    if (this.status === "playing") return;
    const wasPaused = this.status === "paused";
    const project = this.getProject();
    const resume = wasPaused ? this.pausedPosition : this.chainStart(project);

    const now = this.runtime.getCurrentTime();
    const spb = secondsPerBeat(project.bpm);
    this.anchorTempo = project.bpm;
    this.nextStepIndex = resume.stepIndex;
    // `resume.chainPosition` is 0 for a fresh start (chainStart() below) or, when resuming
    // from a pause, exactly the chain position that was in effect when the paused step was
    // resolved — restoring it here (rather than wherever chainPosition drifted to after that
    // step's own increment) is what keeps a pause/resume round trip from corrupting the
    // chain's walk after a manual launch has diverged it from nextStepIndex (ECS-117).
    this.chainPosition = resume.chainPosition;
    // A still-pending manual launch must not hijack a step that's only being *resumed*
    // mid-flight — that would swap out the very pattern the user paused on, not just take over
    // at a future boundary (ECS-117). Only guards tick()'s first loop iteration below; a
    // resume exactly on a step's own boundary (beat 0) has nothing to protect.
    this.suppressLaunchForResume = wasPaused && resume.beat > 0;
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
    this.queuedPatternId = null;
    if (this.status === "stopped") return;
    this.haltAudio();
    this.pausedPosition = this.chainStart(this.getProject());
    this.status = "stopped";
  }

  /** The pending manual-launch request, or null if none — see the module-level "Manual
   * pattern launch contract" comment. */
  getQueuedPatternId(): PatternId | null {
    return this.queuedPatternId;
  }

  /** Requests that `patternId` take over at the next chain-step completion boundary (ECS-117),
   * replacing any previously queued request — last request wins. Requesting the pattern that
   * is already playing is treated as a cancellation rather than a same-pattern relaunch: see
   * the module comment's "returning to the playing pattern" decision. Never interrupts
   * already-scheduled audio — it only changes what the next not-yet-scheduled step resolves
   * to, the same guarantee chain edits already get. */
  requestPatternLaunch(patternId: PatternId): void {
    if (patternId === this.currentPosition().patternId) {
      this.queuedPatternId = null;
      return;
    }
    this.queuedPatternId = patternId;
  }

  /** Cancels a pending manual-launch request, if any. Playback continues exactly as if no
   * request had been made (ECS-117). */
  cancelQueuedLaunch(): void {
    this.queuedPatternId = null;
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
    return { stepIndex: 0, patternId: step?.pattern.id ?? null, beat: 0, chainPosition: 0 };
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
        return { stepIndex: w.stepIndex, patternId: w.patternId, beat: (now - w.startTime) / spb, chainPosition: w.chainPositionBefore };
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
        // This throwaway walk has no notion of a manual launch (see its doc comment above),
        // so it always treats stepIndex itself as the chain position (ECS-117) — correct as
        // long as no manual substitution has happened since the last real stepWindow, which
        // is the same "rare path" assumption the rest of this walk already rests on.
        return { stepIndex, patternId: step.pattern.id, beat: Math.max(0, (now - stepStartTime) / spb), chainPosition: stepIndex };
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
      // Cleared immediately -- only ever guards this one (necessarily first) loop iteration;
      // see play()'s doc comment for why a resumed-mid-step tick needs this.
      const suppressLaunch = this.suppressLaunchForResume;
      this.suppressLaunchForResume = false;
      const chainPositionBefore = this.chainPosition;
      // A pending manual launch wins over the chain for exactly this one step (ECS-117's
      // launch contract, see this file's module comment) — consumed here so it only ever
      // substitutes the single next not-yet-scheduled step, never a later one. `chainPosition`
      // is deliberately not touched in this branch: a substituted step doesn't consume the
      // chain's own entry, so the chain resumes from exactly where it left off afterwards.
      let pattern = !suppressLaunch && this.queuedPatternId ? patternById(project, this.queuedPatternId) : undefined;
      if (!suppressLaunch) this.queuedPatternId = null;
      let fromChain = false;
      if (!pattern) {
        const step = resolveChainStep(project, this.chainPosition);
        if (!step) {
          if (project.patternChain.length === 0) break; // nothing will ever resolve
          this.chainPosition++; // dangling entry (deleted pattern) — skip it, try the next
          continue;
        }
        pattern = step.pattern;
        fromChain = true;
      }
      const beats = totalBeats(pattern, project.beatsPerBar);
      if (beats <= 0) {
        if (fromChain) this.chainPosition++;
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
        // Sort by time before handing events to the engine. Compiling per track leaves them out
        // of time order, and the engine's queue insertion is linear for each out-of-order event
        // (webdsp scheduler.h). Sorted input appends. The handles stay aligned with `compiled`
        // because both are sorted together (ECS-84).
        compiled.sort((a, b) => a.event.time - b.event.time);
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
        chainPositionBefore,
      });
      this.armResampleIfTargetStep(pattern.id, stepStartTime, stepEndTime);
      this.nextStepStartTime += beats * spb;
      this.nextStepIndex++;
      if (fromChain) this.chainPosition++;
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
