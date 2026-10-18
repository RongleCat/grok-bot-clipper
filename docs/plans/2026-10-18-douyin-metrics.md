# Douyin interaction metrics follow-up

Reported: the supplied 7695664256984927515 export now includes author and MP4 but metrics are empty. Existing camelCase parsing reads only the statistics container. Public page/player objects also use stats (documented in 4CAT's own extractor source). The actual user's live object has not been inspected because the browser connection is unavailable; this is a confirmed compatibility gap, not a verified claim about the live counts.

Plan: add failing fixtures using stats, including an empty/partial statistics sibling, all public metric keys and explicit zero. Cover the current-ID player snapshot through normalization and exported Markdown/JSON. Read both stats and statistics per metric, keep existing numeric validation, and preserve same-ID cached metrics. Run regression tests, Chrome/Firefox builds and package integrity checks.

Sources for schema: https://docs.4cat.nl/datasources/douyin/search_douyin.html (the extractor's camelCase branch uses item.get("stats")).

Completed: per-field statistics -> stats fallback supports both snake_case and camelCase counts without changing other platforms. Exact-current React snapshot, same-ID summary merging, explicit zero and final Markdown/JSON paths are covered. Focused 27 tests pass; full suite 184 tests pass. Chrome and Firefox 0.3.9 packages build; Firefox lint: 0 errors, 0 notices, 31 existing warnings. Read-only review passed after an intermediate accidental XHS edit was reverted before packaging. Actual post interaction numbers remain unverified because native browser connection failed; fixtures use clearly synthetic values.
