import { useRafText } from "../hooks/useRafText";

interface Props {
  /** Read fresh each animation frame; must be referentially stable (see useRafText). */
  getText: () => string;
  className?: string;
}

/** A span whose text is rewritten straight from a per-frame read (the same mechanism as the
 * transport's Bar/Beat readout), so a live "bar 2 / 4" never goes through React state. */
export function RafText({ getText, className }: Props) {
  const ref = useRafText(getText);
  return <span className={className} ref={ref} />;
}
