/**
 * How each series is drawn. Colour is never the only cue: every series also has its own marker
 * shape and line pattern, shown in the legend too. The colours are a validated categorical
 * palette (colour-blind separation checked); the lighter ones are below 3:1 contrast on white,
 * which is why every chart also has a legend and a table view.
 */
export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross';

export type SeriesStyle = { color: string; dash?: string; marker: MarkerShape };

/** In fixed order: a series keeps its style by its position in a fixed list, never by rank. */
export const SERIES_STYLES: SeriesStyle[] = [
  { color: '#2a78d6', marker: 'circle' },
  { color: '#eb6834', dash: '7 4', marker: 'square' },
  { color: '#1baf7a', dash: '2 3', marker: 'triangle' },
  { color: '#eda100', dash: '10 3 2 3', marker: 'diamond' },
  { color: '#e87ba4', dash: '4 2', marker: 'cross' },
];

export function styleAt(index: number): SeriesStyle {
  return SERIES_STYLES[index % SERIES_STYLES.length]!;
}

export const INK = '#1e1b4b';
export const INK_SOFT = '#4b5563';
export const GRID = '#e5e7eb';
export const SURFACE = '#ffffff';
/** Single-series bars use the brand violet (one series needs no categorical colour). */
export const BAR = '#6d28d9';
