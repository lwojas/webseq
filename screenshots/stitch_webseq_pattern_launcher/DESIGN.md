---
name: Web Hardware Groovebox
colors:
  surface: '#0e141b'
  surface-dim: '#0e141b'
  surface-bright: '#343a41'
  surface-container-lowest: '#090f15'
  surface-container-low: '#161c23'
  surface-container: '#1a2027'
  surface-container-high: '#242a32'
  surface-container-highest: '#2f353d'
  on-surface: '#dde3ed'
  on-surface-variant: '#b9cbc1'
  inverse-surface: '#dde3ed'
  inverse-on-surface: '#2b3138'
  outline: '#83958c'
  outline-variant: '#3a4a43'
  surface-tint: '#00e1aa'
  primary: '#fcfffb'
  on-primary: '#003828'
  primary-container: '#14ffc2'
  on-primary-container: '#007255'
  inverse-primary: '#006c50'
  secondary: '#5affd5'
  on-secondary: '#00382b'
  secondary-container: '#00e3b8'
  on-secondary-container: '#00604d'
  tertiary: '#fffeff'
  on-tertiary: '#472a00'
  tertiary-container: '#ffdcb6'
  on-tertiary-container: '#8d5800'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#36ffc4'
  primary-fixed-dim: '#00e1aa'
  on-primary-fixed: '#002116'
  on-primary-fixed-variant: '#00513b'
  secondary-fixed: '#42fdd1'
  secondary-fixed-dim: '#00e0b6'
  on-secondary-fixed: '#002018'
  on-secondary-fixed-variant: '#005140'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#0e141b'
  on-background: '#dde3ed'
  surface-variant: '#2f353d'
typography:
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 1.75rem
    fontWeight: '700'
    lineHeight: 2rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.25rem
  body-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-md:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.6875rem
    fontWeight: '400'
    lineHeight: 0.875rem
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0.04em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.06em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.5625rem
    fontWeight: '600'
    lineHeight: 0.75rem
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  margin: 0.75rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system channels the precision, tactility, and compact functional density of modern hardware instruments—specifically sampling grooveboxes and step sequencers like Elektron Digitone/Octatrack, Polyend Tracker, and classic Roland TR units. It targets electronic music producers, sound designers, and live audio performers who require zero-latency clarity, instant visual feedback, and dense parameter control without decorative clutter.

The visual style blends **Digital Hardware Brutalism** with **Retro Cybernetic Precision**. Surfaces are matte, low-reflectance charcoal and cold near-black, mimicking industrial powder-coated aluminum chassis and backlit OLED screens. Interactive states rely on vibrant luminescent neon teal, cyan LED pulses, and amber caution accents that feel like physical diodes firing in a dim studio environment. Contrast is intentionally razor-sharp, text is utilitarian and monospaced where telemetry matters, and controls prioritize spatial density over expansive whitespace.

## Colors

The palette operates in strict high-contrast dark space, echoing physical synthesizer front panels and LED grids:

- **Base Canvas & Chassis (`#0d1117`, `#131920`):** Ultra-deep charcoal blacks representing the master casing and root workspace.
- **Surface & Panel Elevation (`#182028`, `#1c2631`):** Sub-modules, sequencer lanes, mixer bays, and rack plates.
- **Borders & Dividers (`#263342`, `#334455`):** Structural panel seams, track boundaries, and grid lines. Subtle, crisp, and mechanical.
- **Primary Cyber Teal / Cyan (`#14ffc2`, `#21cbb5`, `#00e5ba`):** The primary signal carrier. Used for active step trigs, engaged transport states, fader fills, loop headers, and focused step highlights.
- **Amber & Gold (`#f59e0b`, `#eab308`):** Secondary telemetry state indicating soloed channels, playhead cursors, pending queue patterns, and warning thresholds.
- **Alert / Destructive Coral (`#ef4444`, `#dc2626`):** Dedicated to recording arm states, track mute indicators, and hard stops.
- **Text & Glyph Hierarchy:** `#ffffff` for active parameter readouts; `#8b9bb4` for structural parameter labels; `#405063` for inactive sequencer slots and disabled parameters.

## Typography

Typography prioritizes rapid scannability and mechanical precision:

- **Monospace Telemetry (`JetBrains Mono`):** Every numerical readout, BPM counter, millisecond value, step coordinate, pattern tracker (`Pattern A BAR 1 BEAT 01`), and sample label must be rendered in fixed-width tabular characters to prevent layout shifting during high-speed playback.
- **Instrument Controls & Body (`Inter`):** General UI navigation, tooltips, dialogs, and modal instructions use a compact, neutral grotesque cut for effortless comprehension at tiny sizes (11px–12px).
- **Module & Device Headers (`Space Grotesk`):** Track names, global modes, and brand headers leverage technical geometric forms with sharp modern character.

