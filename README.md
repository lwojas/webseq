# webseq

A small 16-track tracker/sequencer UI that consumes [`webdsp`](https://github.com/lwojas/webdsp)
— a standalone WASM/AudioWorklet audio engine — as an ordinary external dependency, purely
through its public API. This repo exists partly to be a usable tracker and partly to prove
that `webdsp` is genuinely reusable by an application it knows nothing about: nothing here
imports engine internals, and the engine has no idea a "track" or "beat" exists.

```
Sequencer describes musical events  →  webdsp turns them into sound
```

If you're an agent picking this repo back up, read this file and `webdsp`'s own
`ARCHITECTURE.md` (its "Using this as a package" section especially) before changing
anything in `src/audio/` — several non-obvious fixes are already baked in there, and
undoing them re-breaks the dev server or the engine bootstrap. See "Known gotchas" below.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5174 — click Play to start the audio engine
npm test         # vitest: model + compile + Transport (no browser needed)
npm run build    # tsc --noEmit && vite build
```

## Architecture

```
src/model/       — pure sequencing data model. No React, no webdsp import. (types.ts,
                    pattern.ts's add/remove/resize/move/setTempo, reducer.ts)
src/audio/        — the one place the model meets webdsp:
                      compile.ts     — Note → webdsp ScheduledEvent (the only file that
                                       imports both model types and webdsp types)
                      transport.ts   — play/pause/stop + a lookahead scheduler (same
                                       pattern as webdsp's own LookaheadPlayer example,
                                       generalized to notes with duration)
                      useAudioRuntime.ts — the only place AudioRuntime.create() is called
src/modules/      — AudioModule abstraction (id/name/parameters/enabled) + the master
                    filter module. A future module (delay, reverb, ...) implements this
                    interface; the UI never needs to change shape for it.
src/components/   — React: transport bar, sequencer grid, note blocks, module strip.
                    Playhead and the position readout are driven by requestAnimationFrame
                    reading Transport's own clock — never React state — see
                    hooks/usePlayheadAnimation.ts, hooks/useRafText.ts.
```

The sequencing model (`src/model/`) never imports `"webdsp"`. `src/audio/compile.ts` is the
single translation point from musical positions (beats, tempo) to `webdsp`'s generic
`ScheduledEvent[]` (absolute engine time in seconds). If you're adding a model feature and
find yourself wanting to import a `webdsp` type into `src/model/`, that's a sign the feature
belongs in `src/audio/` instead.

## Known gotchas (already fixed here — don't undo them)

Two real integration issues surfaced while building this against `webdsp`. Both are
described in more detail in `webdsp`'s own `ARCHITECTURE.md` ("Using this as a package");
summarized here with where the fix actually lives in *this* repo:

1. **Vite's dev server breaks `webdsp`'s worklet loading unless excluded from
   pre-bundling.** Vite's `optimizeDeps` (esbuild) copies `webdsp`'s modules into
   `node_modules/.vite/deps/` before serving them in dev mode, which breaks
   `defaultWorkletUrl`'s `new URL(..., import.meta.url)`-based resolution (the worklet 404s
   and `AudioRuntime.create()` throws "Unable to load a worklet's module"). Fixed in
   `vite.config.ts`:
   ```ts
   optimizeDeps: { exclude: ["webdsp", "webdsp/worklet-url", "webdsp/sequencing"] },
   ```
   If you ever see that error again, check this hasn't been removed, and check it still
   covers whichever `webdsp` subpaths are actually imported.

2. **`webdsp`'s `VoiceParam`/`NodeParam`/`FilterMode` used to be `const enum`s**, which broke
   under this project's `isolatedModules: true` (required for Vite/esbuild) with TS2748.
   This was fixed *at the source* (`webdsp` commit `53d3e01`, now on `main`) rather than
   worked around here, so nothing in this repo carries a workaround for it — but if a
   dependency downgrade or a fork ever reintroduces `const enum` there, this is why the
   build breaks immediately on any `NodeParam.X`/`VoiceParam.X` access.

Playhead-specific gotcha, in case it resurfaces: the playhead overlay
(`.playhead-wrapper`/`.playhead` in `index.css`) must keep `pointer-events: none` — without
it, the overlay (positioned above the grid for the whole lane width) silently swallows every
click on the grid underneath it, and note creation/selection/resizing stops working with no
console error.

## The sequencing model

```ts
{
  tempo: 120,               // BPM, 40–240
  beatsPerBar: 16,          // grid resolution — a "beat" here is a sixteenth note in 4/4
  bars: 1,                  // loop length in bars; growing this doesn't change the model shape
  tracks: [{ id, sampleId, name }],
  notes: { [noteId]: { id, trackId, start, duration, velocity } },  // flat, not nested arrays
}
```

Notes are a flat `Record<NoteId, Note>`, not a per-track nested array or a fixed-size grid —
adding/removing/resizing a note is an O(1) map update, and nothing about the shape assumes
16 beats or 1 bar specifically (`src/model/types.ts`'s `totalBeats()` is the only place bar
count × beats-per-bar gets multiplied out). Extending to 4/8/16-bar patterns is a change to
how `bars` is set (currently fixed at 1, see `setBars` in `pattern.ts`, already implemented
and tested but not wired to any UI control yet), not a data-model rewrite.

## Extending

**Adding a module to the strip** (delay, reverb, ...): if the underlying DSP already exists
on `webdsp`'s master bus (check `NodeParam` in `webdsp`'s `src/runtime/types.ts` — `Delay`
is already there and unused by this app's UI), implement a `useXModule(runtime): AudioModule`
hook like `src/modules/useMasterFilterModule.ts` and add it to the `modules` array passed to
`<ModuleStrip>` in `App.tsx`. No new engine work, no UI framework change.

If the DSP itself doesn't exist yet (a genuinely new algorithm), that's a `webdsp` change,
not a `webseq` one — see `webdsp`'s ARCHITECTURE.md, "Adding a new master-bus module", for
exactly what that requires (a new native `DSPNode`, new `NodeParam`/`VoiceParam` ids, a
`DSPChain` capacity bump, a WASM rebuild).

## Testing

`test/pattern.test.ts`, `test/compile.test.ts`, `test/transport.test.ts` — all pure/fake-
runtime, no browser needed (same approach as `webdsp`'s own `lookaheadPlayer.test.ts`:
`Transport` is tested against a faked `AudioRuntime` under `vitest`'s fake timers, since a
real `AudioRuntime` needs a browser `AudioContext`/`AudioWorklet`). The end-to-end path
(load sample → add/resize/move notes → play → adjust the live filter → pause/stop, with a
real `AudioContext` confirmed running) was verified manually against a headless Chromium
instance rather than faked into test coverage that doesn't actually exist — see `webdsp`'s
ARCHITECTURE.md, "Automated tests for the non-realtime parts", for the same reasoning
applied to the engine side.
