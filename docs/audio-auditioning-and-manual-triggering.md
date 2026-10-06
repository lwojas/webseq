# Audio auditioning and shared manual triggering

Investigation for ECS-83 (parent ECS-81). Recommends one playback path shared by asset
auditioning and manual track triggering, defines the interaction contracts, and lists the
risks, edge cases, deferrals, and decisions still needed before any implementation issue is
scoped. No behaviour is implemented here.

## Current state

| Concern | Where it lives today | Notes |
| --- | --- | --- |
| Asset bin | `src/components/AssetsPanel.tsx`, `Asset` in `src/model/types.ts` | Flat list. Each chip has a rename input, an "Assign" button, and a remove button. No playback. |
| Asset to engine | `AssetId = SampleId` (`types.ts`) | An asset id *is* the webdsp sample id. Import and project load both call `runtime.loadSample()` (`App.tsx` ~227, ~432). Samples are decoded once and live in the engine's store. |
| Track to engine | `Track.assetId` → `compileNote` sets `sampleId` directly (`src/audio/compile.ts`) | No track-side playback exists. Nothing in `src/` calls `runtime.trigger()`. |
| Track row | `src/components/TrackRow.tsx` | Header click selects the track. The "Load" button stops propagation. Cells add notes. No trigger affordance. |
| Scheduled playback | `src/audio/transport.ts` | Lookahead scheduler. Calls `runtime.schedule()`. Tracks `activeVoices`, and per-track `monoLastVoice` for mono choke. `haltAudio()` calls `runtime.cancelScheduled()` and releases `activeVoices`. |
| Per-track bus | `src/audio/buses.ts` | One webdsp bus per track, created once per runtime. `createBus()` is a one-way counter capped at 32 with no release. |
| Track level | `src/audio/mixer.ts`, `effectiveTrackGain` | Volume, mute, and solo collapse into one `BusGain` on the track bus. |
| Keyboard | `App.tsx` window `keydown` | Only Backspace/Delete, which removes the selected note. No other shortcuts. |
| MIDI | `src/midi/sequencerContract.ts` | Step, mute, and fader controls. No trigger control yet. |
| Resample | `Transport.armResample()` → `runtime.armCapture()` | Captures the **master bus** over an exact `[start, stop)` window. |

Two existing comments already anticipate this work. `transport.ts` (mono `monoLastVoice`) and
`compile.ts` (`compilePatternIterationTracked`) both say a "future ECS-83 manual trigger"
must respect mono choke. That constraint is the main reason for a shared path.

### webdsp facts that constrain the design

From `webdsp/lib/index.d.ts` and `webdsp/ARCHITECTURE.md`:

- `trigger(params)` returns a `VoiceHandle` synchronously. With no `time`, it starts at the
  next render quantum (about 3 ms at 44.1 kHz). Sample data is never re-copied per trigger, so
  **buffer reuse is free**: an audition and a sequencer note reference the same decoded sample.
- `release(voice)` applies a short linear fade. `stop(voice)` is the same as far as the
  documentation shows. Both are no-ops on finished handles. Release has no scheduled-time
  parameter.
- `duration` auto-releases a voice on the audio thread. An open-ended `loop: true` voice with
  no duration runs until `release()`.
- `onVoiceEnded(fn)` fires from the engine when a voice finishes. Use it to clear an
  "auditioning" indicator without polling.
- The voice pool is `maxVoices` (a runtime policy; the architecture doc gives 64 as the
  default). When full, triggering steals the lowest-amplitude active voice. Loop voices hold
  a slot until released.
- `armCapture()` records master bus output only. Anything routed to master during a capture
  window ends up in the resampled asset.

## Recommendation

### 1. One playback module, two channels

Add a small module, for example `src/audio/playback.ts`, that owns all *manual* voices and is
the only code that calls `runtime.trigger()`. It exposes:

```ts
trigger(req: { assetId; channel: "audition" | "track"; trackId?; loop?; gain? }): void
stop(channel?): void          // release the audition slot, or all manual voices
onActiveChange(fn): () => void // driven by runtime.onVoiceEnded, for UI indicators
```

It also takes over the per-track mono map that currently lives in `Transport`. Transport
keeps `schedule()` and its own bookkeeping, but both scheduled and manual voices register
with the same per-track "last voice" table. This is the one shared abstraction that matters:
a manual retrigger on a mono track must choke the sequencer's voice, and the reverse.

