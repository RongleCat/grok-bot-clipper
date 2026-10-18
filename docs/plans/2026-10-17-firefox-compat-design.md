# Firefox compatibility design

The user accepted a separate desktop Firefox package, keeping all existing Chrome functionality and using a body-content HTML archive instead of Chrome's native MHTML capture. Current Chrome source and its 130 tests are the regression baseline at 2df91f2.

## Approach and alternatives

Keep one business implementation with a small browser adapter and separate build manifests/output directories. A single manifest cannot preserve Chrome's MV3 service worker/offscreen execution and Firefox's native sidebar/processing behavior. A separate product fork would duplicate auth, upload and capture logic and make regressions harder to control.

Firefox uses its supported Manifest V2 persistent background document. This avoids event-page unloading during uploads and reply streams; Chrome retains MV3 exactly. Firefox supports the scripting API and MAIN-world content scripts used by this project. Target desktop Firefox 140+ (including supported ESR releases) to cover modern web APIs and built-in transmission consent; Android is not part of this task. Firefox's manifest declares authentication information, selected website content and browsing activity transmitted to the user's BOT; no analytics are added.

The adapter chooses Promise-based browser APIs on Firefox and leaves Chrome APIs untouched. It maps action/browserAction, sidePanel/sidebarAction and shortcut-manager navigation. Firefox local settings and persisted credentials use extension-origin IndexedDB because storage.setAccessLevel is unavailable; session data stays in privileged native storage.session. Page content scripts must never receive credentials.

Extract the current offscreen operations into a shared processor factory. Chrome's offscreen document keeps its existing messaging and authorization behavior. Firefox's privileged background document executes the same handlers directly, using contextAllowed for authorization without sending runtime messages to itself. Existing persistent outbox/checkpoints, account/workspace fences, cancellation and uncertain-send protection are retained.

Firefox archive output is explicitly described as a body-content HTML file, retaining text and source without promising original-page layout. Chrome archive output, settings and offscreen capability remain intact. Firefox gestures open its native sidebar synchronously; asynchronous composer actions retain the existing independent-window fallback.

## Outputs and validation

Default build/package commands still write dist/ and the existing Chrome ZIP name. New build:firefox/package:firefox commands write dist-firefox/ and a separately named unsigned Firefox XPI/ZIP. Normal Firefox distribution still requires Mozilla signing; no credentials or signing account are available or assumed, and publishing is not authorized.

Fail-first tests cover manifest isolation, private storage semantics, direct processing/auth fences, sidebar gesture/fallback routing, Firefox UI startup/capture/settings, content-script startup, safe body archives and artifact integrity. Run all Chrome tests, both builds, Firefox web-ext lint and code review. Native browser control is currently unavailable; do not claim real-site or real-account verification without an actual browser session.

Primary references checked: MDN background manifest and Background_scripts documentation; Firefox scripting and content_scripts support; Extension Workshop built-in data consent and signing/distribution guidance. Firefox's persistent background is documented at https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background and https://extensionworkshop.com/documentation/develop/debugging/ .
