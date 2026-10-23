// The only place in this app that talks to AudioRuntime.create(). Everything else receives
// the already-constructed runtime (or the Transport wrapping it) as a prop/context value —
// this hook is just an ordinary client of webdsp's public API, same as any non-React
// consumer's bootstrap code would be. See webdsp's ARCHITECTURE.md, "Using this as a
// package".
import { AudioRuntime, type RuntimeCapabilities } from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";
import { useCallback, useMemo, useRef, useState } from "react";
import { singleFlight } from "./singleFlight";

/** Voice pool size passed to webdsp. Sixty-four pads with loop voices, plus sequencer voices,
 * can exhaust webdsp's default of 64. Once the pool is full, a new trigger steals the quietest
 * sounding voice, which drops a sound silently (ECS-84). */
export const VOICE_POOL_SIZE = 128;

export function useAudioRuntime() {
  const [runtime, setRuntime] = useState<AudioRuntime | null>(null);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runtimeRef = useRef<AudioRuntime | null>(null);

  // One creation at a time, and a caller that arrives while it is running waits for it. (It used to get `null` back and
  // give up: a host restore that arrived while the runtime was still starting was silently dropped, so the project
  // did not come back when a plugin window was reopened.) `init` is stable, so effects that list it do not re-run.
  const create = useMemo(
    () =>
      singleFlight(async (): Promise<AudioRuntime | null> => {
        if (runtimeRef.current) return runtimeRef.current;
        try {
          const rt = await AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl, maxVoices: VOICE_POOL_SIZE });
          await rt.resume();
          runtimeRef.current = rt;
          setCapabilities(rt.getCapabilities());
          setRuntime(rt);
          return rt;
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          return null;
        }
      }),
    [],
  );

  // AudioContext can only start from a user gesture — call this from a click handler
  // (the transport's Play button).
  const init = useCallback(() => (runtimeRef.current ? Promise.resolve(runtimeRef.current) : create()), [create]);

  return { runtime, capabilities, error, init };
}
