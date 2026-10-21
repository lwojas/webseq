# Session recovery (project resume)

Ported from webtracker's local recovery cache (`webtracker/src/persistence/recovery.js`,
`localAssetStore.js`, `appContext.js`, documented in webtracker's `docs/RESAMPLE.md`). Unsaved work
survives a reload; the user is offered **Restore** or **Discard** at startup. It complements
Save/Load (the `projects` store) and never replaces it.

## Behaviour
- **Trigger:** any edit to the project (or the selected pattern/track/bank/grid) schedules a 1.5s
  debounced write of one record into a single fixed slot (`recovery` store, key `latest`).
  The pristine initial project, a just-New'd project and a just-Loaded project are never
  snapshotted until edited (`cleanBaselineRef` in `App.tsx`).
- **Record:** `{ projectId, projectName, savedAt, project, ui }`. `ui` = selected pattern, selected
  track/master, active bank, grid resolution. Runtime state (transport, auditions, clipboards,
  selected note) is intentionally not restored.
- **Assets:** bytes live in the existing `assets` store under the reserved key prefix `__recovery__:`
  (written once per asset, stale ones pruned), so a real project's Save/Load/Delete can't touch them.
- **Startup:** `getRecovery()` reads the slot. Missing → normal start. Malformed/incompatible
  (`parseRecoveryRecord`) → cleared and normal start. Writes stay off until the check resolves and the
  prompt is answered, so an edit can't overwrite the record being offered.
- **Restore:** reinstalls the project through the same path as Load (`installProject`), then
  re-applies the validated `ui`. The record is kept: the session is still unsaved, so (as in
  webtracker) it prompts again after another reload until saved or discarded.
- **Discard:** clears the slot. **Save:** clears the slot. **New/Load:** cancel the pending write only.

## Reused vs. different
- Reused as-is: single slot, debounce, injected-writer scheduler split (pure `recovery.ts` /
  IndexedDB glue `recoveryStore.ts`), cancel-before-replace ordering, clear on Save/Discard, banner UX
  (amber-bordered, Restore/Discard), `timeAgo`.
- Different: no serializer (a webseq `Project` is already plain JSON); asset bytes reuse the `assets`
  store instead of a new `localAssets` store; DB bumped v2→v3 for the `recovery` store; record
  validation added (webtracker trusts the stored record); restore also re-applies webseq view state.
