# FX MIDI controls

Reference for everything the FX panel (`FxPanel`/`FxChainStrip`/`ModulePanel`) and its
underlying per-target FX chain (`model/fx.ts`'s `FX_DEFS`, `model/types.ts`'s `FxInstance`)
expose through webseq's own MIDI control registry — `createSequencerRegistry()` in
`src/midi/sequencerContract.ts`. Implemented in ECS-149.

## Domain boundary

webseq's job stops at exposing correct, addressable controls/actions through its own
open-ended, resolve-by-id registry. **Binding a specific physical pad, encoder, or display line
on a specific device to one of the ids below is `midi-core`'s job** — its own
`SequencerContract`/binding-table/device-profile layer, in the separate `midi-core` repo — not
webseq's. Nothing documented here is bound to any physical control by this app; every id is
simply resolvable and correct, ready for a device profile's binding table to target.

This required **no changes to `midi-core` or `webdsp`**: `midi-core`'s existing Control API
(`NumericControlDef`/`BooleanControlDef`/`StringControlDef`, `ControlRegistry`, `Action`) was
already generic enough. The FX panel itself is entirely webseq's own application model —
`webdsp` (the audio engine dependency) has no FX/panel concept at all.

Every control is resolved on demand (never precomputed as a fixed list) and cached once
resolved; a device profile targets any of these ids the same way it already targets
`step.<row>.<column>` or `pattern.<n>.selected`.

## Scope: one target's chain at a time

Every `fx.*` id below resolves against **the currently selected FX target** —
`App.tsx`'s `selectedTarget` (a track or `"master"`), the same track-or-master scoping the FX
panel itself already shows one of at a time (`FxTarget` in `model/types.ts`). There is no
cross-target addressing (e.g. no "track 3's filter" id): switching which track/master is
selected in the UI changes what every `fx.*` id means, the same way selecting a different
pattern changes what `step.<row>.<column>` means.

## Two ways to address an FX: by position, or by selection

- **`fx.<n>.*`** — position `<n>` (0-based) within the current target's chain, in chain order.
  Resolves to `undefined` for any `<n> >= fx.count`. The pad-grid-style shape: a device with
  enough pads/buttons can bind one per position, mirroring `pattern.<n>.*`.
