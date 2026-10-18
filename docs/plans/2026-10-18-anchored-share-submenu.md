# Anchor BOT submenu to its parent menu item

Problem: X submenu vertical placement clamps against a hard-coded 420px height before its rows load. A three-row submenu is therefore pushed far above the triggering item. Placement also does not follow later parent-menu movement.

Fix: use the triggering item's rectangle plus native parent-menu side edge, measure actual submenu dimensions after every content change, and align top edges where space allows. Near the bottom, align the submenu bottom with the item bottom; clamp only after that. Flip left when right space is insufficient. Keep the top-layer rendering for clipping protection, but bind placement to parent item/menu resize, viewport resize/scroll, and existing page mutation scanning. Dispose observers/listeners on close. WeChat continues opening under its trigger using the same measured-size positioning.

Validation: reproduce the 420px-clamp bug in a regression test, then cover async content sizing, near-bottom alignment, side flip, viewport/parent movement, and listener cleanup. Run full regression and both browser builds.

Completed in 0.3.10: submenu uses actual rendered dimensions and stays anchored through target loading, parent layout changes, scroll and resize. Closing disposes placement observers/listeners. Existing top-layer clipping protection remains. Regression reproduced old 580px placement versus expected 800px, then passed after correction. Real isolated Chrome fixture measured 4px horizontal gap and 0px bottom alignment difference near viewport bottom. Read-only code review found no blocking issues. Full suite: 185 passing; Chrome and Firefox builds pass; Firefox lint: 0 errors, 0 notices, 31 existing warnings.
