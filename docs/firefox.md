# Firefox 版本

支持桌面 Firefox 140 及以上版本。Chrome / Edge 使用原来的独立构建；Firefox 的构建、清单和安装包均单独生成。本次不宣称 Android 兼容。

## 测试安装

1. 在源码目录运行 `npm ci`、`npm run build:firefox`，保留生成的 `dist-firefox/` 目录。
2. 在 Firefox 地址栏输入 `about:debugging#/runtime/this-firefox`。
3. 点击「临时载入附加组件」，选择 `dist-firefox/manifest.json`。
4. 打开 Grok Bot Clipper，使用自己的账户授权登录，再选择 BOT。
5. 刷新已有的 X、小红书、抖音或公众号页面。

临时安装无需签名，但重启 Firefox 后会卸载，需要重新加载。标为 `unsigned.xpi` 的文件也没有 Mozilla 签名，不能作为普通正式版 Firefox 的长期安装包。

## 给普通用户长期安装

Firefox 正式分发需要 Mozilla 签名。可以选择「自行分发 / 不公开上架」，不必公开展示在附加组件商店。

1. 登录 [Mozilla 附加组件开发者中心](https://addons.mozilla.org/developers/)，提交新附加组件，选择自行分发。
2. 上传本项目生成的 Firefox ZIP，按表单说明填写插件用途与隐私说明。
3. 按 Mozilla 审核要求提供对应提交的源码 ZIP，包含 `package-lock.json` 和构建说明；构建命令为 `npm ci`、`npm run build:firefox`。仓库当前没有预先发布源码包或自动构建产物。
4. 通过校验与必要的审核后，下载 Mozilla 返回的已签名 XPI。
5. 将已签名 XPI 发给用户。用户打开 `about:addons`，点击齿轮菜单，选择「从文件安装附加组件」，选中该 XPI。

仓库当前仅提供源码和手动构建脚本，未上传 Mozilla、未申请签名、未发布商店。签名流程参见 [Mozilla 官方说明](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)。

## 功能差异

| 功能                         | Chrome / Edge                  | Firefox                                                 |
| ---------------------------- | ------------------------------ | ------------------------------------------------------- |
| BOT 选择、收藏、刷新         | 保留                           | 共用业务逻辑                                            |
| 对话、Markdown、草稿、材料篮 | 保留                           | 共用界面与存储逻辑                                      |
| 网页、选区、截图、文件、PDF  | 保留                           | 图片/PDF处理在扩展后台文档执行                          |
| 社交站点分享与媒体           | 保留                           | 使用同一采集及媒体校验代码，仍受站点原始素材可用性限制  |
| 侧栏                         | Chrome sidePanel               | Firefox 原生 sidebarAction；手势失效时草稿使用独立窗口  |
| 网页归档                     | 原有 MHTML                     | 转义的正文 HTML，包含来源，不保留原网页布局和未加载媒体 |
| 快捷键设置                   | 直接打开 Chrome 管理页         | 插件提供手动进入 Firefox 快捷键管理的指引               |
| 后台执行                     | MV3 Service Worker + offscreen | Firefox 支持的 MV2 常驻后台页，保障面板关闭后任务可继续 |

两个浏览器有各自的扩展存储，登录状态、收藏设置、草稿和聊天缓存不会自动跨浏览器同步。插件内「刷新 BOT」会重新请求当前账户的服务端 BOT 列表。

## 数据处理说明

插件按用户操作将选中的网页链接、正文、媒体、本机文件及用户输入发送给用户选择的 BOT。登录鉴权使用现有服务接口；未新增分析统计或中转服务。Firefox 清单声明鉴权信息、网站内容及浏览活动这三类必要传输信息。

Firefox 的持久设置和登录凭证保存于扩展自身来源的私有 IndexedDB；临时凭证使用默认仅扩展上下文可访问的 storage.session。页面脚本不会取得登录凭证。退出登录会清除持久和临时凭证，已有账户/团队隔离检查保持生效。

## 本地构建和检查

```sh
npm ci
npm run build
npm run build:firefox
npm test
npm run lint:firefox
npm run package
npm run package:firefox
```

`dist/` 始终用于 Chrome；`dist-firefox/` 始终用于 Firefox。Firefox 构建不会清理或覆盖 `dist/`。所有文件随包提供，不运行远程脚本。
