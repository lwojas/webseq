// Shared sizing between the main note grid and the automation lane, so a beat lines up
// pixel-for-pixel between them (the automation lane sits directly under a track's notes — see
// project brief section 15). A fixed per-beat pixel width (rather than the old 1fr-per-beat
// grid, which always stretched to fill its container) is what makes a capped, horizontally-
// scrollable viewport possible — see SequencerGrid's doc comment.
export const BEAT_WIDTH_PX = 28;

/** How many bars the default timeline viewport shows before it starts scrolling — see
 * project brief section 7. */
export const VIEWPORT_BARS = 2;
