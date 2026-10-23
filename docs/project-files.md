# Project files (Export / Import)

A project can be written to a file and opened again: how it moves between a browser and a plugin, and how it is kept.
The browser's own *Save / Load* (IndexedDB) is separate and unchanged.

- `persistence/projectFile.ts` is the format (pure, tested): `{ kind: "webseq-project", formatVersion, savedAt, project,
  assets }`. `assets` holds the original bytes of exactly the assets the project uses, base64, keyed by asset id, so a
  file is self-contained. Loading re-registers each asset with the engine and remaps ids (`installProject`), as Load does.
- **Versioning.** `formatVersion` (now 1) is the envelope's version; a file from a newer webseq is refused with a message
  saying so. New `Project` fields are additive and read through defaults, so they need no bump; bump it only when an older
  build could no longer read a file. A missing or unreadable asset skips that asset only. A file that is not ours, not JSON, or
  has an incomplete project is refused with a message fit to show (the *File failed* chip, full text on hover).
- `persistence/projectIO.ts` is the glue: in a browser a download link and a file input; where the host has its own file
  dialogs (`getHostFiles()` from webdsp, e.g. a plugin: its WebView has no file input and ignores downloads) those.
- **Import** is treated as new, unsaved work: it is not marked clean, so recovery (or the host's session) keeps it.
- File name: the project name made safe + `.webseq.json`.
