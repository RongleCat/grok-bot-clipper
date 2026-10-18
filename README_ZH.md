<p align="center">
  <img src="assets/banner.png" alt="Grok Bot Clipper — Capture · Collect · Send. Five Grok Bot avatars in orange, violet, black, green and blue." width="960" />
</p>

<p align="center"><strong>把浏览器里的好内容，交给你的 BOT。</strong></p>
<p align="center"><em>网页采集 · 截图与文件 · 社交分享 · 材料篮 · BOT 对话</em></p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README_ZH.md">中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/code-MIT-blue.svg" alt="Core code: MIT; third-party exceptions apply" /></a>
  <a href="https://github.com/RongleCat/grok-bot-clipper/stargazers"><img src="https://img.shields.io/github/stars/RongleCat/grok-bot-clipper?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-MV3-4285F4" alt="Chrome and Edge MV3" />
  <img src="https://img.shields.io/badge/Firefox-140%2B-FF7139?logo=firefoxbrowser&logoColor=white" alt="Firefox 140+" />
  <img src="https://img.shields.io/badge/note-unofficial-yellow" alt="Unofficial third-party extension" />
</p>

<p align="center">
  <a href="https://x.com/cgnot996"><img src="https://img.shields.io/badge/X-铁柱AGI%20%40cgnot996-black?logo=x&logoColor=white" alt="X 铁柱AGI @cgnot996" /></a>
  <img src="https://img.shields.io/badge/微信公众号-铁柱AGI-07C160?logo=wechat&logoColor=white" alt="微信公众号 铁柱AGI" />
  <a href="https://bot.tiezhu.si/"><img src="https://img.shields.io/badge/学习站-bot.tiezhu.si-111111" alt="Grok Bot learning site" /></a>
</p>

<p align="center">
  <img src="assets/wechat/mp-search-scan.png" alt="微信搜索铁柱AGI，扫码关注公众号" width="420" />
</p>

<p align="center"><sub>作者：铁柱AGI · Grok Bot 学习站：<a href="https://bot.tiezhu.si/">bot.tiezhu.si</a></sub></p>

---

