# 验证记录

日期：2026-10-17（Asia/Singapore）。

## 已完成的真实 Chrome 与云端验证

- 在本机 Google Chrome 扩展管理页加载 `dist`，扩展成功注册，service worker 与 offscreen 页可见。
- 工具栏首次打开：显示授权入口与本地 SVG 头像。
- 使用 SDK 的 PKCE 登录页面完成实际授权，没有读取桌面凭证。
- 取得真实 BOT 列表，打开选择器，搜索“测试”，选择“Webhook 测试员”。头像、名称、搜索和默认选择均显示正常。
- 切换“发送前补充说明”开关，状态持久保存。
- 在合成验收页点击“保存网页”，实际采集完整 Markdown、CSV 表格与 MHTML，打开真实草稿窗口，正文和附件可检查。
- 提交材料包，发送记录由“上传中”变成“已受理”。包含 4 个附件：CSV、MHTML、完整正文 Markdown、context.json。
- 从草稿窗口打开真实侧边栏，回填 BOT 回复；收到与本次测试对应的验收标记。

BOT 的本次确认内容包括：

> 验收标记：GROK-BROWSER-CONTEXT-20261017

BOT 明确报告已分别打开四份材料，并核对正文第 1～8 段、CSV 表头和两行数据、MHTML、来源目录和附件对应关系。它报告当次正文 1,827 字节、CSV 110 字节、MHTML 12,753 字节、来源目录 907 字节。后续增加结构化代码和更多元数据后，包内字节数会变化。

测试只向专门的测试 BOT 发送本地合成网页。未发送用户其他标签页内容。

## 0.2.0 桌面风格重做与原生 Chrome 验证

电脑控制窗口连接已经恢复。本轮实际重新加载 0.2.0，并再次通过官方浏览器页面完成 PKCE 授权。

- 首页采用白灰配色、黑色文字和圆形按钮；默认黑色头像由桌面端原始 still renderer 生成。
- 真实 BOT 列表使用桌面原始引擎的形状、颜色、立体转向、眨眼与独立动作，实际检视了粉色“赛博小晚”等头像。
- 搜索“测试”只显示对应 BOT；聚焦搜索框没有 outline。
- 长列表滚动到中段时标题和搜索框保持固定，只出现列表的一条滚动条。
- 设置页原生下拉菜单及箭头右侧间距已检查，包括展开的任务菜单。
- 在本地合成页实际打开截图草稿，拖拽裁剪，叠加像素打码并保存。结果为裁剪后的 redacted.png，页面正文、来源和其他附件已清除。
- 发送预览完整显示正文及打包附件信息；本轮截图草稿未发送。
- 图片原生右键菜单显示默认黑色头像；Chromium 不支持子项逐项设置头像。
- 测试结束将“发送前补充说明”恢复到测试前的关闭状态，默认 BOT 保持不变。

## 自动化回归

`npm test`：**47 项通过，0 项失败**。涵盖协议、上传、上下文打包、采集、UI、存储与图像处理。测试包括：

- Web Crypto PKCE、UTF-8 Connect 分片、异常帧大小、固定 messageId、禁止隐式重发。
- SINGLE_PUT / MULTIPART 协议、正确字节顺序、服务端拒绝和不提前完成上传。
- 完整正文附件与文本预算、来源编号、CSV 公式转义、URL 凭证清理、代码附件和媒体元数据。
- DOM 正文、选区代码语言、首个图片右键目标定位、表格自身导出、隐藏内容排除、同源 iframe。
- jsdom 中的 BOT 选择器、搜索、输入法回车、普通回车发送、账户变化后清空旧草稿 UI。
- IndexedDB 并发草稿原子提交、取消任务、NOT_FOUND 不误判成功。
- 账号 generation 隔离、登出后延迟任务拒绝、工作区切换失败回滚、截图最终帧捕获后页面核对。
- 桌面头像全形状渲染、提取声明哈希、原生眨眼、关闭选择器释放监听、减少动态效果切换后重建组件。
- 原生 Canvas 像素级裁剪/打码、打码后移除明文背景和其他附件、裁剪边界、长截图分片不丢行。

构建与 ZIP 完整性检查通过；生产依赖审计为 0 项漏洞。源码与头像引擎无 Node 专用导入、Buffer 或 require。原生 UI 与安全修复的验证范围见以上记录。

## 仍需补做的真实浏览器交互

长截图、快捷键、多标签页权限及材料篮完整操作仍未在本轮逐项完成原生回归；不把核心逻辑的自动化覆盖等同于这些交互已经全部通过。

团队接口、multipart 大文件、云端主机 fallback、受限页面、PDF 和视频的多站点兼容性也没有在本次真实云端验收中逐项覆盖。

## Firefox compatibility, 0.3.0 (2026-10-17)

- Baseline: Chrome build at 2df91f2 (130 tests). The expanded suite passes all 147 tests, retaining the original Chrome cases and adding browser-only Firefox startup, capture, native sidebar/fallback, BOT chooser, HTML archive, private local storage, logout fencing, target-manifest isolation and shared processor coverage.
- Both `npm run package` and `npm run package:firefox` succeed. Firefox uses its own `dist-firefox/`; a SHA-256 inventory of every Chrome `dist/` file is identical before and after Firefox packaging. Source Chrome manifest is unchanged from baseline except its release version (0.3.0).
- ZIP CRC checks pass for Chrome ZIP, Firefox ZIP and unsigned XPI; all manifest entry points exist. Firefox has no Chrome-only archive/offscreen entry pages or unsupported permissions. Packages exclude source maps, build metadata, node_modules, repository history and local account data.
- Mozilla `web-ext` 10.8.0: **0 errors, 0 notices, 31 UNSAFE_VAR_ASSIGNMENT warnings**. These are the existing escaped template renderers/desktop avatar SVG and React machinery, Readability/DOMPurify/highlight.js parsing, and bundled PDF.js dynamic import/worker code, plus the static Firefox shortcut-help dialog. The validator cannot prove custom escapeHTML and trusted icon/renderer outputs. No warning classes are suppressed; code review and Markdown/HTML escaping tests remain enabled. The Android consent-version metadata warning was fixed; this release is supported on desktop Firefox only.
- Firefox 140+ uses a persistent MV2 background document to keep uploads/reply streams running without a visible panel. Chrome retains its MV3 worker, offscreen document and native MHTML path. Firefox uses body-content HTML archiving and manual shortcut-manager instructions because tabs.create cannot open privileged about:addons.
- The Firefox native storage.local area never receives persisted credentials; private local state uses the extension origin's IndexedDB, while native storage.session remains extension-only. Logout clears both credentials and invalidates old account/workspace scopes. The shared task processor retains original Chrome auth.check messaging and prevents duplicate jobs.
- Read-only code review identified the Firefox privileged shortcut-manager URL issue; it was fixed and covered by a failing-first regression. Final review found no blocking issue.
- Native UI/browser connection still fails with `Sky Computer Use native pipe startup failed`. Therefore no real Firefox installation, live account login, social-site injection, video download or BOT delivery is claimed from these automated tests. The XPI is explicitly **unsigned**, and no Mozilla submission/signing/publishing occurred. Ordinary permanent installation requires Mozilla signing; see docs/firefox.md.
- web-ext is development-only and is never included in browser packages. Its dependency audit currently reports an upstream node-forge signature-verification advisory via its Android adbkit tooling; no forced downgrade of web-ext or production dependency change was made.
