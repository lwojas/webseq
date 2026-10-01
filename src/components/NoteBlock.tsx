import { useRef } from "react";
import type { Note } from "../model/types";
import { MIN_NOTE_DURATION } from "../model/notes";

interface Props {
  note: Note;
  totalBeats: number;
  selected: boolean;
  onSelect: () => void;
  /** `freePlacement` is true when Alt/Option was held at the end of the gesture, overriding
   * musical-grid snapping (see model/notes.ts's resizeNote/moveNote `resolution` param and
   * App.tsx's handleResizeNote/handleMoveNote, which pick FREE_PLACEMENT_RESOLUTION instead of
   * the toolbar grid resolution when this is true). */
  onResize: (duration: number, freePlacement: boolean) => void;
  onMove: (start: number, freePlacement: boolean) => void;
}

const MIN_DRAG_PX_FOR_RESIZE_HANDLE = 8;

/** A single note. Position/size are expressed as CSS percentages of the track lane's
 * width — musical, not pixel, truth still lives in `note.start`/`note.duration` (beats);
 * drag interactions here only compute pixel deltas to derive a *proposed* new beat value,
 * which the model then clamps/snaps (see model/pattern.ts resizeNote/moveNote) before it's
 * ever stored.
 *
 * Move and resize both go through Pointer Events rather than separate mouse/touch paths, so
 * mouse, touch, and pen all share one implementation. Capturing the pointer on the dragged
 * element (setPointerCapture) means pointermove/up/cancel keep firing on that element even
 * once the finger leaves its bounds, so the listeners can live on the element itself instead
 * of window — and `touch-action: none` on .note-block / .resize-handle (see index.css) is
 * what stops the browser from treating the gesture as a page/timeline scroll, scoped to just
 * those two elements so scrolling elsewhere in the timeline is untouched. A pointercancel
 * (the browser reclaiming the gesture for its own purposes) drops the in-progress edit
 * instead of committing it, since the user didn't deliberately finish the gesture. */
export function NoteBlock({ note, totalBeats, selected, onSelect, onResize, onMove }: Props) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  const left = (note.start / totalBeats) * 100;
  const width = (note.duration / totalBeats) * 100;

  const beginMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const el = elementRef.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    const laneWidth = lane.getBoundingClientRect().width;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    el.setPointerCapture(pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      el.style.transform = `translateX(${(deltaBeats / totalBeats) * 100}%)`;
    };
    const cleanup = () => {
      el.releasePointerCapture(pointerId);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      el.style.transform = "";
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      cleanup();
      onMove(note.start + deltaBeats, ev.altKey);
    };
    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    };
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
  };

  const beginResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const handle = e.currentTarget;
    const el = elementRef.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    const laneWidth = lane.getBoundingClientRect().width;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    handle.setPointerCapture(pointerId);

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      const proposed = Math.max(MIN_NOTE_DURATION, note.duration + deltaBeats);
      el.style.width = `${(proposed / totalBeats) * 100}%`;
    };
    const cleanup = () => {
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerCancel);
      el.style.width = `${width}%`;
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      cleanup();
      onResize(note.duration + deltaBeats, ev.altKey);
    };
    const onPointerCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
    };
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerCancel);
  };

  return (
    <div
      ref={elementRef}
      className={`note-block ${selected ? "selected" : ""}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      onPointerDown={beginMove}
      title={`start ${note.start}, duration ${note.duration}, velocity ${note.velocity.toFixed(2)}`}
    >
      <div className="resize-handle" style={{ width: MIN_DRAG_PX_FOR_RESIZE_HANDLE }} onPointerDown={beginResize} />
    </div>
  );
}
