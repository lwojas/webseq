// Subscribes to a CSS media query so layout that must be *mounted* differently per breakpoint
// (phone chrome vs desktop chrome) can switch in React instead of rendering both and hiding one
// with CSS. Only fires when the query's result actually flips, never per resize event, so it costs
// nothing while the window is being dragged.
//
// The MediaQueryList is created once per query and `subscribe` is stable per query: React
// re-subscribes whenever `subscribe` changes identity, so an inline function here would add and
// remove the listener (and build a new MediaQueryList) on every render of the app.
import { useCallback, useSyncExternalStore } from "react";

const lists = new Map<string, MediaQueryList>();

function listFor(query: string): MediaQueryList {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = listFor(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => listFor(query).matches,
    () => false,
  );
}
