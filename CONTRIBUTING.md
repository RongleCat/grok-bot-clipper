# Contributing to Grok Bot Clipper

English: open an issue describing the browser/version, the action you took, what happened and what you expected. Use a public sample page or synthetic fixture where possible. Never attach login credentials, authorization links, private messages or unredacted material packages.

中文：欢迎通过 Issue 提交问题或建议。请说明浏览器和版本、操作步骤、实际与预期结果。优先使用公开链接或合成页面复现，不要上传登录凭证、授权链接、私聊记录或未经检查的材料包。

For code changes:

```sh
npm ci
npm test
npm run build
npm run build:firefox
```

Keep Chrome behavior intact when changing Firefox compatibility. Add a regression case for behavior fixes and describe what you validated. Avoid generated distributions, local session notes, credentials and automated package/release workflows in pull requests. Existing storage names and the Firefox add-on ID are retained for upgrade compatibility despite the product rename.

Contributions must be yours to submit and must respect the component boundaries in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The root MIT grant does not relicense the extracted desktop avatar runtime or third-party branding.
