# Successful authorization tab cleanup

Reproduced two failures: a fast /auth/poll response before tabs.create's ID was persisted removed loginFlow without closing its eventual tab; a same-origin authorization completion redirect was rejected when it no longer used the initial loginDeepControl path.

Polling now waits for a persisted tab ID and, after verifying the flow UUID, uses the latest stored flow record for cleanup. The cleanup helper closes only that recorded tab on the initial login origin, rejecting conflicting UUIDs and third-party navigations. It accepts same-origin completion landing paths. Cleanup happens after credentials are stored and before BOT roster refresh, so a roster failure does not leave the authorization tab behind.

Validation: failing-first regressions cover the creation/poll race, completion child route and separate callback path; existing tests cover unrelated tabs, another flow and already-closed tabs. Build succeeds; all 111 tests pass. The user's actual remaining URL was requested but not provided before completion, and live browser verification is unavailable. Reload the extension and start a new authorization flow to validate; old completed flows have already discarded their tab metadata.
