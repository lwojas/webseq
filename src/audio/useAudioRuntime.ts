// The only place in this app that talks to AudioRuntime.create(). Everything else receives
// the already-constructed runtime (or the Transport wrapping it) as a prop/context value —
// this hook is just an ordinary client of webdsp's public API, same as any non-React
// consumer's bootstrap code would be. See webdsp's ARCHITECTURE.md, "Using this as a
// package".
import { AudioRuntime, type RuntimeCapabilities } from "webdsp";
import { defaultWorkletUrl } from "webdsp/worklet-url";
import { useCallback, useRef, useState } from "react";

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
      const rt = await AudioRuntime.create({ workletModuleUrl: defaultWorkletUrl });
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
