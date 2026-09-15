# 2.0.33-learning.4 · 安全更新

基于 fishjar/kiss-translator 2.0.32 的非官方 GPL-3.0 学习版。提供 Chrome / Edge 开发者模式预发布包，建议旧版用户更新。

## 修复

- 限制网页公开消息和合成输入事件，隔离内部划词消息。
- 停用所有规则/API JavaScript Hook 与油猴外置设置页特权桥，保留原配置文本。
- 加密同步拒绝明文降级；设置导出/同步默认脱敏，保护本机凭据不被远端改址或删除带走。
- 后台网页 AI 严格检查输入框、完整提示及同一区域的发送按钮，避免页面重绘后误发送草稿。
- Argos 增加本机配对令牌、严格 Host/Origin 和连接/读取限制。
- 远端请求要求 HTTPS，统一禁止重定向；升级运行、开发及构建依赖。

## 下载与安装

- `kiss-translator-learning-chrome.zip`：解压，在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，加载其中的 `chrome` 文件夹。
- `kiss-translator-learning-source.zip`：对应完整 GPL 源码，不含依赖、模型和账号配置。
- `SHA256SUMS.txt`：两个 ZIP 和发布清单的校验值。
- `release-manifest.json`：版本、源码提交、工作区状态及包大小。

更新时保留原文件夹位置，替换扩展文件，点击「重新加载」，刷新阅读页。**Argos 用户需停止旧服务、更新本版 offline 脚本（保留 .offline 模型目录），重新启动后把本机配对令牌填入服务的 Key。** 新设备不再从本版导出的设置备份获得密钥或提示词。旧明文云同步与自定义脚本的迁移说明见 [SECURITY.md](SECURITY.md)。

## 验证边界

安全回归、依赖审计与生产构建记录见 [VALIDATION.md](VALIDATION.md)。此前 MyMemory 已有真实中英双向请求，Argos 已有真实模型断网推理记录；本次安全测试使用本地合成数据，没有调用用户付费 API 或登录聊天账号。

8 家 AI 预设未使用用户 Key 实调；豆包 / Kimi 网页模式仍为实验功能，未完成真实登录会话验证。最终安装后的 Chrome / Edge 环境尚需用户验收。免费聊天网站不代表 API 免费，插件联网策略不控制网页自身或整个浏览器的联网。

详细步骤见 [START-HERE.md](START-HERE.md)、[AI-SERVICES.md](AI-SERVICES.md) 和 [offline/README.md](offline/README.md)。
