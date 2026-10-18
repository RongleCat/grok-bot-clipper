# Desktop reference redesign

Goal: Replace the previous UI and fitted avatar implementation using the user's supplied desktop reference.

Approved direction: white and neutral gray surfaces; black text; round, lightly bordered icon buttons; spacious typography; no decorative copy. Keep all existing browser functionality.

1. Extract the desktop's exact AvatarMark, shape mapping, still renderer, geometry, expressions, clips and autonomous scheduler. Preserve declaration text. Replace the fitted MIT avatar implementation entirely. Record source hashes and extraction steps.
2. Use the exact native React avatar component, each seeded by BOT identity. Use its own motion and pointer behavior; no custom pose math. Generate the default black avatar through its native still renderer.
3. Rewrite the stylesheet and popup/picker structure: 400px popup, one vertical scroll owner; picker header/search fixed and only grid scrollable. Desktop-like avatar tiles and round actions. Rebuild settings and forms with padded chevrons, no search outline.
4. Add regression checks for engine provenance/geometry, popup/picker structure and form styling. Run existing regression tests, build and inspect real Chrome popup, search, settings and scroll at multiple positions. Package updated extension.
