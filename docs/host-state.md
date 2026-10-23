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
