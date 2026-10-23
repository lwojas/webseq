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
