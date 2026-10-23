/** Wraps an async operation so that callers arriving while one run is in flight share that run's result instead of
 * starting another or giving up. Once a run settles the next call starts a fresh one. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = run().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}
