// Drives playback: a classic lookahead scheduler (same pattern as webdsp's own
// LookaheadPlayer example — see that package's ARCHITECTURE.md, "How scheduling works")
// generalized from a fixed step grid to notes with arbitrary start/duration. A JS timer
// only ever decides *when to top up* the schedule; the actual playback timing comes
// entirely from the absolute engine times handed to AudioRuntime.schedule(), which the
// engine (not this timer) executes sample-accurately. This is why using setInterval here
// does not violate "don't use a JS timer as the audio clock" — the timer schedules into a
// clock it does not own, and getPlayheadBeat() below is derived purely from the engine's
// own clock (getCurrentTime()), never from the timer or from React state.
import type { AudioRuntime, VoiceHandle } from "webdsp";
import type { SequencerState } from "../model/types";
import { totalBeats } from "../model/types";
import { compileLoopIteration, secondsPerBeat } from "./compile";

const LOOKAHEAD_SECONDS = 0.15;
const TICK_INTERVAL_MS = 25;
const LEAD_IN_SECONDS = 0.05;

export type PlaybackStatus = "stopped" | "playing" | "paused";

export class Transport {
  private timerId: ReturnType<typeof setInterval> | null = null;
  private status: PlaybackStatus = "stopped";

  // Anchor for the loop iteration currently being scheduled/played, plus the tempo that
  // was in effect when that anchor was set — together these let getPlayheadBeat() convert
  // engine time back into a beat position without needing a second, independently-drifting
  // clock.
  private loopStartTime = 0;
  private anchorTempo = 120;
  private nextLoopIndex = 0;
  private pausedAtBeat = 0;
  // The beat position play() was (re)started from, plus the engine time before which
  // playback is still in its lead-in pre-roll — see getPlayheadBeat()'s doc comment for
  // why the readout needs both, not just `elapsed < 0` against loopStartTime.
  private startBeat = 0;
  private audibleFrom = 0;

  private activeVoices = new Set<VoiceHandle>();

  constructor(
    private readonly runtime: AudioRuntime,
    private readonly getState: () => SequencerState,
  ) {}

  getStatus(): PlaybackStatus {
    return this.status;
  }

  /** Starts (or resumes) playback. With no argument: resumes from the paused position if
   * paused, otherwise starts from the pattern's beginning. Pass an explicit beat to start
   * from elsewhere (used by retime()). */
  play(fromBeat?: number): void {
    if (this.status === "playing") return;
    const resolvedFromBeat = fromBeat ?? (this.status === "paused" ? this.pausedAtBeat : 0);
    const state = this.getState();
    const spb = secondsPerBeat(state.tempo);
    const beatsPerLoop = totalBeats(state);

    const now = this.runtime.getCurrentTime();
    this.anchorTempo = state.tempo;
    this.loopStartTime = now + LEAD_IN_SECONDS - resolvedFromBeat * spb;
    this.nextLoopIndex = beatsPerLoop > 0 ? Math.floor(resolvedFromBeat / beatsPerLoop) : 0;
    this.startBeat = resolvedFromBeat;
    this.audibleFrom = now + LEAD_IN_SECONDS;
    this.status = "playing";

    this.timerId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
    this.tick();
  }

  /** Stops the schedule-ahead timer and cancels not-yet-fired events, remembering the
   * current musical position so a later play() resumes from here. */
  pause(): void {
    if (this.status !== "playing") return;
    this.pausedAtBeat = this.getPlayheadBeat();
    this.haltAudio();
    this.status = "paused";
  }

  /** Stops playback and resets position to the start of the pattern. */
  stop(): void {
    if (this.status === "stopped") return;
    this.haltAudio();
    this.pausedAtBeat = 0;
    this.status = "stopped";
  }

  /** Re-anchors playback to the current tempo/pattern without an audible jump, preserving
   * musical position. Call after a live tempo (or structural pattern) change while
   * playing — see App's tempo control. Already-triggered notes finish under their
   * original timing; only not-yet-scheduled notes pick up the new tempo. */
  retime(): void {
    if (this.status !== "playing") return;
    const beat = this.getPlayheadBeat();
    this.haltAudio();
    this.status = "stopped";
    this.play(beat);
  }

  private haltAudio(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.runtime.cancelScheduled();
    for (const voice of this.activeVoices) this.runtime.release(voice);
    this.activeVoices.clear();
  }

  /** Current playhead position in beats, purely derived from the engine's own clock — see
   * ARCHITECTURE.md (webdsp), "How scheduling works". Never advanced by this timer or by
   * React state; the UI reads this every animation frame (see hooks/usePlayheadAnimation).
   * Holds at `startBeat` during the lead-in pre-roll (the ~50ms of scheduling headroom
   * play() reserves before its target beat is actually audible) rather than reading a
   * transiently-wrong position derived from a beat-0 anchor that lies in the future for any
   * non-zero resume point. */
  getPlayheadBeat(): number {
    if (this.status !== "playing") return this.pausedAtBeat;
    const now = this.runtime.getCurrentTime();
    if (now < this.audibleFrom) return this.startBeat;
    const elapsed = now - this.loopStartTime;
    const beatsPerLoop = totalBeats(this.getState());
    const beat = elapsed / secondsPerBeat(this.anchorTempo);
    return beatsPerLoop > 0 ? beat % beatsPerLoop : beat;
  }

  // Both derived from `this.loopStartTime`/`this.anchorTempo`, fixed for the whole span
  // between play()/retime() calls — see retime()'s doc comment for why that invariant is
  // what keeps this linear formula discontinuity-free across a live tempo change.
  private loopIterationTime(loopIndex: number, beatsPerLoop: number): number {
    return this.loopStartTime + loopIndex * beatsPerLoop * secondsPerBeat(this.anchorTempo);
  }

  private tick(): void {
    const state = this.getState();
    const beatsPerLoop = totalBeats(state);
    if (beatsPerLoop <= 0) return;
    const horizon = this.runtime.getCurrentTime() + LOOKAHEAD_SECONDS;

    while (this.loopIterationTime(this.nextLoopIndex, beatsPerLoop) < horizon) {
      const iterationStart = this.loopIterationTime(this.nextLoopIndex, beatsPerLoop);
      const events = compileLoopIteration({ ...state, tempo: this.anchorTempo }, iterationStart, 0);
      if (events.length > 0) {
        const handles = this.runtime.schedule(events);
        for (const h of handles) this.activeVoices.add(h);
      }
      this.nextLoopIndex++;
    }
  }
}
