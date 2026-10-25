// Colours for canvas drawings come from the app's CSS variables, read once when a display mounts,
// so canvases follow the theme like everything else. Painters take plain colour strings.

export function cssColor(el: Element, variable: string, fallback: string): string {
  return getComputedStyle(el).getPropertyValue(variable).trim() || fallback;
}

/** `color` with the given alpha, for fills and lines drawn over other content. */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
