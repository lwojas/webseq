import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AudioRuntime } from "webdsp";
import { GuidePreview } from "../audio/guidePreview";
import { applyRecipe, type ApplyResult } from "../guide/apply";
import { HOME_DEGREES, homeDemo, noteDemo, scaleDemo } from "../guide/demos";
import { RECIPES, RECIPE_CATEGORIES, type Recipe } from "../guide/recipes";
import { describeIdea, homeName, scaleNoteNames } from "../guide/resolve";
import { formatScale, isChromatic, scaleOf } from "../model/scale";
import type { InstrumentKindId, PatternId, Project, TrackId } from "../model/types";
import type { RecipeTrack } from "../guide/recipes";

interface Props {
  project: Project;
  /** The sequence being edited — what "Try this" fills if it is empty. */
  selectedPatternId: PatternId;
  /** The selected track, where "Try this" starts looking for an empty one. */
  selectedTrackId: TrackId | null;
  /** The shared audio engine, started on demand from a click (autoplay policy). */
  getRuntime: () => Promise<AudioRuntime | null>;
  /** Instrument kinds the engine does not provide (empty until the engine has started). */
  unavailableKinds: InstrumentKindId[];
  onApplyRecipe: (recipe: Recipe) => void;
  onClose: () => void;
}

interface Demo {
  track: RecipeTrack;
  bars: number;
}

/** The Musical Guide: a modal over a paused, inert sequencer. Teaches through the project's own
 * scale (hear it, click its notes, hear "home") and offers scale-relative recipes. It reads the
 * project and plays previews on its own throwaway instruments; the only thing it ever writes is
 * the explicit "Try this" (onApplyRecipe). */
