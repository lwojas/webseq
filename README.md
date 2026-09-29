# webseq

A 16-track tracker/sequencer app that consumes [`webdsp`](https://github.com/lwojas/webdsp) —
a standalone WASM/AudioWorklet audio engine — as an ordinary external dependency, purely
through its public API. This repo exists partly to be a usable tracker and partly to prove
that `webdsp` is genuinely reusable by an application it knows nothing about: nothing here
imports engine internals, and the engine has no idea a "project", "pattern", "track", or
"beat" exists.

```
Sequencer describes musical events  →  webdsp turns them into sound
```

If you're an agent picking this repo back up, read this file and `webdsp`'s own
`ARCHITECTURE.md` (its "Using this as a package" and "Buses / mixing" sections especially)
before changing anything in `src/audio/` — several non-obvious fixes are already baked in
there, and undoing them re-breaks the dev server or the engine bootstrap. See "Known
gotchas" below.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5174 — click Play to start the audio engine
npm test         # vitest: model + audio + Transport (no browser needed)
npm run build    # tsc --noEmit && vite build
```

## Architecture

```
src/model/       — pure application model. No React, no webdsp import.
                      types.ts      — Project/Track/Pattern/Note/ChainEntry/FxInstance/
                                      AutomationLane and the pure helpers over them
                      notes.ts      — note add/remove/resize/move/setBars, scoped to one
                                      Pattern (the direct descendant of the original
                                      prototype's pattern.ts)
                      project.ts    — project-wide ops: BPM, sample assignment, pattern
                                      CRUD, chain CRUD, sample-id remapping on load
                      fx.ts         — FX_DEFS (what a "filter"/"delay" is, generically) +
                                      FX chain CRUD, shared by tracks and master
                      automation.ts — automation lane CRUD + playback evaluation
                                      (valueAtBeat: sparse points, linear interpolation,
                                      hold-last-value)
                      reducer.ts    — Action union + reducer, composing the above
src/audio/        — the one place the model meets webdsp:
                      compile.ts     — Note → webdsp ScheduledEvent, bus-aware
                      buses.ts       — Track -> webdsp BusId assignment (runtime-only,
                                      never persisted — see "Persistence" below)
                      applyFx.ts     — FxInstance[] → webdsp NodeParam calls on a bus
                      transport.ts   — play/pause/stop/retime + a lookahead scheduler that
                                      walks the *pattern chain* continuously (see "Pattern
                                      chain playback" below), plus per-tick automation
                                      polling
                      useAudioRuntime.ts — the only place AudioRuntime.create() is called
src/persistence/  — IndexedDB-backed project + sample save/load (db.ts, projectStore.ts).
                    No backend; fully local/offline.
src/components/   — React: transport bar, pattern bar, chain editor, sequencer grid
                    (MASTER row + tracks), FX panel (contextual to the selected track or
                    MASTER), automation lane editor. Playhead and the position readout are
                    driven by requestAnimationFrame reading Transport's own clock — never
                    React state — see hooks/usePlayheadAnimation.ts, hooks/useRafText.ts.
```

The application model (`src/model/`) never imports `"webdsp"`. `src/audio/compile.ts` is the
single translation point from musical positions (beats, a project-wide BPM) to `webdsp`'s
generic `ScheduledEvent[]` (absolute engine time in seconds, optionally addressed to a
specific `BusId`). If you're adding a model feature and find yourself wanting to import a
`webdsp` type into `src/model/`, that's a sign the feature belongs in `src/audio/` instead.

## The application model

```ts
Project {
  id, name,
  bpm,                 // one BPM for the whole project — patterns have none of their own
  beatsPerBar,          // grid resolution (16 today), project-wide, not hardcoded elsewhere
  tracks: Track[],      // stable identity across patterns; each owns assetId + FX + automation
  patterns: Pattern[],  // each has its own `bars`, no BPM of its own
  patternChain: ChainEntry[], // ordered, possibly-repeating sequence of pattern ids
  master: { fx, automation },  // bus/control entity, not a sample-producing track
  assets: Asset[],      // the project-level Asset Bin — see "Asset Bin and resampling"
}
```

A **Pattern** contains only musical events (a flat `Record<NoteId, Note>`, same rationale as
the original prototype) and its own bar count; it never carries a tempo, a track copy, or FX —
those live on `Project`/`Track` so switching or chaining patterns can never desync them. A
**Track** owns its asset assignment (`assetId`, a reference into `Project.assets` — never audio
data itself), its ordered FX chain (`FxInstance[]`), and its optional per-FX automation
(`AutomationLane[]`) — all stable across every pattern that references the track by id.

## Pattern chain playback (continuous, gapless)

`src/audio/transport.ts`'s `Transport` walks `project.patternChain` with an ever-increasing
step counter, resolved against the *current* chain each time a new step is about to be
scheduled (`resolveChainStep` in `model/types.ts`) — never precomputed in full. Concretely:

- Every event already handed to `webdsp` keeps playing exactly as scheduled; nothing here
  ever cancels a scheduled event except an explicit pause/stop. Editing the chain mid-playback
  only ever changes what the *next not-yet-scheduled* step resolves to — the currently-
  sounding pattern is never cut off or restarted because the chain changed underneath it.
- The same reasoning covers editing a pattern's notes while it's playing: `Transport` reads
  project state fresh on every ~25ms tick, so an edit changes what the *next* playthrough of
  that pattern compiles to, never what's already been scheduled.
- Patterns of different lengths chain seamlessly: each step's duration is that pattern's own
  `bars * beatsPerBar` at the project's one BPM, and the next step's absolute start time is
  exactly the previous step's end time — no gap, no restart of the AudioContext/transport.
- The chain loops from its last entry back to its first.

`Transport.getPlayheadInfo()` returns `{ patternId, beat }` — which pattern is *actually
sounding* right now and how far into it. A pattern's timeline (`SequencerGrid`) only draws a
playhead when its own pattern id matches this, so viewing a pattern that isn't currently
playing simply shows no playhead (see `hooks/usePlayheadAnimation.ts`).

## Per-track FX and buses

`webdsp` originally shipped with exactly one real mixer bus (`MASTER_BUS`). Giving each track
its own filter+delay chain — distinct from master's — needed one small, already-anticipated
engine addition: `AudioRuntime.createBus()`, which hands out an additional bus backed by the
same `NodeParam`-addressable filter+delay chain as `MASTER_BUS`. See `webdsp`'s
`ARCHITECTURE.md`, "Buses / mixing", for the full routing model
(`track voices -> track bus chain -> [sum] -> master bus chain -> output`); `src/audio/buses.ts`
is this app's side of that — one bus per track, assigned once (via `ensureTrackBuses`) when the
runtime is ready, never persisted (a `BusId` is a live runtime handle, meaningless across a
reload — see "Persistence").

`src/model/fx.ts`'s `FX_DEFS` is the only place that knows what a "filter" or "delay" *is* at
the model level (param keys/ranges/defaults); `src/audio/applyFx.ts` is the only other place,
translating those generic params into `NodeParam` calls. One real engine constraint: `webdsp`'s
`Bus` has exactly one filter slot and one delay slot (a fixed two-node chain), so a track's FX
chain may contain at most one of each type, and the engine always applies filter before delay
regardless of this array's stored order (reordering the two isn't implemented — see that
file's doc comment).

## FX automation

`AutomationLane` (`model/types.ts`) holds sparse `{ position, value }` points for one
parameter of one FX. Deliberately simple: linear interpolation between points, holding the
first point's value before it and the last point's value after it — no curves, no envelopes,
no recording. `Transport.pollAutomation` applies the current value at the same ~25ms tick rate
as note scheduling (polled, not sample-accurately ramped — `webdsp` has no ramp primitive) and
is evaluated against the beat offset within whichever chain step is currently sounding, so one
lane applies consistently regardless of which pattern happens to be playing on that track (see
that method's doc comment for the exact rule). The bottom FX panel only ever shows the
automation for the one FX parameter currently selected — never a whole track's automation at
once — per the "keep automation visually clean" brief.

## Asset Bin and resampling

Audio resources are project-level (`Project.assets: Asset[]`, `src/model/types.ts`), never
owned by a single track — a `Track` only ever holds an `assetId` reference, so the same asset
(imported or resampled) can back any number of tracks at once. `AssetsPanel` (imports, assigns
to the currently selected track, renames, removes) is the UI for this; `model/project.ts`'s
`addAsset`/`assignAsset`/`renameAsset`/`removeAsset` are the corresponding model operations —
`removeAsset` also clears the reference on every track that had it assigned, so a track never
ends up pointing at an asset the bin no longer lists.

**Resampling** (the `[ RESAMPLE ]` transport control) captures exactly one iteration of
whichever pattern is currently sounding — including its track FX, the mixer, and master FX,
since the capture taps `webdsp`'s post-master-bus output — and turns the result into an
ordinary new Asset. This needed one small, additive extension to `webdsp` itself:
`AudioRuntime.armCapture({ startTime, stopTime })`, which arms a sample-accurate capture window
against the engine's own render clock (mirroring how `schedule()` already handles note events),
rather than the original `startCapture`/`stopCapture` pair's *immediate* start/stop — see that
package's `ARCHITECTURE.md`, "How armed capture works". `Transport.armResample()`
(`src/audio/transport.ts`) does the actual alignment: it doesn't compute a boundary time itself,
it just watches its own ordinary chain-scheduling loop (`tick()`) for the first *future* step
that resolves to the currently-active pattern — which, by construction, is that pattern's next
real occurrence in the chain, however far away (e.g. on `A -> A -> B -> C -> B` with `B`
active, that's the later `B`, not the intervening `C`) — and arms the engine capture for
exactly that step's `[start, end)`. No timers anywhere in this path.

Captured PCM comes back from `armCapture()` alongside the registered engine Sample's metadata
and is encoded as a WAV file (`src/audio/wav.ts`) purely so it can be persisted through the
exact same path an imported file's bytes already use (see "Persistence" below) — there's no
separate "resampled asset" storage format. BPM changes are refused (`Transport.retime()`
no-ops) while a resample is armed or capturing, and the transport bar disables the BPM control
for the same window, since an armed capture's window is already fixed against the current
tempo. The engine's own capture-capacity limit (`RuntimeCapabilities.maxCaptureSeconds`) is
checked *before* ever arming a capture, so an over-long pattern is refused deterministically
rather than producing a truncated recording.

## Persistence

`src/persistence/` saves a `Project` (already plain, deterministic, JSON-serializable data —
no functions, no `AudioRuntime`/`AudioWorklet`/WASM objects) to IndexedDB, with each asset's
raw bytes kept in a separate object store rather than embedded as base64 in the project JSON.
Loading a project re-registers each asset's bytes with the live `AudioRuntime` — `webdsp`
assigns `SampleId`s sequentially per runtime instance (and `AssetId` *is* that same numeric
space, see `model/types.ts`), so a fresh runtime almost never reproduces a previous session's
ids — and remaps every reference (`remapAssetIds` in `model/project.ts`) to whatever id the
runtime actually gives it this time. No backend; this is IndexedDB only, fully local/offline.

## Known gotchas (already fixed here — don't undo them)

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
   Fixed *at the source* (`webdsp` commit `53d3e01`), so nothing in this repo carries a
   workaround for it — but if a dependency downgrade or a fork ever reintroduces `const enum`
   there, this is why the build breaks immediately on any `NodeParam.X`/`VoiceParam.X` access.

3. **Developing against a local `webdsp` checkout via `npm link` breaks the same worklet
   loading a different way.** `npm link` makes `node_modules/webdsp` a symlink to a sibling
   checkout *outside* this project root; Vite's dev server then resolves
   `import.meta.url`-based asset URLs to that real, outside-the-root path and its `fs.allow`
   sandbox 403s it (a different failure mode of the same underlying worklet-loading path as
   gotcha #1). If you need to iterate on `webdsp` locally, the actual fix used during this
   project's multi-bus work was to commit + push `webdsp` and reinstall the real
   `github:lwojas/webdsp` dependency rather than keep the symlink around — simplest, and
   avoids adding a `resolve.preserveSymlinks` workaround that a normal (non-linked) install
   would never need.

Playhead-specific gotcha, in case it resurfaces: the playhead overlay
(`.playhead-wrapper`/`.playhead` in `index.css`) must keep `pointer-events: none` — without
it, the overlay (positioned above the grid for the whole lane width) silently swallows every
click on the grid underneath it, and note creation/selection/resizing stops working with no
console error.

## Timeline viewport

The grid uses a fixed pixel width per beat (`components/timelineConstants.ts`'s
`BEAT_WIDTH_PX`), not a 100%-stretched grid — this is what makes a capped, horizontally-
scrollable viewport possible. The default viewport caps at `VIEWPORT_BARS` (2) bars; a longer
pattern scrolls horizontally inside `.timeline-scroll` rather than shrinking every beat to
fit. The playhead is positioned in pixels (`beat * BEAT_WIDTH_PX`) via
`usePlayheadAnimation`'s `requestAnimationFrame` loop, independent of the viewport — it's
fine for it to scroll out of view; nothing here auto-scrolls to follow it.

## Extending

**Adding a third FX type** (reverb, compression, EQ...): if the underlying DSP already exists
on `webdsp`'s bus (check `NodeParam` in `webdsp`'s `src/runtime/types.ts`), add an entry to
`FX_DEFS` (`model/fx.ts`) and a case in `applyFx.ts`'s `applyFilter`/`applyDelay`-shaped
functions — no new UI component needed, `ModulePanel`/`FxChainStrip`/`AutomationLane` all
render generically from `FX_DEFS`. If the DSP itself doesn't exist yet, that's a `webdsp`
change (a new `DSPNode`, a `DSPChain` capacity bump, a WASM rebuild) — see `webdsp`'s
`ARCHITECTURE.md`, "Adding a new master-bus module".

## Testing

`test/notes.test.ts`, `test/project.test.ts`, `test/fx.test.ts`, `test/automation.test.ts`,
`test/compile.test.ts`, `test/transport.test.ts`, `test/wav.test.ts` — all pure/fake-runtime, no
browser needed (same approach as `webdsp`'s own `lookaheadPlayer.test.ts`: `Transport` is
tested against a faked `AudioRuntime` under `vitest`'s fake timers, since a real `AudioRuntime`
needs a browser `AudioContext`/`AudioWorklet`). `transport.test.ts` specifically covers gapless
multi-pattern chain playback, chain-looping, the "editing the chain/a pattern during playback
only affects the future" contract, and (its `describe("Transport resampling", ...)` block) that
`armResample()` waits for the *correct* future occurrence of the active pattern on a
multi-pattern chain rather than the next chain step regardless of which pattern it is.
`project.test.ts` covers the Asset Bin: add/rename/remove, multiple tracks sharing one asset,
and that removing an assigned asset clears the reference. The end-to-end path (multi-pattern
project, chain playback, per-track filter + automation, Asset Bin import/assign/resample,
save/reload) was verified manually against a headless Chromium instance rather than faked into
test coverage that doesn't actually exist — including catching a real bug this way: an early
version of `webdsp`'s `armCapture()` resolved its caller with an already-`postMessage`-detached
`ArrayBuffer`, invisible to the Node-based test suite since nothing there exercises real
`postMessage` transfer semantics.
