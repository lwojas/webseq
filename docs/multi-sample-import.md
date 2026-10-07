# Loading multiple samples into the Asset Bin

Investigation for ECS-111 (parent ECS-81). Maps the existing single-file asset-import
architecture, recommends the batch-import behaviour, and lists the decisions, edge cases, and
deferrals needed before implementation. The implementation itself is proposed as a separate
follow-up issue, since ECS-111 is investigation-only.

## Current state

| Concern | Where it lives today | Notes |
| --- | --- | --- |
| Asset Bin import | `src/components/AssetsPanel.tsx:59-72` | Hidden `<input type="file" accept="audio/*">`, no `multiple`. `onChange` reads `e.target.files?.[0]` — only the first OS-picker selection is ever used; the rest are silently discarded. |
| Per-track Load | `src/components/TrackRow.tsx:93-112` | A second, separate file input that imports *and* assigns to one track in a single action (`onLoadSample: (trackId, file: File) => void`). Same single-file pattern, but intentionally single-asset-to-single-track — out of scope for this change. |
| Decode | `importAsset`, `src/App.tsx:249-269` | `file.arrayBuffer()` → `runtime.loadSample(arrayBuffer, { name })` (the `webdsp` engine decodes, not raw `decodeAudioData`). Stores raw bytes in `assetDataRef.current`, builds an `Asset`, dispatches `ADD_ASSET`. Shared by both import paths above. |
| Asset id | `AssetId = SampleId`, `src/model/types.ts:16-22` | A plain `number`, assigned by `webdsp`'s internal `nextSampleId` counter inside `loadSample()`. The app never generates ids itself. Not stable across sessions — see "Persistence". |
| Duplicate handling | `addAsset`, `src/model/project.ts:162-166` | Dedupes only by `id` (replace-in-place), never by filename. Importing the same file twice today already produces two distinct bin entries with the same name — pre-existing behaviour, not something this change introduces. |
| Data model | `Asset` (`model/types.ts:182-200`), `Project.assets: Asset[]` (`:227`), `Track.assetId: AssetId \| null` (`:39-42`) | Metadata-only `Asset`; a `Track` only ever references one by id. Import (`ADD_ASSET`) and assignment (`ASSIGN_ASSET`) are already decoupled — the Asset Bin's "+ Import" only adds to the bin; only the per-track "Load" button chains import→assign. |
| Memory budget | `estimateDecodedBytes`/`sampleBudgetBytes`, `project.ts:96-109`, read in `AssetsPanel.tsx:44-47` | Soft warning (not a hard block) when total decoded bytes across `project.assets` crosses 256MB (fine pointer) / 128MB (coarse/touch pointer). Sums across the whole bin already, so it needs no change to account for a batch. |
| Persistence | `src/persistence/db.ts`, `projectStore.ts` | IndexedDB: project JSON in one store, each asset's raw bytes keyed by `${projectId}:${assetId}` in another. `loadProject` + `remapAssetIds` (`project.ts:333-340`) re-register every asset with the (possibly fresh) runtime and fix up every `Track.assetId` reference, since `webdsp` reissues sample ids per runtime instance. |
| Existing N-item precedent | `handleLoadProject`, `App.tsx:475-503` | A sequential `for (const asset of loaded.project.assets) { await runtimeInstance.loadSample(...) }` loop — registers many assets with the engine one at a time, accumulating into `assetDataRef` and an id-remap map before one combined dispatch. This is the shape a batch importer should follow. |
| Error handling (import) | none | `importAsset` has no try/catch; `handleImportAsset` does `void importAsset(file)` with no `.catch`. A decode failure today is an unhandled promise rejection with zero UI feedback. |
| Error handling (precedent to reuse) | `handleResample`, `App.tsx:317-350` | Has a proper try/catch and a `resamplePhase`/`resampleError` status pattern surfaced in the UI — the shape a batch-import feedback mechanism should imitate. |
| Mobile | none specific | Both file inputs are plain `<input type="file" accept="audio/*">` with no `capture` attribute or pointer-based branching. Mobile Safari/Chrome both support multi-select file pickers, so adding `multiple` should work, but wants a manual check. No drag-and-drop exists anywhere in the codebase to extend. |

## Recommendation

### 1. Observable behaviour: Asset-Bin-only, partial-success

