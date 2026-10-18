# BOT search implementation plan

Goal: both BOT chooser entry points automatically accept literal names, pinyin and pinyin initials, with exact and prefix matches ranked first. No mode switch is needed. Keep existing substring search, grouping, favorites and selection behavior.

Architecture: use one local shared name-search module, backed by bundled pinyin-pro pronunciation data. Normalize case, full-width text and whitespace. Rank exact, prefix and substring matches across literal/full-pinyin/initial keys; keep input order for equal scores. Cache pronunciation by BOT object and name so refreshes/renames update correctly. No network access is used for searches.

Steps:

1. Add a failing embedded chooser test for pinyin/full name/prefix/initial queries and ranking.
2. Add shared search helper tests for mixed Latin/Chinese names, empty/missing names, normalization, phrase pronunciation and rename invalidation.
3. Implement the helper and connect both chooser renderers, preserving favorites as tie ordering and existing groups.
4. Run focused and full tests, build Chrome and Firefox packages, update release version and commit.

Additional reported fix: WeChat entry used a different line box and omitted native metadata bottom spacing. Copy native metadata vertical alignment, block margins and text metrics into the isolated entry; inherit those metrics inside shadow buttons. An isolated real Chrome fixture measured 0px difference between metadata and entry text centers.

Validation: regression tests cover literal/full-pinyin/initials and exact-prefix-substring ordering in embedded and plugin pickers, case/full-width/whitespace/tone normalization, empty queries, name changes, and WeChat native metadata styles. Review found a tone-bearing ü normalization edge case; a failing nǚ regression was added and normalization order corrected. Full suite: 182 passing. Both browser packages build. Firefox lint retains 0 errors, 0 notices and 31 existing warnings.
