# Grok Bot Clipper public repository

User-approved direction: rename to Grok Bot Clipper; publish source to RongleCat/grok-bot-clipper; follow the existing Grok-series centered README visual identity; provide English README.md and Chinese README_ZH.md with X @cgnot996, WeChat 铁柱AGI and https://bot.tiezhu.si/. Use the supplied five-avatar artwork plus product name for a masthead banner. Do not add automated build/package/release workflows.

Implementation:

1. Rename public product/package/build titles and manual package filenames. Preserve existing IndexedDB names and Firefox add-on ID to retain local state and update identity.
2. Write bilingual product-focused READMEs and preserve detailed development/limitations in linked docs. Copy the existing public-account QR and supplied avatar artwork. Add root license and third-party notices that explicitly exclude the proprietary desktop avatar runtime from the project's MIT grant.
3. Remove the local conversation/session file from the public snapshot, ignore future session files, and inspect tracked text for accidental credentials. Publish only a clean-root main branch; retain existing local development branches/history.
4. Run tests and Chrome/Firefox source builds. Create a public GitHub repo, set description/homepage/topics, push source main without Actions workflows or release binaries.
5. Finish the image-generated masthead using the user-supplied avatars, inspect it, attach it to both READMEs and push the banner update.

Validation: 185 tests pass after branding changes. Chrome and Firefox source builds pass. Firefox lint: 0 errors, 0 notices, 31 existing warnings. README local links resolve; common credential-pattern scan found no matches. Public snapshot excludes local session, build artifacts and workflows. Reviewer noted an obsolete Firefox source-package reference; installation/signing docs now describe source builds rather than nonexistent release attachments. Public source main starts with a clean root, retaining local development history on existing branches. Banner generated from the supplied avatars and linked in both language READMEs. No automated build, package or release workflow was added.
