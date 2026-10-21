// The Musical Guide's contract with the sequencer, as small pure functions so it can be tested
// without a DOM. App.tsx uses these for the real thing; the DOM side (the overlay, `inert` on the
// app root) enforces the same rule for pointer and keyboard focus.
//
// Contract: opening the guide pauses a playing transport (and nothing else); while it is open,
// input that bypasses the inert DOM — window key handlers, MIDI — is ignored; closing the guide
// does nothing to playback, so it never resumes on its own.

export interface PausableTransport {
  getStatus(): "playing" | "paused" | "stopped";
  pause(): void;
}

/** Pauses `transport` if (and only if) it is playing. Returns whether it paused it. */
export function pauseForGuide(transport: PausableTransport | null | undefined): boolean {
  if (transport?.getStatus() !== "playing") return false;
  transport.pause();
  return true;
}

/** Wraps an input handler so it does nothing while the guide is open. */
export function blockWhileGuideOpen<A extends unknown[]>(isOpen: () => boolean, handler: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    if (!isOpen()) handler(...args);
  };
}
