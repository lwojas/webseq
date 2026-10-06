// The only place in this app that talks to AudioRuntime.create(). Everything else receives
// the already-constructed runtime (or the Transport wrapping it) as a prop/context value —
// this hook is just an ordinary client of webdsp's public API, same as any non-React
// consumer's bootstrap code would be. See webdsp's ARCHITECTURE.md, "Using this as a
// package".
import { AudioRuntime, type RuntimeCapabilities } from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";
import { useCallback, useRef, useState } from "react";

/** Voice pool size passed to webdsp. Sixty-four pads with loop voices, plus sequencer voices,
 * can exhaust webdsp's default of 64. Once the pool is full, a new trigger steals the quietest
 * sounding voice, which drops a sound silently (ECS-84). */
export const VOICE_POOL_SIZE = 128;

export function useAudioRuntime() {
  const [runtime, setRuntime] = useState<AudioRuntime | null>(null);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initializing = useRef(false);

  // AudioContext can only start from a user gesture — call this from a click handler
  // (the transport's Play button).
  const init = useCallback(async () => {
    if (runtime || initializing.current) return runtime;
    initializing.current = true;
    try {
      const rt = await AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl, maxVoices: VOICE_POOL_SIZE });
      await rt.resume();
      setCapabilities(rt.getCapabilities());
      setRuntime(rt);
      return rt;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      initializing.current = false;
    }
  }, [runtime]);

  return { runtime, capabilities, error, init };
}
