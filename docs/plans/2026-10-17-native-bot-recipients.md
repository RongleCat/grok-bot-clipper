# Native BOT recipient integration

Goal: use the existing friend recipient areas on Xiaohongshu and Douyin, show the primary BOT and every saved BOT with the same animated renderer used in extension UI, and finish with a full BOT chooser. Preserve X behavior and all native recipient/actions.

Design: prepend recipient cells/rows to the native friend list, never append a wide item to the bottom action toolbar. Infer the native repeated recipient item from its avatar/name structure within the share popup. Copy typography and spacing, use four-column cells on Xiaohongshu and full-width rows with the native share button on Douyin. No automatic sends on menu open. Release animated avatars as soon as popup nodes are removed.

Implementation and checks:

1. Add failing DOM regressions for both screenshot layouts, all saved recipients (including more than 50), selected BOT identity, native toolbar preservation, rerender and animation lifecycle.
2. Add a recipient-area adapter in src/social/recipients.js. Wire it into src/social/ui.js, using injected mount/release hooks from the existing src/ui/avatars.js via ui-entry.js. Expose only display-safe avatar data in social.targets and remove the saved BOT truncation.
3. Reproduce missing WeChat injection on HTTP article URLs; permit HTTP only for the WeChat article entrypoint and add matching manifest rules. Keep downloads HTTPS-only. Keep the entry last in #meta_content, robust against delayed author-row rendering and site button resets. Check opaque article IDs. The supplied failing URL is https://mp.weixin.qq.com/s/bg9SeWWoIcFqrXiVDSjHlQ and already matches the HTTPS rule; HTTP coverage is an additional compatibility fix, not an established cause for that article. The actual missing-button cause remains unconfirmed without live inspection.
4. Run new tests, build, and full regression suite; review diff and commit. Browser connection currently fails before any page can be inspected, so live visual validation remains unavailable. The supplied article URL is covered by delayed/replaced author-row tests.

Validation: `npm run build` succeeded and `npm test` passed all 94 tests. The actual packaged content script mounts the existing native avatar engine in a shadow root, with pointer animation listeners released after popup removal. Custom picture avatars are constrained inside the shadow root. Zero/one native friend, padding-only empty-list height, 55 saved BOTs, menu hide/reopen, and current-video identity after SPA navigation have regression coverage. X and existing extension UI behavior remain covered by the full suite. No BOT messages were sent to any real account during verification. Live placement and the supplied WeChat article remain unverified because the computer-use connection fails.
