// Musical Guide recipes: small, scale-relative musical ideas ("Try this"). Plain data, no React,
// no audio, no MIDI numbers — a recipe says "degree 1, then degree 3" and never "A3 C4", so the
// same recipe works in any project scale (guide/resolve.ts turns it into concrete notes).
//
// A recipe demonstrates ONE idea and has a musical length in bars; applying it (guide/apply.ts)
// sizes a sequence to fit. Adding a recipe is adding an entry to RECIPES.

import type { InstrumentKindId } from "../model/types";

export type RecipeCategory = "bass" | "melody" | "chords";
export type RecipeRole = "bass" | "melody" | "chord";

/** One note or chord of a recipe. Position is bar-relative so it works for any beatsPerBar. */
export interface RecipeEvent {
  /** 0-based bar within the recipe. */
  bar: number;
  /** Step within the bar (a step = one grid beat = a 16th note by default). */
  step: number;
  /** Length in steps. */
  length: number;
  /** 1-based scale degree, 1 = home. Degrees past the scale's size wrap up an octave. */
  degree: number;
  /** Whole octaves above (or below, negative) the track's base octave. Default 0. */
  octave?: number;
  /** 0..1, default DEFAULT_RECIPE_VELOCITY. */
  velocity?: number;
  /** A CHORD_SHAPES id (model/chord.ts): the event is a chord built on `degree`, not a single
   * note. The same chord primitive the Track Editor's Chord mode creates. */
  chord?: string;
}

export interface RecipeTrack {
  role: RecipeRole;
  /** Suggested instrument (an InstrumentKindId from the existing synth registry). Optional:
   * without one, the recipe plays on whatever source the chosen track already has. */
  instrument?: InstrumentKindId;
  events: RecipeEvent[];
}

export interface Recipe {
  id: string;
  name: string;
  category: RecipeCategory;
  description: string;
  /** Musical length: applying the recipe makes a sequence this many bars long. */
  bars: number;
  tracks: RecipeTrack[];
}

export const DEFAULT_RECIPE_VELOCITY = 0.9;

export const RECIPE_CATEGORIES: { id: RecipeCategory; label: string }[] = [
  { id: "bass", label: "Bass" },
  { id: "melody", label: "Melody" },
  { id: "chords", label: "Chords" },
];

/** The same bar-relative figure repeated over `bars` bars. */
function repeatBars(bars: number, figure: Omit<RecipeEvent, "bar">[]): RecipeEvent[] {
  return Array.from({ length: bars }, (_, bar) => figure.map((e) => ({ ...e, bar }))).flat();
}

/** A two-bar phrase (events carry bar 0 or 1) repeated to fill `bars` bars. */
function repeatPhrase(bars: number, phrase: RecipeEvent[]): RecipeEvent[] {
  return Array.from({ length: bars / 2 }, (_, i) => phrase.map((e) => ({ ...e, bar: e.bar + i * 2 }))).flat();
}

export const RECIPES: Recipe[] = [
  {
    id: "bass-root-pulse",
    name: "Root Pulse",
    category: "bass",
    description: "Hammer the home note on every beat. The simplest bass line there is, and it always sounds right.",
    bars: 4,
    tracks: [
      {
        role: "bass",
        instrument: "bass",
        events: repeatBars(4, [0, 4, 8, 12].map((step, i) => ({ step, length: 2, degree: 1, velocity: i === 0 ? 1 : 0.85 }))),
      },
    ],
  },
  {
    id: "bass-root-fifth",
    name: "Root + Fifth",
    category: "bass",
    description: "Home, home, then jump up to the fifth note of the scale and fall back. A classic bass move.",
    bars: 4,
    tracks: [
      {
        role: "bass",
        instrument: "bass",
        events: repeatBars(4, [
          { step: 0, length: 3, degree: 1, velocity: 1 },
          { step: 4, length: 3, degree: 1 },
          { step: 8, length: 3, degree: 5 },
          { step: 12, length: 3, degree: 1 },
        ]),
      },
    ],
  },
  {
    id: "melody-two-note",
    name: "Two Note Motif",
    category: "melody",
    description: "A tiny tune from just two scale notes: home and the third. Short ideas stick in the ear.",
    bars: 4,
    tracks: [
      {
        role: "melody",
        instrument: "pulse",
        events: repeatBars(4, [
          { step: 0, length: 4, degree: 1, octave: 1 },
          { step: 4, length: 4, degree: 3, octave: 1 },
          { step: 8, length: 4, degree: 1, octave: 1 },
        ]),
      },
    ],
  },
  {
    id: "melody-tension-release",
    name: "Tension & Release",
    category: "melody",
    description: "Leave home, climb to the third, step down through the second, and come back to rest on home.",
    bars: 4,
    tracks: [
      {
        role: "melody",
        instrument: "pulse",
        events: repeatPhrase(4, [
          { bar: 0, step: 0, length: 6, degree: 1, octave: 1 },
          { bar: 0, step: 8, length: 6, degree: 3, octave: 1 },
          { bar: 1, step: 0, length: 6, degree: 2, octave: 1 },
          { bar: 1, step: 8, length: 8, degree: 1, octave: 1, velocity: 1 },
        ]),
      },
    ],
  },
  {
    id: "chords-triad-movement",
    name: "Simple Triad Movement",
    category: "chords",
    description: "Three-note chords built from the scale, one per bar: home, the fourth, the fifth, then home again.",
    bars: 4,
    tracks: [
      {
        role: "chord",
        instrument: "pad",
        events: [1, 4, 5, 1].map((degree, bar) => ({ bar, step: 0, length: 16, degree, chord: "triad", velocity: 0.8 })),
      },
    ],
  },
  {
    id: "chords-two-chord",
    name: "Two Chord Movement",
    category: "chords",
    description: "Two chords trading places every two bars: home, then the sixth. Often all a loop needs.",
    bars: 8,
    tracks: [
      {
        role: "chord",
        instrument: "pad",
        events: [1, 6, 1, 6].flatMap((degree, i) => [0, 1].map((n) => ({ bar: i * 2 + n, step: 0, length: 16, degree, chord: "triad", velocity: 0.8 }))),
      },
    ],
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
