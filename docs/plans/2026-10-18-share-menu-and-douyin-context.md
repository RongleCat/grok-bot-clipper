# Shared share menu and Douyin context follow-up

Requirements: add a visible gap between search and refresh in compact picker. X and WeChat recipient menus must use one component, matching X-like typography/hover/focus behavior and actual BOT animated avatars. Also investigate the supplied jingxuan modal record, which contains only DOM text and no author/video/metrics.

Plan: extract native action/menu creation into a shared menu component; use the same factory/action renderer for both sites and mount BOT avatars unconditionally. Add shared hover/focus regression and CSS spacing check, then visual verification. For Douyin, check post ID/normalization/snapshot boundary before changing code; add failing fixtures for confirmed gaps, recover only exact-current-post public player metadata, and never assign arbitrary CDN resources or neighboring posts to the active ID. Preserve raw media validation and do not claim real-video delivery without testing the supplied post. Run full tests, both packages and Firefox lint.

Completed in 0.3.7:
- Shared X/WeChat menu/action component with native X typography, hover/focus treatment, and animated recipient avatars; compact picker search has 12px total separation from refresh.
- Douyin accepts snake_case and camelCase public records, preserves richer same-ID records and alternative video addresses, and refreshes exact-current player props at share time. Modal DOM fallback cannot borrow another item's player or metadata.
- Full suite: 176 passing. Chrome and Firefox packages build; Firefox lint: 0 errors, 0 notices, 31 existing warnings. Local isolated headless visual fixture confirms equal menus, hover/avatar rendering and picker spacing.
- The supplied real Douyin page did not expose usable post JSON to the available inspection environment. Actual video download/upload for that post remains unverified; no successful send is claimed.
