# Firefox Compatibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an independently packaged Firefox desktop extension while preserving every existing Chrome feature and command.

**Architecture:** One business implementation, build-specific manifests and a browser adapter. Firefox uses a persistent background document and private local IndexedDB; Chrome keeps its service worker, offscreen document and MHTML archive.

**Tech Stack:** JavaScript ESM, esbuild, WebExtensions, IndexedDB, Node test runner/JSDOM, web-ext validation.

---

### Task 1: Browser adapter and private Firefox storage

**Files:** Create src/platform/browser.js, src/platform/storage.js, test/browser-platform.test.mjs.

1. Write tests for unchanged Chrome forwarding, native Firefox Promise APIs/browserAction, synchronous sidebar opening, and private local storage get/set/remove/defaults/clear without native local credentials.
2. Run node --test test/browser-platform.test.mjs; verify failure before implementation.
3. Implement extension-only IndexedDB storage and browser API selection using compile target with a runtime test fallback. Keep native Firefox session storage privileged.
4. Re-run the focused tests and commit the tested adapter.

### Task 2: Shared processor and background integration

**Files:** Create src/offscreen/tasks.js; modify src/offscreen/index.js, src/background.js; add test/firefox-background.test.mjs and processor tests; update desktop renderer source assertion.

1. Add failing tests with browser-only Firefox APIs (no offscreen/sidePanel/setAccessLevel/pageCapture), fenced direct processor invocation and native sidebar fallback.
2. Extract existing handlers into a factory parameterized by authorization and notification functions; leave Chrome's offscreen wrapper protocol intact.
3. Route Firefox processing directly from its privileged background document. Replace raw chrome bindings with browser adapter; preserve existing outbox and auth logic.
4. Run background, upload, storage, image and Firefox tests, then commit.

### Task 3: UI, content capture and body archive

**Files:** Modify src/ui/app.js, src/ui/share.js, src/content/index.js, src/social/ui.js; create src/platform/archive.js; extend test/ui.test.mjs, test/capture.test.mjs and Firefox integration tests.

1. Write failing Firefox UI/content tests using browser namespace only and safe-archive tests (source URL cleanup, HTML escaping, no scripts).
2. Route runtime/storage/action/sidebars through the adapter; use Firefox's add-on manager for shortcut management and explicit HTML archive settings text.
3. Add body-only HTML archive fallback in background; keep Chrome MHTML unchanged.
4. Verify Firefox login/BOT selection, composer/chat navigation, capture, attachment handling and existing Chrome UI tests; commit.

### Task 4: Isolated manifests and distributable artifacts

**Files:** Create scripts/targets.mjs, test/browser-build.test.mjs; modify scripts/build.mjs, scripts/package.mjs, package.json, .gitignore; add Firefox installation/privacy documentation.

1. Add failing manifest tests asserting Chrome source unchanged and Firefox persistent background/sidebar/browser_action/consent metadata without unsupported Chrome permissions.
2. Parameterize build paths and esbuild target; emit background HTML for Firefox, remove Chrome-only entry pages from Firefox manifest/output. Default commands retain Chrome behavior.
3. Add Firefox ZIP and unsigned XPI packaging with clear separate names; increment release version consistently.
4. Run both builds and Firefox web-ext lint. Resolve errors, document unavoidable vendor warnings with exact origins.
5. Run the full test suite and ZIP/entry-point checks; request a read-only code review and fix important findings.
6. Commit final changes, report artifact paths and installation/signing limits. No store upload, real BOT send or publishing is authorized by this task.

## Completed validation

All four implementation tasks are complete. Shared processing and Firefox private storage were committed in 1cdba4a; UI/capture/HTML archive support in 3f9da51. Both target packages build independently; all 147 tests pass, Chrome output hashes survive a Firefox build unchanged, and Mozilla lint reports zero errors/notices. Dynamic HTML warning origins and real-browser/signing limits are recorded in docs/verification.md. The reviewer-discovered privileged shortcut URL was replaced by a Firefox-only instruction dialog; Chrome's existing manager navigation remains unchanged.