export function MusicalGuide({ project, selectedPatternId, selectedTrackId, getRuntime, unavailableKinds, onApplyRecipe, onClose }: Props) {
  const scale = scaleOf(project);
  const names = useMemo(() => scaleNoteNames(scale), [scale.root, scale.scale]); // eslint-disable-line react-hooks/exhaustive-deps
  const home = homeName(scale);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<GuidePreview | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ recipeId: string; result: Extract<ApplyResult, { ok: true }> } | { recipeId: string; error: string } | null>(null);

  // Focus the dialog so Escape and Tab start inside it; stop any preview when it goes away.
  useEffect(() => {
    dialogRef.current?.focus();
    return () => previewRef.current?.stop();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const play = useCallback(
    async (key: string, tracks: RecipeTrack[], bars: number) => {
      if (playing === key) {
        previewRef.current?.stop();
        return;
      }
      const runtime = await getRuntime();
      if (!runtime) return;
      previewRef.current ??= new GuidePreview(runtime);
      setPlaying(key);
      previewRef.current.play({ tracks, bars, scale, bpm: project.bpm, beatsPerBar: project.beatsPerBar }, () => setPlaying((p) => (p === key ? null : p)));
    },
    [getRuntime, playing, project.bpm, project.beatsPerBar, scale],
  );

  const playDemo = (key: string, demo: Demo) => void play(key, [demo.track], demo.bars);

  const tryThis = (recipe: Recipe) => {
    const result = applyRecipe(project, recipe, { patternId: selectedPatternId, trackId: selectedTrackId, isKindAvailable: (k) => !unavailableKinds.includes(k) });
    if (!result.ok) {
      setApplied({ recipeId: recipe.id, error: result.reason });
      return;
    }
    previewRef.current?.stop();
    onApplyRecipe(recipe);
    setApplied({ recipeId: recipe.id, result });
  };

  const homeNames = HOME_DEGREES.map((d) => names[(d - 1) % names.length]);

  return (
    <div className="guide-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title" tabIndex={-1} ref={dialogRef}>
        <header className="guide-header">
          <div>
            <h2 id="guide-title" className="guide-title">
              Musical Guide
            </h2>
            <div className="guide-sub">Starting points to try. You stay the composer.</div>
          </div>
          <button className="btn" onClick={onClose} aria-label="Close the guide and return to the sequencer">
            Back to sequencer
          </button>
        </header>

        <div className="guide-body">
          <section className="guide-section" aria-labelledby="guide-scale">
            <h3 id="guide-scale" className="guide-heading">
              Your scale
            </h3>
            <div className="guide-scale-name">{formatScale(scale)}</div>
            <div className="guide-notes" role="group" aria-label="Scale notes">
              {names.map((name, i) => (
                <button
                  key={`${name}-${i}`}
                  className={`guide-note ${i === 0 ? "home" : ""} ${playing === `note-${i}` ? "active" : ""}`}
                  onClick={() => playDemo(`note-${i}`, noteDemo(i + 1, project.beatsPerBar))}
                  title={i === 0 ? `${name} — home. Tap to hear it.` : `${name} — tap to hear it`}
                >
                  <span className="guide-note-name">{name}</span>
                  <span className="guide-note-degree">{i + 1}</span>
                </button>
              ))}
            </div>
            <button className={`btn ${playing === "scale" ? "active" : ""}`} onClick={() => playDemo("scale", scaleDemo(scale, project.beatsPerBar))}>
              {playing === "scale" ? "■ Stop" : "▶ Play scale"}
            </button>
            <p className="guide-text">
              These are the notes available in this scale. Try playing only these notes — they naturally belong together. Some feel more settled, others
              create tension.
            </p>
            {isChromatic(scale) && (
              <p className="guide-text guide-hint">
                Your project uses the all-notes (chromatic) scale, so the guide shows {names.join(" ")}. Pick a scale in the Scale control to make it yours.
              </p>
            )}
          </section>

          <section className="guide-section" aria-labelledby="guide-home">
            <h3 id="guide-home" className="guide-heading">
              {home} is home
            </h3>
            <p className="guide-text">Starting or ending on {home} tends to make the music feel settled. Leave it, and the music wants to come back.</p>
            <div className="guide-idea">{homeNames.join(" → ")}</div>
            <button className={`btn ${playing === "home" ? "active" : ""}`} onClick={() => playDemo("home", homeDemo(project.beatsPerBar))}>
              {playing === "home" ? "■ Stop" : `▶ Hear it settle on ${home}`}
            </button>
          </section>

          <section className="guide-section" aria-labelledby="guide-try">
            <h3 id="guide-try" className="guide-heading">
              Try this
            </h3>
            <p className="guide-text">
              Each recipe is added to the selected track if it is empty, otherwise to the next empty track, in the sequence you are editing. Nothing that is already there is
              changed.{" "}
              Everything stays editable.
            </p>
            {RECIPE_CATEGORIES.map((category) => (
              <div key={category.id} className="guide-category">
                <h4 className="guide-category-title">{category.label}</h4>
                <div className="guide-recipes">
                  {RECIPES.filter((r) => r.category === category.id).map((recipe) => {
                    const key = `recipe-${recipe.id}`;
                    const outcome = applied?.recipeId === recipe.id ? applied : null;
                    return (
                      <article key={recipe.id} className="guide-recipe">
                        <div className="guide-recipe-head">
                          <span className="guide-recipe-name">{recipe.name}</span>
                          <span className="guide-recipe-bars">{recipe.bars} bars</span>
                        </div>
                        {recipe.tracks.map((t, i) => (
                          <div key={i} className="guide-idea" title="Scale degrees: 1 is home">
                            {describeIdea(t, scale)}
                          </div>
                        ))}
                        <p className="guide-text">{recipe.description}</p>
                        <div className="guide-recipe-actions">
                          <button className={`btn ${playing === key ? "active" : ""}`} onClick={() => void play(key, recipe.tracks, recipe.bars)}>
                            {playing === key ? "■ Stop" : "▶ Play"}
                          </button>
                          <button className="btn primary" onClick={() => tryThis(recipe)}>
                            Try this
                          </button>
                        </div>
                        {outcome && "error" in outcome && <div className="guide-result error">{outcome.error}</div>}
                        {outcome && "result" in outcome && (
                          <div className="guide-result" role="status">
                            Added to {outcome.result.trackIds.map((id) => `track ${String(project.tracks.findIndex((t) => t.id === id) + 1).padStart(2, "0")}`).join(", ")}
                            {outcome.result.grew ? `; the sequence grew to ${recipe.bars} bars` : ""}. Go back to the sequencer to play and change it.
                            {outcome.result.messages.map((m) => (
                              <div key={m}>{m}</div>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
