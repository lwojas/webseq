---
name: ui-audit
description: Audits UI changes in this webseq repo against the project's existing dark/monospace style system (src/index.css custom properties, spacing, radius, class naming) and against mobile/touch-friendliness (the max-width:768px and pointer:coarse media queries, the data-mobile-tab single-section layout). Run this automatically right after any task that adds or edits a React component (src/components/**, App.tsx) or touches src/index.css, even if the user didn't ask for an audit — UI drift creeps in silently and this is the check that catches it. Also run it on demand whenever the user says things like "run the UI audit", "check the UI style", "audit mobile", "does this look consistent", or "check for UI clutter". Finds issues and fixes them directly rather than just reporting them.
---

# UI audit

webseq has a small, consistent design system living in `src/index.css` and a deliberate
mobile layout in `App.tsx`. New UI work drifts from both easily — a one-off hex color here, a
cramped mobile tab there — and nothing catches it automatically. That's this skill's job: audit
what changed, fix what's wrong, and only bother the user when a fix is risky.

## When to run this

- **Automatically**, immediately after finishing any task that created or edited a React
  component (`src/components/**`, `src/App.tsx`) or `src/index.css`. Treat this as part of
  finishing the task, not an optional extra step — don't wait to be asked.
- **Manually**, whenever the user asks for a UI/style/mobile audit, even with no recent changes
  (in that case, audit the whole relevant surface instead of a diff — see Step 1).

## Step 1 — Determine scope

Prefer auditing just what changed:

```
git status --porcelain -- src/components src/App.tsx src/index.css
git diff --stat -- src/components src/App.tsx src/index.css
```

If there's a real diff (working tree changes, or recent commits if the user is asking about
something just committed), audit the changed files plus their rendered output in context —
e.g. if a component's CSS classes changed, check both the `.tsx` and `src/index.css`.

If invoked manually with nothing currently changed, ask the user which component/screen they
want audited, or default to auditing all of `src/components` and the mobile media queries in
`src/index.css` if they just say "audit the UI" generally.

## Step 2 — Style audit

Re-read the current `src/index.css` `:root` block before judging anything — the tokens below
are the ones in place at the time of writing, but they can change, and auditing against a
stale memory of them produces false positives:

- `--bg`, `--panel`, `--panel-alt`, `--border`, `--border-strong`, `--text`, `--text-dim`,
  `--accent`, `--accent-dim`, `--amber`, `--danger` for all colors; `--note-height`,
  `--row-height`, `--header-width` for the handful of sizing tokens.

Check new/changed CSS and inline styles against the established conventions:

- **No raw hex/rgb colors** that duplicate or approximate an existing token. A new color is
  only acceptable if it's genuinely a new semantic (rare) — and even then, consider whether an
  existing token (e.g. `--danger` for a destructive action, `--amber` for a warning) already
  fits.
- **Monospace stack only** — body font is `"SF Mono", "JetBrains Mono", ui-monospace, Menlo,
  Consolas, monospace` at 12px base. New components shouldn't introduce another font-family or
  wildly different base size without reason.
- **`border-radius: 3px`** is the house radius — nearly everything in this file uses it. A
  different radius should stand out as deliberate, not accidental.
- **Font sizes cluster at 10–13px** (10px for uppercase/letter-spaced micro-labels like
  `.save-status`, `.mobile-tab`; 11–12px for most UI text; 13px for a few emphasized bits).
  Anything outside that band is suspicious.
- **Uppercase micro-labels get `letter-spacing: 0.04–0.05em`** (see `.topbar`, `.mobile-tab`) —
  check new uppercase labels follow the same treatment instead of just `text-transform:
  uppercase` alone.
- **Class naming** follows plain kebab-case, scoped by component/region (`.track-header`,
  `.fx-chip-label`, `.mixer-mute`), with state as a modifier class (`.active`, `.saved`,
  `.error`) rather than a prop-driven inline style. New components should follow the same
  pattern rather than introducing CSS modules, styled-components, or Tailwind-style utility
  classes, which would be inconsistent with everything else here.
