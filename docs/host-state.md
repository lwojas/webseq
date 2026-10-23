# The project in a host's session

When a host with its own sessions is present (`getHostState()` from webdsp, e.g. a DAW plugin), the project is saved
there instead of in the page's storage. In a browser `getHostState()` is null and nothing here runs. Contract: webdsp's
`docs/host-state.md`.

- `persistence/hostState.ts`: `toHostSnapshot` / `publishRecord` / `fromHostSnapshot`. The snapshot is the same
  `RecoveryRecord` the local recovery write already builds (project + view state) as JSON, with the bytes of exactly the
  assets the project uses as blobs keyed by asset id. Stamped `app: "webseq"`, `format: 1`.
- **Publishing** rides the existing debounced recovery writer (`createRecoveryScheduler`): when a host is present its
  `write` publishes instead of writing IndexedDB. Only edits publish (the pristine initial project never does), so a
  fresh page cannot overwrite a saved session before the restore arrives.
- **Restoring**: `hostState.onRestore` hands back the session's snapshot; App installs it through the same path as a
  recovery restore (`restoreRecord` -> `installProject`, then the view state), silently. Another app's snapshot, an
  unknown format or malformed data is ignored (start fresh). The same snapshot is installed once even if the effect
  re-subscribes.
- **When hosted, no local recovery slot** (it would be shared by every plugin instance) and no restore prompt. Saving to
  the browser's own project list (Save) leaves the host session tracking the project. New project clears the host's state.

## Publishing rules (what reaches the session, and when)

- **Quickly.** A plugin window can be closed at any moment and the page, with any pending write, goes with it, so a host
  publish is debounced by 300 ms (`HOST_PUBLISH_DEBOUNCE_MS`), not the 1.5 s the local recovery write uses.
- **Everything, not only edits.** Locally a project that is exactly as last loaded is not snapshotted (nothing unsaved). The
  session is different: it has not seen a project that was merely loaded, imported or started fresh, so those are published
  too (`shouldWriteProject`). Only the untouched initial project is held back, and only until the host has answered: a publish
  before the restore arrives could overwrite the saved session.
- `useAudioRuntime`'s `init()` is single-flight: a caller that arrives while the runtime is starting waits for it (it used to
  get `null` back and give up).

## Which saved project is open

The session keeps the project, which carries its id, but the saved-projects list's selection is separate UI state. When the open
project is one of the saved ones (same id, e.g. a plugin window reopened onto its session), the list now shows which
(`preselectSavedProject`). It is considered once per open project and only after the list has loaded, never overrides a selection
already made, and does nothing when no saved project matches. It only moves the dropdown: recovery, restore, Load and Delete are
unchanged (Load still loads the saved copy; the restored project keeps its unsaved edits).

**Known issue: Load discards unsaved edits.** *Load* replaces the open project with the saved copy, and the restored project can carry edits
that were never saved (that is the point of restoring it). With the saved project now preselected, *Load* is one click away from throwing those
edits away, with no warning. This is the same as before (you could always select the project and press Load), but it is more
reachable now. Possible fixes, not done: ask before loading over a project that differs from its saved copy (needs the saved copy's
state kept to compare against, or an "unsaved changes" marker), or leave *Load* disabled while the selected project is the one that is open
and unchanged.
