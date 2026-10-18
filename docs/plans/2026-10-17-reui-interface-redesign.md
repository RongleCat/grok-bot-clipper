# ReUI interface redesign implementation plan

**Goal:** Put BOT selection in the chat toolbar, render Markdown replies, and unify all extension screens with compact ReUI component patterns.

**Architecture:** Keep the existing vanilla DOM interface and native avatar runtime. Adapt selected free ReUI registry examples to shared semantic HTML helpers and CSS tokens rather than introduce a second app renderer. Use Marked, DOMPurify and Highlight.js locally bundled under the extension CSP.

**Tech stack:** JavaScript, esbuild, CSS, native dialog/details, React avatar runtime, node:test and JSDOM.

## Checkpoint

Original branch: `feat/browser-extension`; checkpoint: `f540946`; tag: `checkpoint/pre-reui-2026-10-17`. Implementation branch: `feat/reui-interface-redesign`.

## Tasks

1. Download ReUI free Button, Field, Card, Input Group, Collapsible, Message, Switch, Attachment, Empty and Scroll Area examples. Record source URLs and license; adapt helpers in `src/ui/components.js`. Keep the source provenance under `vendor/reui/`.
2. Add Markdown security and formatting tests in `test/markdown.test.mjs`; run before implementing `src/ui/markdown.js`. Cover headings, nested lists, tasks, tables, highlighted code, links, images, HTML sanitization and dangerous URLs. Bundle dependencies locally and add license copies in `scripts/build.mjs`.
3. Move chat BOT selector to `top()` in `src/ui/app.js`, remove the duplicate chat card, retain fixed toolbar/composer and central scroll area. Preserve typed text and reader position during reply updates. Test toolbar location and rendered replies in `test/ui.test.mjs`.
4. Rewrite `settingsView()` around shared Field and section helpers. Group controls into sending, context, routing, appearance/storage, shortcuts and account. Add descriptive text, explicit units, route reset controls and range validation. Preserve existing settings keys and RPC behavior.
5. Apply shared tokens and component styles across home, picker, drafts, materials, history, dialogs and chat. Use one inset chevron for every details summary, fix mismatched `shot-editor` selectors, and contain long filenames, URLs, tables and code. Keep the native square popup boundary.
6. Run `npm run build`, `npm test` and `git diff --check`; inspect Chromium renders at popup, narrow sidebar and wide settings sizes in light/dark themes. Use realistic multiline Markdown and attachment samples. Review the final diff, resolve issues and commit the redesigned version on the new branch.

## ReUI references

- https://reui.io/components/button
- https://reui.io/components/field
- https://reui.io/components/card
- https://reui.io/components/input-group
- https://reui.io/components/collapsible
- https://reui.io/components/message
- https://reui.io/components/switch
- https://reui.io/components/attachment
- https://reui.io/components/empty
- https://reui.io/components/scroll-area

Design: neutral surfaces, 8px control radius, 12px cards, 14px body text, 32px icon actions, consistent visible keyboard focus. Settings use section navigation on desktop and horizontal navigation on small screens. No remote runtime scripts or fonts.
