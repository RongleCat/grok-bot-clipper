# Social sharing implementation plan

Goal: integrate BOT sharing into X, Xiaohongshu, Douyin and WeChat articles, preserving native layouts and collecting a single post's complete available context.

## Placement evidence

- X: inspected the existing post share menu on a real timeline. Add one native-styled menu item and offer the default BOT, saved BOTs and an extension BOT picker.
- Xiaohongshu: inspected a two-image note and its bottom-right share popover (friends, copy link, QR share). Add an action in that popover, not among unrelated feed items.
- Douyin: inspected a public Jingxuan video detail and the right-hand share popover, including its copy-link button. Match that popover's actions.
- WeChat: the user specified `#meta_content`; append the button as its final child. The browser tool forbids inspecting that host, so no live browser verification is claimed for it.

## Implementation

1. Add bounded, testable post normalizers and platform/CDN validation in `src/social/records.js`. Preserve exact post IDs, text, tags, available interaction counts, all note images and direct video variants. Never associate media from an adjacent post.
2. Add a document-start MAIN-world network observer limited to public post APIs. Inspect cloned fetch/XHR responses without consuming the site's response, modifying requests, reading request credentials, or intercepting private messages. Capture initial post state as well as SPA requests. Bound memory, payload size and traversal.
3. Add isolated-world adapters for native share menus and the WeChat author row. Use native action classes/computed styling; mutation observers support SPA navigation and clean stale actions. Fetch only the default and saved BOT names for the webpage menu. The full BOT roster remains in extension UI.
4. Add a background capture handler validating source host, post identity and media CDN URLs. Download every available image plus a site-provided playable original video file under existing file limits. Assemble a readable Markdown record and structured metadata. Explicitly record unavailable metrics, failed downloads, and unsupported streaming-only video; do not pass playlist/HTML files off as video.
5. Route sharing through the existing draft/outbox. Open the sidebar in the initial click gesture when editing or choosing a BOT, then automatically display the existing BOT picker for the final menu option. Never send anything during development verification.
6. Test normalization, media validation, request observation, post association, native-style injection, WeChat last-child placement, and background material assembly. Build and run the existing suite. Record the limits of browser validation honestly.

Stack: existing JavaScript/DOM, esbuild, native content scripts, no third-party scraping service. All new network access is limited to the named platforms and their media CDNs. Already-open tabs need a reload for document-start observation.

## Validation and limits

- Native share areas were inspected before implementation on X, Xiaohongshu and Douyin. Automated DOM fixtures verify insertion and styling inheritance; post-implementation injection has not been verified on the live sites. WeChat placement is covered by a final-child/idempotency test using the user-supplied selector.
- Media requests follow redirects with credentials omitted. Both the initial URL and final response URL must belong to the platform media allowlist; the final host is validated before reading bytes. Browser Fetch does not expose manual redirect locations. Redirects may contact another host before the final check, but rejected response content is never read or attached.
- Only publicly available site-provided complete video files are attached, using the best exposed direct MP4 variant. This cannot restore an unavailable pre-transcoding source. HLS-only/failed/oversize attachments produce visible warnings and an editable draft instead of a silent partial send.
- Reload the unpacked extension from `dist/` and refresh platform pages so the document-start observer can capture their API responses. No BOT messages were sent during testing.