- **Spacing** uses small, consistent `gap`/`padding` values (4–16px, usually in 2px/4px
  increments) — flag paddings/gaps that look arbitrary (e.g. `padding: 7px 13px`) next to
  neighboring elements using round values.

## Step 3 — Mobile / touch audit

Re-read the two media query blocks in `src/index.css` (`grep -n "@media" src/index.css` to
find current line numbers — don't rely on stale line numbers) before auditing, since they are
the living source of truth for what mobile support means here:

- **`@media (max-width: 768px)`** — the phone-width layout. Exactly one of
  Timeline/FX/Mixer/Assets is visible at a time, controlled by `.app[data-mobile-tab="..."]`
  (state lives in `App.tsx`'s `mobileTab`). Desktop styling is meant to be untouched outside
  this block.
- **`@media (pointer: coarse)`** — widens hit targets for any actual touch/stylus pointer,
  independent of viewport width. It only *adds* size (padding bumps, bigger `--row-height`,
  wider resize handles) — it never shrinks or hides things.

For any new or changed UI, check:

- **New interactive elements get a `pointer: coarse` rule** bumping their padding/size the
  same way existing controls do (compare against the existing bumps in that block — e.g.
  buttons go from their desktop padding to ~9–12px, chips to ~8–10px). A new button/chip/handle
  with no coarse-pointer treatment is a bug by omission.
  - CSS `padding` alone usually gets most controls past a comfortable tap size at this
    project's font sizes — don't flag something just for not being a specific hardcoded pixel
    value. Flag it when it visibly reads as cramped next to its siblings, not against an
    arbitrary 44px rule.
- **New top-level sections are reachable from `.mobile-tabbar`** or deliberately folded into an
  existing tab — a new panel that's only ever shown via desktop-only layout (and invisible or
  unreachable once `max-width: 768px` hides `.side-panel`/`.main`/`.bottom-panel`) is a mobile
  regression.
- **Clutter**: does the phone-width view for the affected section still show one coherent
  thing, or does new UI cram extra controls into an already-dense row (transport, topbar,
  mixer strip)? The existing pattern for overflow is to `flex-wrap` and let a row break onto a
  second line (see `.topbar`, `.transport` in the 768px block) or to hide a secondary/decorative
  element outright (see `.topbar .subtitle`, `.transport .spacer`) — follow whichever this
  project already does for similar rows rather than inventing a new overflow strategy.
- **Horizontal overflow**: anything with a fixed pixel width that isn't one of the sizing
  tokens, or a flex child without `min-width: 0`/wrapping, can blow out the 768px layout.
  Check against `--header-width` shrinking from 220px to 132px under the mobile query as the
  existing pattern for width that must adapt.
- **Text truncation**: labels that are fine at desktop width may need `text-overflow: ellipsis`
  with `overflow: hidden` and a `min-width: 0` ancestor once the layout narrows — check this
  wasn't just left to clip or overflow silently.

## Step 4 — Fix it

Don't just report findings — apply the fixes, following the conventions above (reuse existing
tokens/classes, match the surrounding code's patterns). This is a normal part of completing the
UI task, the same as fixing a type error you introduced.

**Only stop and ask the user first** if a fix would do more than adjust styling/markup to match
existing conventions — e.g. it would change component behavior, state, props/interfaces, event
handling, or something else with a real chance of introducing a functional bug or changing how
a feature behaves. Pure style/layout/markup corrections (swapping a hex for a token, adding a
`pointer: coarse` rule, fixing wrapping/truncation, adjusting spacing to match the house scale)
should just be made directly, no confirmation needed.

## Step 5 — Report

End with a short summary: what was audited, what was fixed (file:line references), and
anything left open because it needed confirmation first (with the specific risk explained).