Selecting multiple files adds each successfully-decoded one to the Asset Bin as its own
`Asset`, exactly as single-file import does today. **No automatic track/pad assignment** —
this matches the ticket's constraint and the existing import/assign decoupling. The per-track
"Load" input stays single-file and untouched; it is a different, intentionally single-asset
action.

Loading is **partial-success, not atomic**: each file is decoded independently, and one
failure must not prevent the rest of the batch from importing. This follows directly from
`importAsset` already being a complete, independent unit of work per file — making the batch
atomic would require new rollback logic with no existing precedent.

### 2. Identity / duplicate policy: unchanged

No new dedup-by-name logic. Two files with the same name (within one batch, or against an
already-imported asset) produce two distinct `Asset` entries, identical to today's single-file
behaviour. Inventing a duplicate policy now would be new product behaviour, not an
investigation finding — flagged as a deferral below.

### 3. Resource lifecycle: unchanged

Each file still goes through the existing `importAsset` (`arrayBuffer()` → `loadSample()` →
`assetDataRef.current.set(...)` → `ADD_ASSET`) with no new abstraction. Decoding `n` files
sequentially (not `Promise.all`) keeps the engine's per-call sample-id allocation and the
single shared `assetDataRef` mutation easy to reason about — the same ordering `handleLoadProject`
already relies on.

### 4. Feedback: minimal per-batch summary, reusing the resample pattern

Because `importAsset` has no error handling today, a multi-file action needs just enough to
avoid a silent partial failure: catch each file's rejection, keep importing the rest, and
report an end-of-batch result (e.g. "Imported 7/8 — `kick2.wav` failed: unsupported format").
This reuses the `resamplePhase`/`resampleError` shape (`App.tsx:317-350`) rather than inventing
a new status mechanism.

## Edge-case table

| Case | Recommended behaviour |
| --- | --- |
| Cancel the OS file picker | No-op — `e.target.files` is empty/undefined, same as today's `files?.[0]` check generalised to `Array.from(e.target.files ?? [])` |
| One file fails to decode (bad data, unsupported format) | Skipped with an error captured in the batch result; the rest of the batch still imports |
| Same filename twice in one batch, or vs. an already-imported asset | Each becomes its own `Asset` with its own id — no dedup, same as current single-file behaviour |
| Batch pushes total decoded bytes over the soft memory cap | Existing `AssetsPanel` warning fires after the assets are added, unchanged |
| Cancellation mid-batch (closing the tab, navigating away) | Out of scope — no existing cancellation primitive for in-flight `loadSample()` calls; not introduced here |
| Mobile multi-select picker | Expected to work (`multiple` is broadly supported); verify manually once implemented |

## Smallest implementation using existing operations

1. `AssetsPanel.tsx` (~line 62-72): add `multiple` to the `<input type="file">`; change
   `onChange` to build `Array.from(e.target.files ?? [])` and call a new batch handler with
   the file list instead of a single `File`.
2. `App.tsx`: add a thin wrapper, e.g. `importAssets(files: File[])`, that sequentially
   `await`s the existing `importAsset(file)` (`App.tsx:249-269`, unchanged) per file, catching
   per-file rejections and collecting a summary.
3. No reducer or model changes: `ADD_ASSET` is still dispatched once per successfully decoded
   file, reusing `addAsset` (`model/project.ts:162-166`) as-is. No new `ADD_ASSETS` plural
   action is needed — nothing else in the reducer models batched inserts either, so this stays
   consistent with the rest of the codebase.

## Deferrals

- Duplicate-name detection/auto-rename policy (pre-existing gap, not introduced here).
- Drag-and-drop file import (no existing precedent anywhere in the codebase).
- Cancelling an in-flight batch import.
- Parallel decoding (`Promise.all`) — sequential is recommended for engine id-allocation
  simplicity; revisit only if import latency becomes a real problem.
- Per-file progress UI beyond an end-of-batch summary.

## Decisions

Pending — recorded here once made, before the follow-up implementation issue is picked up:

1. Asset-Bin-only import, no auto-assignment — proposed above.
2. Partial-success loading with an end-of-batch summary — proposed above.
3. No new duplicate/identity policy — proposed above.
4. Sequential (not parallel) decode — proposed above.
