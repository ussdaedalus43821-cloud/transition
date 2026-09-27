# Design Questions

Ambiguities encountered during implementation that need a design
decision. Claude Code appends here instead of deciding silently.

Format:
## Q-NNNN — Title
- Date:
- Context:
- Options considered:
- Blocking: yes | no

---

## Q-0001 — "Teaching layer": the sim is correct, the player screen doesn't explain itself

- Date: 2026-09-27
- Context: the app's first real user test (the user themselves, who
  built every mechanic it plays). Opened the School Bus Depot preset,
  couldn't figure out what to do, hit a clock-speed button, watched a
  year pass and $64k of cash disappear with no explanation, and gave up.
  Their own diagnosis: "tools built by and for someone who already knows
  what they're looking at... designed to be correct, not to be usable by
  someone encountering them cold." See `CLAUDE.md`'s "Known deferred
  work" for the full finding record, including what was checked directly
  (the "Test Actions" heading, the existing-but-easy-to-miss cash-event
  line) rather than assumed.
- **Concrete gaps, not abstractions, per the user's own list**:
  - No mission statement — the player is dropped into a facility with no
    framing of what they're trying to accomplish or why.
  - No explanation of the objectives — `evaluateFinalOutcome`'s four
    tiers (unsuccessful/successful/strong/exceptional) exist and are
    computed at year 20, but nothing in the UI tells the player what's
    being measured or what a good outcome looks like before they get
    there.
  - `<h3>Test Actions</h3>` (`src/ui/overviewTab.ts` ~line 555) —
    developer-facing label wrapping the actual core decisions (solar,
    service upgrade, chargers), not a throwaway debug panel; shipped
    straight to the player screen.
  - Unexplained cash movements — `renderRecentEventLine` exists but is a
    single small, low-contrast line, not a real explanation of magnitude
    or consequence; the user's "no explanation" experience holds even
    though the app isn't literally silent.
  - No indication of what to do next — no onboarding, no suggested first
    action, no distinction drawn between "explore/preview" and "commit"
    for a first-time player.
- Options considered: none yet — explicitly not scoped. Deferred by the
  user's own instruction, not decided here.
- Blocking: yes — this is the project's only playable artifact, and it
  currently cannot onboard a first-time player at all.
- **Not resolved here.** "Do not implement a fix yet... I want to see
  the writeups before we scope the fix, and I want to do one more
  playtest with someone who isn't me before building anything." This
  entry records the gap; it does not choose a fix. Revisit after the
  second playtest.
