# Popup message rejection handling

User reported `Uncaught (in promise) Error: UNKNOWN_ACTION` in `popup.html`. The screenshot highlights an avatar creation line in the current bundle, which does not identify the original RPC. All 22 current literal UI RPC names have background handlers. The triggering action remains unknown; the user was asked which click causes the error.

Reproduced a concrete uncaught rejection through the BOT picker's settings call and the popup's saved-draft opening call by injecting a rejected backend response. Before the change, both tests failed with an unhandled rejection. Both paths now pass through a shared event error boundary that invokes the original callback immediately, preserving browser gesture-sensitive actions. RPC errors retain their action name, and UNKNOWN_ACTION shows a localized operation and reload guidance. Other server errors remain visible. No unsupported background action is silently accepted.

Validation: `npm run build` succeeded; all 96 tests passed. Rejected favorite updates retain their previous state and rejected draft opening leaves the draft accessible. The change fixes missing error handling; it does not establish why the user's running background rejected an action. No live browser reproduction or extension reload was possible in this session.

Review found that a document-level toast is behind a modal dialog's top layer. The status now renders inside an open dialog and is tested there, while ordinary views retain the existing toast. Build and all 96 tests passed again after this adjustment.