Nothing else is shared. Auditioning and track triggering differ in routing and
concurrency (see section 2), and forcing them through one code path would add branches
rather than remove them.

### 2. Where the two channels differ

| | Asset audition | Track manual trigger |
| --- | --- | --- |
| Input | `Asset` (any asset, assigned or not) | `Track` (its `assetId`) |
| Bus | `MASTER_BUS` (no track FX) | the track's bus, so the track's FX chain applies |
| Level | fixed preview gain, independent of mixer | `BusGain` from `effectiveTrackGain`: volume, mute, and solo apply |
| Concurrency | **one** audition at a time. A new one releases the previous | per-track `voiceMode`: poly stacks, mono chokes |
| Loop | never loops (plays the sample once) | follows `track.playbackMode` |
| Persistence | none | none (`voiceMode` and `playbackMode` are already persisted on the track) |

Routing the audition straight to master means the track's FX, volume, and mute do not
colour it. That is the point of "auditioning before use": the user hears the asset as
imported.

### 3. Interaction contracts (proposed)

These are recommendations, not decided behaviour. Items marked **decision** need an answer
from the user before implementation (see "Open decisions").

**Asset audition**

- Activated by a play button on the asset chip. Tapping it starts the audition and changes
  it to a stop icon. Tapping it again stops. Tapping another chip's button releases the
  current audition and starts the new one.
- At most one audition at a time. Its chip shows the active state, driven by
  `onVoiceEnded`, so it clears when the sample ends naturally.
- Plays once, unlooped, to its natural end. No duration cap.
- Stops when the asset is removed, the project is replaced (New or Load), or the
  transport stops (**decision**, see below).
- Keyboard: the button is focusable. Enter or Space on the focused button toggles it.
  No global shortcut in the first slice.
- Does not touch the transport, the playhead, or the sequencer.

**Track manual trigger**

- Activated from a button on the track header that only appears on the **selected**
  track. This keeps it off the persistent surface, which is what the parent issue asks for.
  The header's click-to-select stays as it is.
- One-shot track: each press starts a voice. Poly tracks stack. Mono tracks choke the
  previous voice.
- Loop track: **recommended** toggle (press to start, press to stop), not hold-to-play.
  Hold-to-play needs `pointerup`, `pointercancel`, blur, and unmount handling, and a missed
  release leaves an unbounded voice holding a slot. Toggle has none of those failure modes
  and works the same on touch.
- Muted or soloed-out tracks are silent, the same as in the sequencer, because the trigger
  goes through the track bus.
- Keyboard: Enter on the focused trigger button. No global key in the first slice.
- The track's own note cells and the Load button must `stopPropagation` as they do today,
  so the trigger never selects or edits by accident.

**Interaction with transport**

- Manual voices are immediate, not scheduled. `runtime.cancelScheduled()` in `haltAudio()`
  does **not** touch them, so Transport must release manual voices explicitly. Without that,
  a manual loop survives Stop.
- Transport play does not stop an audition or a manual loop. Playback does not change what
  the user is auditioning.
- Recommended: **Stop silences everything** (scheduled, manual loops, auditions). Stop is
  the universal "silence" control, so it should not leave residual sound behind.
  **Decision.**

### 4. Risks and edge cases

- **Resample capture contamination.** `armCapture` records master output. An audition or
  manual trigger during an armed or capturing resample would be baked into the new asset.
  Recommended: refuse manual triggers and auditions while `getResampleStatus() !== "idle"`,
  with a short inline message. Alternative: accept it and document it. Avoid making
  capture exclusive to a bus, since track buses sum into master anyway.
- **Mono choke across paths.** Mono must be shared state, not a Transport detail. Otherwise
  a manual trigger on a mono track overlaps a scheduled one (or the reverse) silently. The
  shared per-track last-voice map covers both directions. Known imprecision remains: the
  scheduled path can release a voice up to the lookahead window (~150 ms) early, which the
  existing code already documents and accepts.
- **Stale loop voices.** A track's loop voice keeps playing the old sample if the track is
  reassigned (`ASSIGN_ASSET`) or its asset removed (`REMOVE_ASSET`) while it runs.
  Recommended: release that track's manual voice in both cases.
