// Follows an external clock when the runtime has one (AudioRuntime.onHostTransport -- a DAW plugin host,
// say). It is a client of Transport, not part of it: it watches the host's transport and calls
// Transport.playAt()/stop() so the queue plays where the host is. In a browser the runtime never reports a
// host transport, so none of this runs. See webdsp's docs/host-transport.md for the contract.
//
// Policy, deliberately simple:
//  - The host starts, or jumps (locate, loop wrap): restart at the host's position, at the host's tempo.
//  - The host changes tempo: re-anchor at the new tempo from the host's position (like retime()).
//  - The host stops: stop, but only if the host started this playback. A transport the user started by hand
//    while the host was stopped keeps running.
//  - The user pressing Pause/Stop while the host plays is respected until the host next starts/jumps.
//    The periodic refresh events do not restart it.
import { hostBeatAt, isHostDiscontinuity, type HostTransport } from "webdsp";

/** webseq beats are sixteenth steps; host positions are quarter notes. */
export const BEATS_PER_QUARTER = 4;

/** Never aim sooner than this after "now": the scheduler needs a tick to put the first notes in. */
const START_MARGIN_SECONDS = 0.03;

interface SyncRuntime {
  getCurrentTime(): number;
  getHostTransport(): HostTransport | null;
  onHostTransport(fn: (t: HostTransport) => void): () => void;
}

interface SyncTransport {
  getStatus(): "stopped" | "playing" | "paused";
  playAt(chainBeat: number, at: number, bpm: number): void;
  stop(): void;
}

export interface HostSync {
  /** The host tempo while this follower is driving playback, else null (for the UI). */
  getFollowedBpm(): number | null;
  dispose(): void;
}

export function createHostSync(opts: {
  runtime: SyncRuntime;
  /** The Transport, or null until it exists; events that arrive earlier are applied once it does. */
  getTransport: () => SyncTransport | null;
  /** Called whenever this follower started, retimed or stopped playback, with the host tempo it is
   * following (null once it let go), so UI state can refresh. */
  onChange: (followedBpm: number | null) => void;
}): HostSync {
  const { runtime, getTransport, onChange } = opts;
  let prev: HostTransport | null = null;
  let following = false;
  let followedBpm: number | null = null;
  let pendingStart = false;

  const resync = (t: HostTransport, transport: SyncTransport): void => {
    const at = Math.max(t.time, runtime.getCurrentTime() + START_MARGIN_SECONDS);
    transport.playAt(hostBeatAt(t, at) * BEATS_PER_QUARTER, at, t.bpm);
    following = true;
    followedBpm = t.bpm;
    pendingStart = false;
    onChange(followedBpm);
  };

  const apply = (t: HostTransport): void => {
    const last = prev;
    prev = t;
    const transport = getTransport();

    if (!t.playing) {
      pendingStart = false;
      if (following && transport) {
        transport.stop();
        following = false;
        followedBpm = null;
        onChange(null);
      }
      return;
    }
    if (!transport) {
      pendingStart = true;
      return;
    }
    const tempoChanged = last !== null && last.bpm !== t.bpm;
    if (isHostDiscontinuity(last, t) || tempoChanged || pendingStart) resync(t, transport);
    else if (following) followedBpm = t.bpm;
  };

  const unsubscribe = runtime.onHostTransport(apply);
  const current = runtime.getHostTransport();
  if (current) apply(current);

  return {
    getFollowedBpm: () => (following ? followedBpm : null),
    dispose: unsubscribe,
  };
}
