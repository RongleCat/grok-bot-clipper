# Grok Bot Browser Implementation Plan

**Goal:** Ship a pure Chrome/Edge MV3 extension that sends explicit browser captures and rich, source-attributed context to Grok Bot, using a browser-native SDK and independently animated avatars.

**Architecture:** Content scripts collect rendered material; a service worker owns authentication, bot routing, persistent jobs, and cloud calls. IndexedDB stores blobs and drafts. An offscreen document handles screenshot conversion and MHTML blobs. Extension pages provide popup, composer, basket, history, settings and a persistent reply side panel. All executable code ships locally. No native helper or credential import from desktop.

**Tech Stack:** JavaScript ESM, Web Crypto, Fetch/ReadableStream, Chrome MV3, esbuild, Mozilla Readability, Turndown, pdfjs, Node test runner and browser integration tests.

## Approved scope

- Browser login; account/team, searchable bots, favorites and default bot.
- Context menus for selection/image/link/page and basket; commands for screenshot/page/quick command.
- Region, viewport, element and bounded scroll screenshots; annotation/redaction before optional send.
- Markdown + MHTML webpage archive; tables/CSV, code, PDF and available video captions/time context.
- Basket, selected tabs, task presets, routing rules, source citation and explicit capture completeness/budgets.
- Optional instruction dialog with IME-safe Enter, persistent drafts.
- IndexedDB outbox; stable message IDs, upload resume checkpoints, uncertain delivery never automatically resent.
- Streaming replies with cursor persistence/reconnect in side panel, safe text rendering.
- Minimal warm neutral UI, no decorative labels/copy; distinct per-bot motion schedules and reduced motion support.
- Native contextMenus cannot have per-item icons on Chromium. Use actual resolved bot avatar for toolbar and custom picker; report this platform limit.

## Task sequence and validation

1. Investigate packaged desktop upload protocol without reading saved credentials. Record exact methods and constraints. Write failing tests for browser PKCE, Connect framing, upload contract, send uncertainty.
2. Port SDK to Web Crypto/Uint8Array/Fetch; reuse avatar normalization and rendering under MIT notices. Run unit tests and bundle scan for Node dependencies.
3. Write failing tests for routing precedence, context packing, truncation, source attribution, privacy filtering, persistent outbox and no unsafe retries. Implement core.
4. Build extension plumbing: manifest, authenticated worker RPC, content capture, offscreen image/archive operations, IndexedDB and alarms recovery. Validate manifest and permission boundaries.
5. Build popup, animated bot picker, settings/rules/shortcuts, composer with preview/editor, basket, history, sidepanel replies. No demo behavior in production.
6. Browser tests with isolated data and local HTTP fixture cover real loaded extension UI, selection/table/code capture, screenshot crop, archives, settings, basket, queue and errors. Stub network only in explicit test harness, never production. Separately report cloud login/send verification status.
7. Inspect screenshots and browser console; fix bugs; package dist + zip; document install, permissions, privacy, limitations and test evidence.

## Completion rules

No guessed upload endpoints, no fake success, no hidden truncation. Cloud authorization is completed by the user if interactive identity verification is required. Distinguish browser tests with fixture network from live cloud delivery. Never send private tabs or existing credentials during tests.
