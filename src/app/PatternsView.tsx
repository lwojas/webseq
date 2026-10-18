import type { ComponentProps } from "react";
import { PatternList } from "../components/PatternList";
import { PatternQueue } from "../components/PatternQueue";
import { PatternsHeader } from "../components/PatternsHeader";

interface Props {
  /** Mounted only while the page is on screen; the container stays so CSS can show/hide it. */
  active: boolean;
  header: ComponentProps<typeof PatternsHeader>;
  list: ComponentProps<typeof PatternList>;
  queue: ComponentProps<typeof PatternQueue>;
}

/** The Patterns page: a header band (what is being edited / playing), the pattern library, and the
 * queue. On desktop it is the second top tab; on a phone, the Library tab's Patterns sub-tab. Its
 * contents are mounted only while it is showing, so a hidden page costs nothing per render. */
export function PatternsView({ active, header, list, queue }: Props) {
  return (
    <div className="patterns-view">
      {active && (
        <>
          <PatternsHeader {...header} />
          <div className="patterns-columns">
            <PatternList {...list} />
            <PatternQueue {...queue} />
          </div>
        </>
      )}
    </div>
  );
}
