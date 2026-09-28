import { useRef } from "react";
import type { Note } from "../model/types";

interface Props {
  note: Note;
  totalBeats: number;
  selected: boolean;
  onSelect: () => void;
  onResize: (duration: number) => void;
  onMove: (start: number) => void;
}

const MIN_DRAG_PX_FOR_RESIZE_HANDLE = 8;

/** A single note. Position/size are expressed as CSS percentages of the track lane's
 * width — musical, not pixel, truth still lives in `note.start`/`note.duration` (beats);
 * drag interactions here only compute pixel deltas to derive a *proposed* new beat value,
 * which the model then clamps/snaps (see model/pattern.ts resizeNote/moveNote) before it's
 * ever stored. */
export function NoteBlock({ note, totalBeats, selected, onSelect, onResize, onMove }: Props) {
  const elementRef = useRef<HTMLDivElement | null>(null);

  const left = (note.start / totalBeats) * 100;
  const width = (note.duration / totalBeats) * 100;

  const beginMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    const el = elementRef.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    const laneWidth = lane.getBoundingClientRect().width;
    const startX = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      el.style.transform = `translateX(${(deltaBeats / totalBeats) * 100}%)`;
    };
    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.style.transform = "";
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      onMove(note.start + deltaBeats);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const beginResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    const el = elementRef.current;
    const lane = el?.parentElement;
    if (!el || !lane) return;
    const laneWidth = lane.getBoundingClientRect().width;
    const startX = e.clientX;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      const proposed = Math.max(0.25, note.duration + deltaBeats);
      el.style.width = `${(proposed / totalBeats) * 100}%`;
    };
    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      el.style.width = `${width}%`;
      const deltaBeats = ((ev.clientX - startX) / laneWidth) * totalBeats;
      onResize(note.duration + deltaBeats);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div
      ref={elementRef}
      className={`note-block ${selected ? "selected" : ""}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      onMouseDown={beginMove}
      title={`start ${note.start}, duration ${note.duration}, velocity ${note.velocity.toFixed(2)}`}
    >
      <div className="resize-handle" style={{ width: MIN_DRAG_PX_FOR_RESIZE_HANDLE }} onMouseDown={beginResize} />
    </div>
  );
}
