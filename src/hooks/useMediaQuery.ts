// Subscribes to a CSS media query so layout that must be *mounted* differently per breakpoint
// (phone chrome vs desktop chrome, the wide right-hand Track column) can switch in React instead
// of rendering both and hiding one with CSS. Only fires when the query's result actually flips,
// never per resize event, so it costs nothing while the window is being dragged.
import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
