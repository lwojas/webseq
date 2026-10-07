// Shared sizing between the main note grid and the automation lane, so a beat lines up
// pixel-for-pixel between them (the automation lane sits directly under a track's notes — see
// project brief section 15). A fixed per-beat pixel width (rather than the old 1fr-per-beat
// grid, which always stretched to fill its container) is what makes a capped, horizontally-
// scrollable viewport possible — see SequencerGrid's doc comment.
//
// That per-beat width is no longer a single constant: it's now a user-adjustable zoom level
// threaded through app state (see useTimelineZoom) and passed down as `pxPerBeat` to
// SequencerGrid, TrackRow, AutomationLane and usePlayheadAnimation — see ECS-53. NoteBlock is
// the one exception: its notes are positioned/sized as percentages of the track lane, not
// pixels, so it never needs the scale directly.

/** How many bars the default timeline viewport shows before it starts scrolling — see
 * project brief section 7. */
export const VIEWPORT_BARS = 2;

/** Bounded, discrete zoom levels (pixels per beat) — a +/- control or dropdown steps through
 * this fixed menu rather than offering continuous/pinch zoom, which would conflict with note
 * drag/resize (`touch-action: none` on .note-block, see NoteBlock.tsx) and with horizontally
 * scrolling the viewport (see SequencerGrid's doc comment). Index 0 is the most zoomed-out
 * level, the last index the most zoomed-in. */
export const ZOOM_LEVELS_PX_PER_BEAT = [8, 11, 16, 22, 28, 40, 56, 80, 112] as const;

/** The project's original fixed BEAT_WIDTH_PX, kept as the default zoom level so the default
 * view is pixel-identical to before zoom existed. */
export const DEFAULT_ZOOM_INDEX = ZOOM_LEVELS_PX_PER_BEAT.indexOf(28);

/** A note's resize handle (see NoteBlock.tsx) is a fixed-width touch target sitting at the
 * note's right edge. If a zoom level ever packed a beat tighter than the handle itself, the
 * handle would no longer fit within even a full-beat note, so the minimum zoom level is bounded
 * by the handle width — separately for fine and coarse pointers, since they use different
 * handle widths (NoteBlock.tsx for fine, index.css's `@media (pointer: coarse)` block for
 * coarse). Coarse also gets a lower max: there's less benefit to zooming in further than that
 * on the smaller touch surfaces that `pointer: coarse` typically implies. */
export const RESIZE_HANDLE_WIDTH_PX = 8;
export const RESIZE_HANDLE_WIDTH_PX_COARSE = 22;

/** Touch tap-to-remove (ECS-129): on `pointerup`, a touch gesture whose total movement since
 * `pointerdown` stayed under this threshold is treated as a tap (removing the note) rather
 * than a drag (moving it). Mouse and pen are unaffected — they keep the existing no-op-move-
 * on-zero-movement behavior; see NoteBlock.tsx's `beginMove`. */
export const TAP_MOVE_THRESHOLD_PX = 10;

export const MIN_ZOOM_INDEX_FINE = ZOOM_LEVELS_PX_PER_BEAT.findIndex((px) => px >= RESIZE_HANDLE_WIDTH_PX);
export const MIN_ZOOM_INDEX_COARSE = ZOOM_LEVELS_PX_PER_BEAT.findIndex((px) => px >= RESIZE_HANDLE_WIDTH_PX_COARSE);
export const MAX_ZOOM_INDEX_FINE = ZOOM_LEVELS_PX_PER_BEAT.length - 1;
export const MAX_ZOOM_INDEX_COARSE = ZOOM_LEVELS_PX_PER_BEAT.length - 2;

/** How many extra beat-columns TrackRow mounts on each side of the scrolled-into-view range
 * (see useVisibleColumnWindow, ECS-56) before the grid's own content-box boundary clips them.
 * Covers the gap between one rAF-driven window recompute and the next during a fast scroll
 * fling, without mounting anywhere near a full pattern's worth of cells. */
export const COLUMN_OVERSCAN_BEATS = 8;