- **Project replace.** Load and New remap sample ids (`remapAssetIds` in
  `src/model/project.ts`, called from `App.tsx`). Any
  audition or manual handle referring to the old ids must be released before the swap.
  `transportRef.current?.stop()` already runs at that point, so this is one extra call.
- **Voice pool pressure.** A loop voice holds a slot until released. Under pool pressure
  webdsp steals the quietest voice, which can cut a sequencer note. Mitigation: only one
  manual loop per track, and a documented cap on concurrent manual voices (for example two).
- **Latency.** Without `time`, a trigger starts at the next render quantum, which is fine for
  touch and clicks. MIDI and keyboard add event-loop jitter on top; that is acceptable for
  manual use and is the same trade-off the existing `Transport` already documents.
- **Suspended context.** If the AudioContext is suspended (tab backgrounded, first gesture
  not yet made), `trigger` does nothing audible. The first audition or trigger must go
  through `useAudioRuntime.init()` on a user gesture, as Play does now.
- **Audition loudness.** Imported samples vary in level, so a fixed preview gain can still be
  loud or quiet. Option: normalise the audition to a target peak computed on import. That is
  deferred (see below), and the first slice uses a fixed gain.
- **Mobile hit targets.** Chip and header buttons need roughly 44 px touch targets. The
  current `.btn small` styling is smaller. This belongs to the UI audit once implemented.
- **No new buses needed.** Auditions go to master and track triggers use the existing track
  buses. `createBus()` is not called, so the 32-bus cap is not affected.

### 5. Memory and performance

- Triggering references the decoded sample already in the engine. Auditioning a 10-minute
  file costs no extra copy, the same as a sequencer note.
- The app keeps the original `ArrayBuffer` per asset in `assetDataRef` for persistence. That
  is a second copy in JS heap memory, already present today, and out of scope here.
- Manual triggers are event-driven, not per-tick. They add no work to the 25 ms transport
  tick, and the transport's render cost is unchanged.
- The active-audition indicator must update only the affected chip, not re-render the asset
  list. Use the same subscription pattern as the existing playhead (`useRafText`-style,
  not React state per voice) if it is updated often. A single `onVoiceEnded` callback that
  sets one `activeAssetId` is enough.

## Deferrals

- Preview level control (a slider). The first slice uses one fixed value.
- Loudness normalisation of auditions.
- Waveform or position scrubbing during audition.
- Pitch or rate control of auditions (webdsp `rate` and `pitch` exist, but no use case yet).
- Multiple simultaneous auditions.
- MIDI pad triggering through `sequencerContract.ts`. The shared API is designed to take it,
  but no control is defined yet.
- Recording a manual performance into a pattern (a live-to-notes feature).
- Velocity or per-trigger gain for manual triggers.

## Open decisions

1. **Stop semantics.** Recommended: Stop silences auditions and manual loops as well as the
   sequencer. Alternative: Stop only affects the sequencer.
2. **Loop trigger.** Recommended: toggle. Alternative: hold-to-play.
3. **Track trigger placement.** Recommended: a button on the selected track's header.
   Alternatives: a keyboard key while a track is selected, or a long-press on the track name
   (rejected for now, as it conflicts with selecting a track on mobile).
4. **Audition button placement.** Recommended: a small play icon on each asset chip.
   Alternative: tap the chip's name, which conflicts with rename, so not recommended.
5. **Resample during manual playback.** Recommended: block manual triggers and auditions
   while a resample is armed or capturing. Alternative: allow them and accept capture contamination.
6. **Muted tracks.** Recommended: manual trigger is silent, as in the sequencer. Alternative:
   manual trigger bypasses mute, which would make a muted track easier to audition but
   inconsistent with playback.

## Proposed follow-up issues

Not created yet. Creating them now would be speculative, and decisions 1-6 change their scope.
Once those are answered, the work splits cleanly into:

1. Playback module: shared mono map and manual-voice ownership, moving the Transport
   per-track mono logic into it. No UI change. Covered by Transport tests.
2. Asset audition: chip button, single-slot audition, `onVoiceEnded` indicator, project-replace
   and removal cleanup.
3. Track manual trigger: selected-track header button, one-shot and loop toggle, mute
   routing, reassignment cleanup.
4. Resample guard: refuse manual playback while a resample is armed or capturing.
