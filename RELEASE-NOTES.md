# 2.0.32-learning.3

基于 fishjar/kiss-translator 2.0.32 的非官方 GPL-3.0 学习版。此版本作为预发布提供，供 Chrome / Edge 开发者模式安装。

## 功能

- 一键展开网页双语译文，再次点击收起；切换服务或语言时保留旧译文，新结果成功后再替换并播放简短擦除动画。
- 新增 MyMemory 免 Key 机器翻译适配，提供明确点击后才发送的中英双向试用。
- 8 家 AI API 配置预设、自定义 Chat Completions 兼容 API，以及固定的中英翻译 Skill。
- 常规联网、屏蔽谷歌、仅本机离线三档插件请求策略；本机 Argos 中英模型准备与服务脚本。
- 豆包、Kimi 后台网页模式原型，标记为实验功能。

## 下载与安装

- `kiss-translator-learning-chrome.zip`：解压后在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，加载其中的 `chrome` 文件夹；附用户文档与离线准备脚本。
- `kiss-translator-learning-source.zip`：与扩展对应的完整 GPL 源码，不含依赖、账号配置或模型。
- `SHA256SUMS.txt`：两个 ZIP 的 SHA-256 校验值。
- `release-manifest.json`：版本、源码提交、工作区状态和包大小。验证记录见仓库 `VALIDATION.md`。

更新已有安装时保留原文件夹位置，替换扩展文件后点击「重新加载」，再刷新阅读页。离线模型需要首次联网下载，未随安装包分发。

## 验证与边界

MyMemory 已完成真实中英双向请求和开发网页双语追加验证。Argos 已完成真实模型推理及 macOS 拒绝网络的进程测试。最终 Chrome 包已完成生产构建，尚未在真实扩展环境安装验收。

8 家云 AI 预设未使用用户 Key 实调；豆包 / Kimi 网页模式尚未完成真实登录会话验证。免费聊天网站不代表其 API 免费。屏蔽谷歌及仅本机离线策略约束插件请求层，不控制网页自身或整个浏览器的联网。

详细操作见 `START-HERE.md`、`AI-SERVICES.md`、`offline/README.md` 和 `docs/TROUBLESHOOTING.md`。
