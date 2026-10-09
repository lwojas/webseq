# Pattern launcher MIDI controls

Reference for everything the Patterns view (ECS-133: `PatternList`/`PatternQueue`) and its
underlying pattern queue (ECS-117) expose through webseq's own MIDI control registry —
`createSequencerRegistry()` in `src/midi/sequencerContract.ts`. Implemented across ECS-117,
ECS-131, and ECS-148.

## Domain boundary

webseq's job stops at exposing correct, addressable controls/actions through its own
open-ended, resolve-by-id registry. **Binding a specific physical pad, encoder, or display line
on a specific device to one of the ids below is `midi-core`'s job** — its own
`SequencerContract`/binding-table/device-profile layer, in the separate `midi-core` repo — not
webseq's. Nothing documented here is bound to any physical control by this app; every id is
simply resolvable and correct, ready for a device profile's binding table to target.

Every control is resolved on demand (never precomputed as a fixed list) and cached once
resolved; a device profile targets any of these ids the same way it already targets
`step.<row>.<column>` or `mute.<track>`.

## Per-pattern controls — `pattern.<n>.*`

`<n>` is 0-based, indexing into `project.patterns`. A control resolves to `undefined` for any
`<n> >= patterns.count` (see below) — mirrored in `test/sequencerContract.test.ts`'s "no
control/action resolves past the pattern/queue count".

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `pattern.<n>.playing` | boolean | read-only | Whether pattern `n` is the one actually sounding right now. False while stopped/paused, even if the transport is resting on that pattern — a resting position must never look like a live one. |
| `pattern.<n>.queued` | boolean | **read/write** | Whether pattern `n` is in the queue (`project.patternChain`) *other than* as the single currently-playing entry. `setValue(true)` calls `queuePatternNext` — inserts it right after whichever entry is playing. `setValue(false)` calls `removePatternFromQueue` — removes **every** entry for that pattern (refused, a no-op, if that would empty the queue). Coarse/per-pattern; see `queue.<slot>.remove` below for removing one specific entry when a pattern occupies more than one slot. |
| `pattern.<n>.selected` | boolean | **read/write** | Whether pattern `n` is selected for editing (`App.tsx`'s `selectedPatternId` — what the Sequencer view's grid shows, independent of playing/queued). `setValue(true)` selects it. `setValue(false)` is a no-op: there's always exactly one selected pattern, same as there's no "deselect" affordance anywhere in the UI. |
| `pattern.<n>.name` | string | read-only | The pattern's display name. See "Display feedback" below. |
| `pattern.<n>.bars` | number (min 1, max 64) | **read/write** | The pattern's bar count. `setValue` dispatches `SET_PATTERN_BARS`. |

## Per-pattern actions — `pattern.<n>.*`

Fire-and-forget commands (midi-core's `Action`, not `Control` — invoke-only, nothing to read
back), resolved via `registry.getAction(id)`, not `getControl(id)`.

| id | Effect |
| --- | --- |
| `pattern.<n>.duplicate` | Dispatches `DUPLICATE_PATTERN` for pattern `n`. |
| `pattern.<n>.delete` | Dispatches `REMOVE_PATTERN` for pattern `n`. Resolves to `undefined` if `n` is out of range; invoking it when it's the project's **last remaining pattern** is a safe no-op (the model's own guard — a project always needs at least one pattern), same as `PatternList`'s Delete button sits disabled in that state. |

## Global pattern controls

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `patterns.count` | number | read-only | `project.patterns.length` — bounds a caller's own pattern-pad iteration, same role `tracks.count` plays for the step grid. |

| id | Effect |
| --- | --- |
| `patterns.create` | Dispatches `ADD_PATTERN`. Always available (no bounds check — there's no upper limit on pattern count). |

## Per-queue-slot controls — `queue.<slot>.*`

`<slot>` is 0-based, indexing into `project.patternChain` **in play order** — separate from
`pattern.<n>` because a pattern can occupy more than one slot (a queue like `[A, A, B]` has
three slots, two of them pattern A). A control resolves to `undefined` for any
`<slot> >= queue.length`.

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `queue.<slot>.pattern` | string | read-only | The display name of whichever pattern occupies that queue position. |
| `queue.<slot>.playing` | boolean | read-only | Whether *that exact slot* — not just that pattern — is the entry currently sounding (`Transport.getCurrentChainEntryId()`). Entry-level, so two slots holding the same pattern are told apart correctly; `pattern.<n>.playing` can't do that on its own. |

| id | Effect |
| --- | --- |
| `queue.<slot>.remove` | Removes exactly the entry at that position (dispatches `REMOVE_CHAIN_ENTRY`, resolved by the entry's own id at invoke time — not by pattern). Resolves to `undefined` if `<slot>` is out of range; invoking it when it's the **queue's only remaining entry** is a safe no-op (the queue is never allowed to go empty), same as `PatternQueue`'s Remove button sits disabled in that state. |

## Global queue controls

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `queue.length` | number | read-only | `project.patternChain.length` — bounds a caller's own queue-slot iteration, same role `patterns.count` plays for the pattern library. The queue is **never zero**: every mutator (`queuePatternNext`, `removePatternFromQueue`, `removeChainEntry`, `removePattern`) guarantees at least one entry. |

## Feedback: when a control's value actually changes

Every control above also changes via plain project edits from the UI (clicking a `PatternList`/
`PatternQueue` button, editing a name/bars field) — those are covered automatically by
`registry.syncFromProject(project)`, called whenever the project changes, same as every other
control in this registry.

One value moves on the **transport's own clock**, not just on a dispatch: which pattern/queue
entry is actually sounding, as the queue advances on its own with nobody clicking anything.
`pattern.<n>.playing`, `pattern.<n>.queued`, and `queue.<slot>.playing` are re-synced by
`registry.pollPatternLaunch()`, meant to be called from an animation-frame loop while connected
(the same clock the on-screen playhead already polls) — see `useMidiControls.ts`. Every other
control in this doc only ever changes via dispatch, so `syncFromProject()` alone already covers
it; no polling needed.

## Display feedback (`pattern.<n>.name`)

`pattern.<n>.name` is the first real consumer of `StringControlDef` anywhere in webseq, and is
the correct shape for feeding a device's text display generically: `midi-core` already models a
device's LCD (`DeviceDisplayDefinition`, e.g. Push mk1's real 4-line/68-char
`PUSH_MK1_DISPLAY`) and the binding that feeds it (`DisplayBinding`, in
`midi-core/src/surface/types/bindings.ts`), which pairs one of a profile's declared display
lines with a `ControlIdResolution` — a static id or a templated one, the same resolution
mechanism `ControlBinding` already uses for pads — that only ever drives a `StringControlDef` by
id. Binding `pattern.<n>.name` (or, for an ordered readout, `queue.<slot>.pattern`) to an actual
display line is `midi-core`/device-profile work, not webseq's, per the domain boundary above —
this doc only guarantees the control exists and is correct.

## Worked example (illustrative only — not implemented here)

A hypothetical Launchpad-class binding using the two generic, currently-unbound button arrays
`midi-core`'s Launchpad Mini MK3 profile already declares
(`LAUNCHPAD_MINI_MK3_SIDE_COLUMN`/`_TOP_ROW`, 8 buttons each) could pair naturally with this
view's own two-column shape: side column → `pattern.<index>.selected`/`.queued` (the pattern
library), top row → `queue.<index>.playing`/`.remove` (the queue, in order) — mirroring
`PatternList`/`PatternQueue` directly. This is a sketch of how the two sides of the contract
line up, not a decision about any specific device profile; that remains `midi-core`'s to design.
