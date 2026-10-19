# Modulation: automation and LFOs

One model for every parameter. A parameter belongs to an **FX instance** or to a **track's source**
(a synth's controls, or a sample's envelope and pitch). It can have any number of modulation
**sources**: at most one automation lane, plus a stack of LFOs.

```text
Parameter (FX param | synth control | sample param)
  ├── Automation   a curve over the sequence            -> the parameter's BASE value
  └── LFO, LFO ... webdsp's engine LFO bank (4 per owner) -> added on top of the base, in the DSP
```

The engine owns the combining (webdsp `docs/modulation.md`): the app keeps writing the base, the
bank adds the LFOs and clamps. Existing behaviour is unchanged: instrument LFOs, the Track LFO
(`track-lfo.md`, a velocity LFO evaluated in the sequencer) and FX automation all work as before.

## Model

| Where | What |
|---|---|
| `FxInstance.lfos?` / `TrackInstrument.lfos?` | LFO stack (`TrackLfo[]`), same shape and same operations for both (`model/lfoStack.ts`). Targets are control ids the engine reports as modulatable. |
| `AutomationLane { fxId?, parameter, events }` on `Track.automation` / `MasterBus.automation` | `fxId` set: an FX parameter. Absent: the track's source parameter. Points are beats from the pattern start, linear between points, hold the last value. Positions snap to quarter beats. |
| `model/modulation.ts` | `ModParamDef`: one description (range, step, unit, `scale` linear/log, options) of any parameter, from `fxParamDefs(fx)` / `sourceParamDefs(track)`. The UI and the templates render from it, never from per-owner code. |

Sample parameters: `attack/decay/sustain/release` (the asset's amplitude ADSR, a `SampleParam`; tracks
sharing an asset share it) and `pitch` (semitones per hit, added to the note's own pitch when the note
is scheduled, from the lane value at the note's position; chromatic mode only). Samples have no engine LFO
bank, so they take automation only. Changing a track's source drops source lanes the new source lacks.

## Playback (`audio/automation.ts`)

Polled with the transport tick (~25 ms), against the beat within the sounding chain step. Each lane
value is written through the owner's writer, which dedupes against the engine:

* FX → `FxChainSync.setParam` (`setEffectParameter`); bypassed FX are skipped.
* synth → `InstrumentHost.setParam` (`setInstrumentParameter`; the engine treats it as the base while an LFO targets it).
* sample envelope → `setSampleParameter`; sample pitch → read in `compileNote`.

`sync()` tracks the last project value separately from the last written value, so a project edit
during playback never knocks an automated value back. Stopping restores every automated parameter
to its project value (`restoreAutomation`). LFOs are pushed by `audio/lfoSync.ts` (shared by
instruments and FX): names resolved against the engine's tables, unchanged slots not resent.

## Utility FX

`FxType "utility"` (webdsp `EffectKind.Utility`): one parameter, `gain` in dB (-60 = silence .. +12,
0 = unity). It is the mechanism for per-track volume automation: add it to a track's chain (put it first
for "Track → Utility → other FX") and automate `gain`. The mixer fader stays the track's plain mix state
and is never automated.

## UI

* **Modulation card** (`ModulationSlot`): the synth editor's pattern, now the same in the Instrument
  panel (synth and sample) and the FX panel. Header `+ Automation` / `+ LFO`; a list of sources, each
  naming its target parameter (several may share one). Parameter names carry a badge: **A** automated,
  **L**/**Ln** n LFOs. Clicking a parameter's name automates it.
* **Automation card**: Target, Shape (template menu), range (All / Bar 1 / Last bar, shown only for
  sequences longer than one bar), Clear (curve back to flat at the current value), Edit, Remove, and
  the **lane length in bars**.
* **Lane = a timeline row** (`AutomationRow` in `SequencerGrid`): directly under the selected track
  (or MASTER), inside the grid's own scroll area at the same `pxPerBeat`, so it is exactly as wide as
  the sequence, scrolls and zooms with it, shares the playhead, and shows bar numbers. Hz / seconds
  parameters are drawn on a log axis. When the timeline is not on screen (phone Track tab, Patterns
  page) the card draws the lane inline instead.

## Templates (`model/automationTemplates.ts`)

Pure shapes in normalized coordinates (t 0..1 across a region, v 0..1 across the parameter's range),
so they apply to any sequence length and any parameter, deterministically. `applyTemplate` maps them to
beats and values (log-aware, subdividing on log scales; fades and swells top out at unity for dB
gains; jumps are separated by one grid step) and the result replaces only the region's points
(`REPLACE_AUTOMATION_RANGE`). Initial set: Ramp up/down, Fade in/out, Swell, Filter wobble, Up/down,
Sine, Pulse, Saw up/down. A new template is one entry in `AUTOMATION_TEMPLATES`. Cyclic shapes scale
their cycle count with the region's bars.

## Contract with webdsp

Needs webdsp with `EffectKind.Utility`, `NodeParam.UtilityGain`, `getEffectModulationTargets`,
`setEffectLfo` / `clearEffectLfo` and `RuntimeCapabilities.effects`. No webseq concept exists in
webdsp; webtracker can adopt the same pieces (`audio/lfoSync.ts`, the base-write + engine-LFO split).

## Known limits

Automation is polled (not sample-accurate); an LFO shape is not shared with the Track LFO (velocity is
event-time); sample tracks have no LFOs; sample envelope automation is per asset; Delay time cannot
take an LFO.
