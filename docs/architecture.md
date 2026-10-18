# 架构与边界

扩展没有本地桥接器。所有程序代码随扩展打包：

- Content script 在用户操作后注入，读取当前渲染的材料；隔离环境不读取页面 JavaScript 的私有状态。
- Service worker 校验来源、绑定账户/工作区/BOT、采集调度和权限、创建草稿/任务、维护右键菜单和回复连接。
- IndexedDB 保存原始 Blob、材料、草稿、队列、回复和恢复 cursor。Chrome storage 只保存小型配置、BOT 列表和受保护凭证。
- Offscreen 文档执行图像/PDF 操作与长上传。它仅接收扩展内消息；凭证只在活动任务的内存中使用。不会把账户 bearer 发送给预签名对象存储。
- 普通扩展后台标签页使用 pageCapture 生成 MHTML，写入同源 IndexedDB 后自动关闭。
- Popup 只负责快速操作；Composer 保存输入和附件；Side Panel 显示最近回复并追问。

上传链路从本机 Grok Bot 0.70.2 的静态协议定义与调用代码核对。只读取程序文件，未读取登录缓存。浏览器代码是独立适配，不打包 Electron 或 Node 运行时。

## 路由

本次明确指定 > 域名规则 > 动作规则 > 默认 BOT。选定目标后固定该任务的 botId、sessionId、teamId、accountId、workspaceId，重试不重新路由。目标消失时拒绝发送。

## 状态机

queued → uploading → submitting → accepted

uploading 的明确失败进入 failed，可手动重试；已经上传成功的附件与 multipart 检查点可复用。submitting 的未知结果进入 uncertain，不能自动重发。GetGrokBotSendStatus 只有 ACCEPTED 才提升为 accepted，REJECTED 为 failed，其余保持 uncertain。

草稿 ID 同时作为固定 messageId。草稿任务关联和 job 写入在同一 IndexedDB 多 store 事务内提交，防止并发窗口和中途退出重复创建任务。

## 恢复

活动任务留在 offscreen 中，worker 重启先查询活动任务，不把仍在运行的提交误判成未知。确实中断在 submitting 的任务恢复为 uncertain。浏览器关闭会结束 offscreen；后续恢复依据持久化状态处理。

回复首次进入先读取最近 100 条 transcript，保存正文与该页 cursor，再开始监听；断开后延迟重连。reset/resync-required 清除相应 session 的旧缓存并回填。页面端口断开也会重连。

## 上下文

采集层保留结构、原文、出处和缺失；打包层为每份来源编号并创建完整正文与独立文件。消息预算只决定 inline 内容，不删除正文附件。服务端文件限制与客户端预算都可以阻止提交，失败会显示原因。

外部材料作为引用资料组织，和用户说明分开。这有助于来源识别，不能代替 BOT 对提示注入和工具权限的防护。

## 头像与界面（0.2.0）

使用从桌面端程序资产按声明依赖闭包提取的原始 AvatarMark React 组件、几何体、眼睛、表情及动作调度器。导入对接标准 React 包，保留声明原文；提取脚本与来源哈希可复核。旧的拟合二维轮廓实现已移除。页面仅传入 BOT 真实形状/颜色、身份 seed 和播放偏好；不重写几何或动作。原生 still renderer 同时生成默认黑色图标。

Popup 高度为 560px，外层禁止滚动，主内容为唯一滚动容器。BOT 选择器覆盖 popup，固定标题和搜索，仅网格滚动。普通内容对话框使用独立 class，避免误用头像网格的 overflow 规则。对话框复用或关闭前卸载头像 roots，移除指针监听与动画；减少动态效果偏好变化时重建原生组件，清除其初始化缓存。