- **`fx.selected.*`** — always resolves to whichever FX is currently selected for editing
  (`App.tsx`'s `selectedFxId`), independent of its position. The fixed-control-bank shape: a
  device with a small number of encoders/buttons (e.g. Push mk1) can bind them once, directly to
  "the selected FX's parameters," without ever resolving an index itself — the same reason
  `transport.playhead`/`transport.isPlaying` exist as fixed ids alongside
  `step.<row>.<column>`'s grid addressing.

Both namespaces read/write the exact same underlying `FxInstance` — there is no separate state,
just two addressing schemes into it.

## Per-FX controls — `fx.<n>.*` / `fx.selected.*`

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `fx.<n>.enabled` / `fx.selected.enabled` | boolean | **read/write** | The FX's `On` (bypass) control. `setValue` dispatches `SET_FX_ENABLED`. |
| `fx.<n>.selected` | boolean | **read/write** | Whether chain position `n` is the FX selected for editing. `setValue(true)` selects it (calls `selectFx`). `setValue(false)` is a no-op — no "deselect" affordance anywhere in the UI either, same shape as `pattern.<n>.selected`. |
| `fx.<n>.name` / `fx.selected.name` | string | read-only | The FX type's display label (`FX_DEFS[type].label`, e.g. `"Filter"`, `"Delay"`). Also serves as the **stable, distinguishing identifier** for the instance: `model/fx.ts`'s own engine constraint (at most one FX of each type per chain) means type/label alone already tells FX of a chain apart — no separate id control was needed. |
| `fx.<n>.params.count` / `fx.selected.params.count` | number | read-only | How many parameters that FX's type defines (`FX_DEFS[type].params.length`) — bounds a caller's own per-FX parameter iteration, same role `tracks.count`/`patterns.count` play elsewhere. |
| `fx.<n>.param.<p>` / `fx.selected.param.<p>` | number | **read/write** | The value of parameter `p` — its 0-based position within `FX_DEFS[type].params`, a fixed, never-reordered array per type, so a position is always a stable reference to the same parameter for that type. `setValue` dispatches `SET_FX_PARAM`. |

`fx.<n>.param.<p>`'s `min`/`max`/`step`/`unit`/`label` are read straight from that FX type's own
`FxParamDef` (`model/fx.ts`'s `FX_DEFS`) — **not** a conventional linear 0–127 range. A filter's
`cutoff` is `40..18000` (Hz), a reverb's `decay` is `0..0.99`, a compressor's `attack` is
`0.0001..1` (seconds), and so on; a MIDI mapping layer scales its own CC range onto whatever this
control declares, the same way `mixer.volume.<index>` already does for the application's own
`0..1.5` linear gain.

**The filter's `mode` parameter is a number, not an enum**, even though it only takes two values
(0 = Low Pass, 1 = High Pass): `model/fx.ts` already models it as a stepped `0..1` number
mirroring webdsp's `FilterMode`, and `midi-core`'s `EnumControlDef` requires string option values
the engine doesn't use. This is a known, narrow gap: a connected display gets the control's own
label (`"Mode"`) but not a per-value name like `"Low Pass"`. Closing it would need a
numeric-backed enum variant in `midi-core`'s Control API, which nothing today requires — not
worked around here with a second, parallel control kind.

## Global FX controls

| id | kind | r/w | Meaning |
| --- | --- | --- | --- |
| `fx.count` | number | read-only | How many FX exist in the current target's chain — bounds a caller's own `fx.<n>` iteration, same role `tracks.count`/`patterns.count` play elsewhere. |
| `fx.selected.index` | number | read-only | The 0-based position of the selected FX within the current target's chain, or `-1` while nothing is selected. Lets a device identify the current selection without probing every `fx.<n>.selected` itself — the same role `bank.active` plays for the selected bank. Feedback-only: selection is always made through `fx.<n>.selected`/`fx.next`/`fx.previous` (or the UI), never by writing an index directly. |

## FX navigation actions

Fire-and-forget commands (midi-core's `Action`, not `Control`), resolved via
`registry.getAction(id)`, not `getControl(id)`.

| id | Effect |
| --- | --- |
| `fx.next` | Selects the next FX in the current target's chain. Clamps at the last FX (does not wrap), same "stop at the ends" choice bank paging (`bank.next`) already makes. Starting with nothing selected goes to the **first** FX, not a no-op. |
| `fx.previous` | Selects the previous FX. Clamps at the first FX. Starting with nothing selected goes to the **last** FX. |
| Both | Safe no-ops on an empty chain. Step over **every** FX present in the chain, regardless of its own enabled/bypassed state (see "Enabled vs. available for navigation" below). |

## Enabled vs. available for navigation

The ticket this implements explicitly asks not to assume "enabled" and "available for
navigation" are the same thing. Checked against the existing application behavior before
deciding: `FxChainStrip.tsx` renders a bypassed FX's chip with a `bypassed` CSS class, but its
`onClick`/selection handler is identical to an enabled FX's — a bypassed FX is just as
selectable in the UI as an enabled one, only its visual state differs.

So here, **"available for navigation" means "present in the chain,"** not "enabled." `fx.next`/
`fx.previous` and every `fx.<n>.*` control resolve for a bypassed FX exactly as they do for an
enabled one. "Enabled" is a wholly separate, read/write attribute (`fx.<n>.enabled`) of an FX
that is always available for navigation regardless of its value.

## Feedback: when a control's value actually changes

Every control above changes via plain project edits — the UI's Add/Remove FX buttons, the
`ModulePanel`'s On toggle and parameter sliders, an automation lane overriding a value during
playback — and all of those are covered automatically by `registry.syncFromProject(project)`,
called whenever the project changes, same as every other control in this registry. Nothing here
moves on the transport's own clock the way pattern/queue playback state does, so no polling
method was added for FX.

**Selecting a different target or FX is its own wrinkle**: `App.tsx`'s `selectedTarget`/
`selectedFxId` are React state, not part of `Project` — clicking a different FX's chip or
switching which track/master is selected doesn't by itself produce a project change for
`syncFromProject` to fire from. `useMidiControls.ts` has a dedicated effect keyed on
`[fxTarget, selectedFxId]` that re-syncs the registry directly on every such change — the same
reason an equivalent effect already exists there for `activeBank` switches.

## A correctness wrinkle unique to FX: stale parameter definitions

Every other control in this registry has a **fixed-shape** `def` (its `min`/`max`/`step`/`unit`)
regardless of which track/pattern/queue-slot ends up at a given index — a track's volume range
is always the same range no matter which track occupies a fader slot, for instance. `fx.<n>.
param.<p>`/`fx.selected.param.<p>` are the one place that isn't true: the *definition* itself is
specific to whichever FX's type currently occupies that position/selection, since a filter's
`cutoff` and a delay's `feedback` have entirely different ranges/units.

Two things can make the FX at a given position/selection change after a param control was
already resolved and cached: **reselecting** a different FX (`fx.selected.param.<p>` now means a
different FX entirely), and **removing** an earlier FX in the chain, which shifts a
different-typed FX down into a previously-resolved `fx.<n>.param.<p>`'s index. Left unhandled,
a cached control would keep reading/writing the *old* FX's parameter id under the *old* FX's
range — wrong value, wrong unit, wrong bounds.

`resolve()` tags every `fx.*.param` control with the id of the `FxInstance` its definition was
built from, and on every lookup re-checks that the FX currently at that position/selection still
has that same id; a mismatch evicts the cached control and rebuilds it fresh against whatever is
actually there now. Covered by two dedicated tests in `test/sequencerContract.test.ts`
("fx.selected.param.<p> re-resolves to the newly selected FX's own def/value..." and
"fx.<n>.param.<p> re-resolves correctly after an earlier FX's removal shifts...").

## Worked example (illustrative only — not implemented here)

A hypothetical binding on a device with 8 encoders and a handful of buttons could pair the
fixed `fx.selected.*` namespace with the encoder bank — encoder `i` → `fx.selected.param.<i>`,
reading `fx.selected.params.count` to know how many of its 8 encoders are actually live for the
selected FX's type — while two buttons bind `fx.next`/`fx.previous` to page the selection, and a
third binds `fx.selected.enabled` to toggle bypass. A pad-grid device could instead bind one pad
per `fx.<n>.selected` directly. This is a sketch of how the two sides of the contract line up,
not a decision about any specific device profile; that remains `midi-core`'s to design.