## Layout & Spacing

The layout is built for information density and hardware-style rack compartmentalization:

- **Strict Fixed-Height Strip Architecture:** The screen is divided into dedicated functional bands: Master Transport & Telemetry Header (36px–40px), Pattern Chain Strip (28px), Track Control & Step Matrix Grid (flex-grow), and Docked Mixer / Modulation Bay (140px–180px).
- **Sub-8px Grid Rhythm:** Standard web spacing scales are too loose for multi-track step sequencers. Layout intervals collapse to a micro-grid of `2px`, `4px`, `8px`, and `12px` to maximize track lane visibility and fit up to 16–64 steps on desktop displays without requiring excessive scrolling.
- **Scroll & Viewport Policy:** Sequencer timelines enforce horizontal overflow snapping to 16-step bar clusters (`01-16`, `17-32`, etc.). Vertical real estate is maximized by keeping track headers pinned while rows scroll internally.

## Elevation & Depth

Hardware grooveboxes rely on CNC milling, recessed button sockets, and surface layering rather than diffuse drop shadows.

- **Recessed Insets (Trig Grid & Sockets):** Step buttons, fader wells, and input fields use an inward bevel simulated via `1px solid #131920` borders with `#0d1117` inner surfaces, giving them a physical, snap-in-chassis sensation.
- **Beveled Module Plates:** Panels and track bars use crisp hairline boundaries (`1px solid #263342`) with subtle top-edge micro-highlights (`border-top: 1px solid #334455`) indicating physical edge bevels.
- **Luminescent Diode Bloom:** Active steps, playback cursors, and active LEDs reject traditional shadows in favor of compact, high-intensity color glows (`box-shadow: 0 0 6px rgba(20, 255, 194, 0.45)`).
- **Z-Index Layering:** Overlay menus (MIDI assign, sample browser dropdowns) sit at `z-index: 50` on deep `#182028` backings framed by high-contrast `#334455` borders.

## Shapes

The shape vocabulary is tight, utilitarian, and mechanical.

- Elements use micro-radii (`2px` to `4px`) to preserve usable internal pixel real estate for waveforms, labels, and step blocks.
- **Trig Steps & Hardware Keys:** Strictly `2px` border radius, creating clean, square-cornered, instrument-style switch blocks.
- **LED Diodes & Badges:** `9999px` (circular / pill) strictly reserved for LED status dots, playhead indicators, and toggle diodes.
- **Fader Caps & Sliders:** Sleek vertical track lines with compact rectangular thumb handles (`3px` radius).

## Components

### Transport & Push Buttons
- **Global Transport (Play, Pause, Stop, Record):** Solid dark containers (`#1c2631`) with `1px solid #334455` frames. When active, transition to colored fill with inverted text (Play: `#14ffc2` text with glowing border; Stop: `#ef4444` indicator; Record: solid `#ef4444` fill with white text).
- **Sub-Actions & Utility Buttons:** Compact (`24px` height), `JetBrains Mono` 10px uppercase, `space-xs` vertical padding, with instant zero-transition hover highlights.

### Step Sequencer Trigs (The Grid)
- **Inactive / Empty Step:** Dark sunken tile (`#131920`), hairline border (`#1f2937`).
- **Inactive / Populated Step:** Mid-tone slate tile (`#1e293b`) with muted cyan bottom tick.
- **Active Step (Fired):** High-voltage cyan/teal background (`#14ffc2`), dark charcoal text (`#0d1117`).
- **Playhead Sweep Cursor:** A vertical amber or neon line overlay (`2px solid #f59e0b` or `#14ffc2`) traversing across the step grid strictly in sync with the internal clock.

### Vertical Faders & Knobs (Mixer Channel Strip)
- **Track Channel Strip:** 44px–52px fixed-width modules containing track ID, sample title, level percentage (`105%`), long vertical slot (`#0d1117`), and teal illuminated level fill (`#14ffc2`).
- **Mute / Solo Micro-Switches:** Twin compact buttons (`M` / `S`). Active Mute triggers red fill (`#dc2626`); active Solo triggers amber fill (`#f59e0b`).

### Chips, Pattern Selectors & LED Badges
- **Pattern Chips (`Pattern A`, `Pattern B`):** Compact tab-like chips (`#182028`), active pattern receives full teal border and teal text (`#14ffc2`).
- **Status LED Badges:** 6px diameter circular dots embedded in panel headers (e.g., active MIDI sync, audio engine running). Solid green/cyan when active, dark olive/slate when idle.

### Data Inputs & Number Steppers
- **BPM / Swing / Zoom Boxes:** Recessed `#0d1117` boxes with mono digits in `#ffffff`. Drag-to-adjust or double-click to edit, accented with horizontal mini-meter indicator bars beneath the values.