> [!NOTE]
> **Grok Bot Clipper 是 Grok Bot 的第三方浏览器扩展。** 由 [铁柱AGI](https://x.com/cgnot996) 独立开发，不是 xAI 或 Cursor 的官方产品。它连接你自己的 Grok Bot 账户，不需要本地连接器或自建中转服务，也不读取桌面客户端的登录凭证。

## 能做什么

| 场景                   | 使用方式                                                     |
| ---------------------- | ------------------------------------------------------------ |
| 看见一段值得留存的内容 | 采集选区、正文、链接、图片或表格，保留来源和上下文           |
| 页面不方便复制         | 框选截图、可见区域截图或长截图；发送前可裁剪、标注和打码     |
| 想把帖子交给 BOT       | 在 X、小红书、抖音的分享区域，以及公众号作者栏，选择接收 BOT |
| 要整理一组材料         | 把多个网页、截图与文件加入材料篮，合并成一个任务             |
| 发送前需要加工         | 在草稿里编辑说明、检查正文和附件，查看最终发送内容           |
| 继续讨论               | 在侧栏查看 BOT 回复、渲染 Markdown，并直接追问               |

**BOT 选择器**支持中文名称、拼音全拼和首字母搜索，完整匹配与开头匹配优先。可收藏常用 BOT、设置默认 BOT，并手动刷新名单。

**社交采集**会尽量保留标题、正文、作者、标签、公开互动数据和媒体附件。支持从已知平台数据中取得完整视频地址并下载附件；实际可用性取决于页面与接口，不保证每条视频或每项互动数据都能取得。未获取到的内容会明确标注，不会补成 0，也不会把封面当作视频。

**多语言：**提供 55 种语言和地区配置，默认跟随浏览器，也可在设置中手动选择。覆盖插件页面、分享菜单、采集操作和安装后的扩展元数据，并支持从右向左排版。翻译由机器辅助完成，欢迎母语使用者校正；覆盖范围和维护方法见[多语言说明](docs/i18n.md)。

## 从源码安装

需要 Node.js **22.13+**、npm，以及可用的 Grok Bot 账户。本仓库当前提供源码，暂未配置自动构建、自动打包或自动发布。

```sh
git clone https://github.com/RongleCat/grok-bot-clipper.git
cd grok-bot-clipper
npm ci
npm run build
```

**Chrome / Edge**

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启「开发者模式」，点击「加载已解压的扩展程序」。
3. 选择项目里的 `dist/` 文件夹。
4. 将 **Grok Bot Clipper** 固定到工具栏，打开扩展并授权自己的账户。
5. 选择一个 BOT，采集材料并发送。

**Firefox 桌面版 140+**

```sh
npm run build:firefox
```

打开 `about:debugging#/runtime/this-firefox`，点击「临时载入附加组件」，选择 `dist-firefox/manifest.json`。临时安装会在浏览器重启后失效；普通 Firefox 的长期安装需要 Mozilla 签名。详见 [Firefox 安装说明](docs/firefox.md)。

更新源码后，重新构建并在浏览器扩展管理页点击重载；已打开的社交网页也需要刷新。Chrome 和 Firefox 使用各自独立的输出目录，不会互相覆盖。

## 先认识这几个概念

- **材料篮**：暂存采集的网页、选区、图片和文件，方便组合。
- **草稿箱**：还没发送的材料包和补充说明，可以继续编辑。
- **发送预览**：查看 BOT 最终会收到的正文与附件，不会触发发送。
- **发送记录**：查看上传、投递状态与失败原因。
- **BOT 对话**：读取回复并继续追问。

关闭「发送前补充说明」后，选中 BOT 可直接进入发送队列；开启时会先显示补充说明。发送状态的「已受理」表示服务端确认投递，不代表 BOT 已完成任务。

## 快捷键

| 操作     | macOS   | Windows / Linux |
| -------- | ------- | --------------- |
| 框选截图 | `⌘ ⇧ 7` | `Ctrl Shift 7`  |
| 保存网页 | `⌘ ⇧ 8` | `Ctrl Shift 8`  |
| 快捷命令 | `⌘ ⇧ 9` | `Ctrl Shift 9`  |

快捷键受浏览器和系统占用情况影响，可在扩展快捷键设置中修改。编辑说明时，`Enter` 发送、`Shift+Enter` 换行，输入法选词的回车不会发送。

## BOT 收到的内容

材料包包含带编号的来源、正文 Markdown、可用的作者和采集时间、图片或视频等原始附件，以及描述来源与附件关系的 `context.json`。社交帖还会包含单独的 `post-context.json`，记录公开互动数据与采集缺失情况。

正文过长时，消息提供索引和节选，完整内容保留为附件。浏览器限制、懒加载、跨域页面、受限视频等导致的缺失会保留说明。Chrome 可附带 MHTML 网页快照；Firefox 使用正文 HTML 归档。

## 数据与权限

- 使用浏览器授权连接自己的账户，不读取桌面端凭证。
- 登录凭证默认只存于扩展会话；可自行开启重启后保持登录。
- 设置、草稿、材料和发送记录保存在当前浏览器，不会自动跨浏览器同步。
- 没有分析埋点或自建中转服务；发送内容会交给所选 BOT 对应的云端服务。
- 跨网站采集按需申请权限；内置社交网站和上传域名使用固定权限。
- MHTML 是原始网页快照，可能包含登录后或隐藏内容，可在设置中关闭，也可从草稿中移除。

更多预算、上传恢复和平台边界说明见 [技术与使用细节](docs/technical-guide_ZH.md)。

## 开发

```sh
npm test                 # 自动化回归
npm run build            # Chrome / Edge → dist/
npm run build:firefox    # Firefox → dist-firefox/
npm run lint:firefox     # Firefox 扩展检查
npm run test:fixture     # 本地合成测试网页
```

手动打包脚本 `npm run package` 与 `npm run package:firefox` 仍可使用；仓库没有配置 GitHub Actions 构建或自动发布安装包。

| 目录                 | 内容                             |
| -------------------- | -------------------------------- |
| `src/content/`       | 网页内容采集                     |
| `src/social/`        | 平台分享入口、帖子解析和媒体材料 |
| `src/ui/`、`public/` | 面板、草稿、对话与样式           |
| `src/core/`          | 上下文、图像、队列和本地存储     |
| `src/sdk/`           | 浏览器侧 Grok Bot 协议客户端     |
| `src/platform/`      | Chrome / Firefox 兼容层          |

测试覆盖协议、上传、采集、上下文、像素处理、浏览器适配与 UI 交互。jsdom 测试不等同于真实浏览器端到端验收。[历史验证记录](docs/verification.md)。

## Grok 系列与学习资料

| 项目                                                                          | 用途                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| [Grok Bot 学习站](https://bot.tiezhu.si/)                                     | 安装、用法、例程和实践案例                      |
| [grok-bot-sdk](https://github.com/RongleCat/grok-bot-sdk)                     | 第三方 Grok Bot 协议 SDK                        |
| [grok-bot-avatar-engine](https://github.com/RongleCat/grok-bot-avatar-engine) | 独立 SVG 头像引擎；与本项目的桌面头像运行时不同 |
| [Grok App](https://github.com/RongleCat/grok-app)                             | Grok Build CLI 的桌面工作台                     |
| [awesome-grok-bot](https://github.com/RongleCat/awesome-grok-bot)             | 中英文 Grok Bot 资源清单                        |

## 作者与交流

- **X**：[@cgnot996 · 铁柱AGI](https://x.com/cgnot996)
- **微信公众号**：搜索 **铁柱AGI**，或扫描页顶二维码。
- **学习站**：[bot.tiezhu.si](https://bot.tiezhu.si/)
- **反馈与贡献**：[Issues](https://github.com/RongleCat/grok-bot-clipper/issues) · [Pull requests](https://github.com/RongleCat/grok-bot-clipper/pulls) · [贡献说明](CONTRIBUTING.md)

## 许可证与来源

本项目自有代码使用 [MIT License](LICENSE)。第三方代码和美术资产保留各自权利；**`vendor/desktop-avatar/` 来自桌面应用提取，不在本项目 MIT 授权范围内，也未宣称其具有开源许可证。** 详见 [第三方说明](THIRD_PARTY_NOTICES.md) 和 [头像来源](vendor/desktop-avatar/PROVENANCE.md)。本项目不授予 Grok Bot 品牌或商标权利。
