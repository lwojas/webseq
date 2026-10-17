# Track LFO

A track-level LFO that modulates **event** properties, today the **velocity** of the notes that
opt in. It is a sequencer concern: it acts when a step is scheduled, never inside the synth.
(The synth's own continuous LFOs are the Modulation card in the Instrument panel; see webdsp's
`docs/lfo-modulation.md`.)

```text
step.velocity (authored)
        |  + lfo(eventTime) x depth x step.lfo
        v
effective velocity  --> ScheduledEvent.gain / instrumentNoteOn velocity --> engine
```

## Data (all in the project, all optional)

| Where | Field | Meaning |
|---|---|---|
| `Track.eventLfo` | `enabled, target ("velocity"), waveform, sync, rateHz, division, depth` | the LFO. Waveform/division are webdsp's names. |
| `Note.lfo` | 0..1 | the step's participation. Absent/0 = plays at its own velocity. |

Effective velocity is never stored. `effective = clamp(velocity + lfo * depth * Note.lfo, 0, 1)`,
`lfo` in -1..1, `depth` 0..1 of the full range (webseq velocity is 0..1; depth 0.25 = about 32 of
127). Projects without these fields play exactly as before (tested).

## Timing

`audio/compile.ts` evaluates the LFO at each note's own **scheduled time** (swing included), so it
is correct for events scheduled ahead of the audio clock and independent of when the UI ticks.
`audio/trackLfo.ts` calls webdsp's `lfoValueAt` (a TypeScript mirror of the engine's LFO shape and
timing maths, parity-tested against the compiled engine in webdsp's smoke test). There is no
second clock: the evaluation uses the transport anchor (the one given to `runtime.setTempo`) and BPM.

* **Sync**: cycle = `(time - anchor) / (60/bpm x division beats)`.
* **Free**: cycle = `(time - anchor) x rateHz`.
* The anchor is set at play / resume / tempo change (`Transport.play`, which `retime` also calls), so
  the LFO restarts there, like webdsp's synced synth LFOs and Pulse. It is **not** reset by pattern
  changes: the LFO belongs to the track and runs on across the chain.
* Manual auditions are not modulated.

## UI

Track Editor tab: the **Track LFO** card (On/Off, waveform, Sync/Free, rate or division, depth,
fixed target "Velocity", and All steps / None), a per-step **LFO** slider on each step card (shown
while the LFO is on), and an amber bar on the step block showing its participation.

Adding another event target later means one more `EventLfoTarget` and one more case in
`effectiveVelocity`; compile and transport do not change.
