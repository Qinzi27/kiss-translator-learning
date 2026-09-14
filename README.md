# KISS Translator · 一键双语学习版

[English](README.en.md) · [下载发布包](../../releases) · [安装与使用](START-HERE.md) · [验证记录](VALIDATION.md)

在普通网页上单击悬浮翻译按钮，**保留原文，在下方追加译文；再次单击收起**。主要面向中英阅读，支持在线翻译与准备模型后的本机离线翻译。

当前版本：**`2.0.32-learning.3`**。

这是基于 [Gabe / fishjar 及贡献者的 KISS Translator](https://github.com/fishjar/kiss-translator) 开发的独立学习分支，**不是原作者发布的官方版本**。基础版本为 2.0.32，保留上游作者信息与 [GPL-3.0 许可证](LICENSE)。

## 能做什么

| 使用方式 | 本学习版提供的功能 | 使用条件 |
| --- | --- | --- |
| 免费接口试用 | MyMemory 中英双向翻译；向导里直接测试、添加服务 | 无需账号、邮件或 Key；在线匿名限量服务 |
| AI 翻译 | 豆包、Kimi、DeepSeek、千问、智谱、腾讯混元、硅基流动、OpenRouter 共 8 个 API 预设 | 填写自己的 Key 和已开通模型；免费、试用或收费取决于服务商与模型 |
| 自定义 AI | OpenAI Chat Completions 兼容地址、模型、Key 和翻译偏好 | 适用于自己的远程服务或本机兼容服务 |
| 本机离线 | Argos Translate 英中、中文双向推理 | 首次联网安装依赖和模型；之后运行本机服务 |
| 后台网页 | 豆包 / Kimi 网页方式，使用同一浏览器的登录状态 | **实验性**，需要安装扩展并手动登录；未完成真实登录会话验收 |

网页翻译默认保留双语，随滚动处理后续内容。切换服务或目标语言时，先保留旧译文，成功后逐段替换；失败的段落保留旧译文。原有的划词、输入框、悬停、字幕、规则和同步等功能继续保留，但并未全部纳入本学习版验收。

AI 向导使用[固定中英翻译 Skill](TRANSLATION-SKILL.md)，可补充风格与术语偏好；MyMemory 是机器翻译接口，不使用聊天 AI Skill。预设不附带共享 Key。**免费聊天网页不等于免费 API，开源插件也不等于所有服务免费。**

## 安装与更新

目前提供可在 **Chrome / Edge** 加载的开发者模式安装包。

1. 在本仓库 [Releases](../../releases) 下载 `kiss-translator-learning-chrome.zip` 并解压。
2. Chrome 打开 `chrome://extensions`，或 Edge 打开 `edge://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的 **`chrome` 文件夹**，其中应直接包含 `manifest.json`。不要直接选择 ZIP 或源码目录。
4. 刷新一篇普通网页，单击网页边缘的翻译按钮；也可按 `Alt + Q`（Mac 为 `Option + Q`）。再次单击收起。

从源码构建时，对应安装目录是 `build/chrome`。浏览器设置页、扩展商店、PDF 等特殊页面不在本次验证范围；访问本地 HTML 需要在扩展详情中允许文件网址访问。

同一 Release 另附独立的 `SHA256SUMS.txt` 和 `release-manifest.json`。下载后核对安装包或源码包的 SHA-256 与校验文件一致；发布清单记录版本、源码提交及包信息。具体内容见[发布说明](RELEASE-NOTES.md)。

更新时保留已加载文件夹的路径，用新版本替换其中的扩展文件，在扩展管理页点击「重新加载」，然后刷新阅读页。通常无需卸载或清空设置；已有设置可能不会自动补入新预设，缺少 MyMemory 时可在向导添加，缺少 Argos 时按[手动添加步骤](offline/README.md#没有-argos-预置时手动添加)配置。商店中的上游版本与本学习版不同。

## 先试 MyMemory

1. 打开扩展设置中的 **AI 翻译向导**，找到顶部「MyMemory · 免 Key 试用」。
2. 如果当前是「仅本机离线」，点击卡片的「切到屏蔽谷歌模式」，再明确点击测试按钮；切换策略本身不会发送测试句。
3. 选择中英方向并点击「测试免费接口」，确认结果后点击「添加到翻译服务」。
4. 刷新阅读页，在网页翻译面板选择 **MyMemory · 免 Key**，再开启翻译。

添加服务不会自动改变全局服务。需要全局使用时，进入「网页翻译 → 全局规则」，按 **编辑 → 选择服务 → 保存** 操作；单独设置过的网站规则可能覆盖全局规则。新安装的默认在线服务仍沿用上游 Microsoft。

MyMemory 官方接口每次最多接收 **500 个 UTF-8 字节**，插件按段和字节分片发送。它有免费额度，限流或额度耗尽会提示错误，不自动重试或换平台。本次官方每日额度说明页访问受限，因此没有把每日数值写死。在线翻译会把待译文本发给服务方，服务方可能留存文本。详见[接口配置与边界](AI-SERVICES.md#先试一个不用-key-的真实接口)及 [MyMemory 官方文档](https://mymemory.translated.net/doc/spec.php)。

## 使用 AI 或本机离线

**AI API：** 在「AI 翻译向导」选择预设或「自定义兼容 API」，填写 Key、模型和措辞偏好。测试按钮只在点击后发送页面披露的合成句；保存配置不会发送测试句。点击「设为全局服务」会同时保存并更新全局网页规则。费用与模型条件见 [AI-SERVICES.md](AI-SERVICES.md)。编辑同一服务的 Key、地址或偏好后，刷新原阅读页以加载新配置。

**Argos 离线：** 扩展安装包和源码包都不包含模型与 Python 依赖。在源码目录首次联网准备：

```sh
python3.12 -m venv .offline/venv
.offline/venv/bin/python -m pip install -r offline/requirements.txt
.offline/venv/bin/python offline/prepare.py
.offline/venv/bin/python offline/verify.py
```

准备成功后启动服务并保持终端运行：

```sh
.offline/venv/bin/python offline/server.py
```

本机端点为 `http://127.0.0.1:8765/translate`。在「概览 → 联网策略」选择「仅本机离线」，将网页翻译服务设为「本机离线 · Argos」，刷新阅读页后使用。Windows 的虚拟环境 Python 路径为 `.offline\venv\Scripts\python.exe`；换电脑、模型准备和缺少预设的完整操作见 [Argos 使用说明](offline/README.md)，请求失败时参见[本机服务排错](docs/TROUBLESHOOTING.md#argos-本机服务)。

联网策略有「常规联网」「屏蔽谷歌」「仅本机离线」三档，约束插件内置请求层。它不会把云服务变成本地模型，也不控制网页自身联网或关闭电脑网络。离线阅读的网页本身需要提前加载或保存。

## 已验证到哪里

| 内容 | 已完成 | 尚未证明 |
| --- | --- | --- |
| MyMemory | 真实 HTTPS 中英双向请求成功；真实浏览器 Web 开发环境追加双语成功 | 中国特定运营商可达性、长期稳定性、无限免费 |
| Argos | 真实模型中英双向推理；macOS 操作系统拒绝网络的独立进程验证；开发网页接入成功 | 整台浏览器或电脑完全断网的所有行为 |
| 8 家 AI API | 官方资料核对、请求与解析测试、配置向导测试 | 未使用用户 Key 实调这 8 家云模型 |
| 豆包 / Kimi 网页 | DOM 夹具、后台消息、队列、取消和任务标记测试 | 当前官网的真实登录会话兼容性 |
| Chrome / Edge 交付 | Chrome 生产包构建成功，供两者开发者模式加载 | 最终包尚未在真实扩展环境安装验收；其他浏览器未验收 |

MyMemory 适配器测试 39 项通过，关联回归 7 套 221 项通过；学习版 2 的 AI 与关联回归曾有 26 套 561 项通过。这些是不同轮次的记录，不应相加当成一次全仓测试。

- [MyMemory 真实请求回执](validation/free-api-live.json)
- [Argos 断网推理回执](offline/verified-offline.json)与[模型来源、版本和校验值](offline/model-receipt.json)
- [完整验证记录与复现命令](VALIDATION.md)

按标签和字节分片可以保留链接、代码及占位符，但会损失句子上下文。格式保留、测试通过都不代表译文完全准确。

## 从源码构建与学习

克隆本仓库或解压 `kiss-translator-learning-source.zip` 后，在包含 `package.json` 的目录运行。现有构建已在 Node.js 20 / pnpm 11 环境验证；首次安装需要联网。

```sh
pnpm install --frozen-lockfile
pnpm build:chrome
```

扩展产物位于 `build/chrome`。解压源码 ZIP 可以安装依赖并构建扩展，但它不含 `.git`；当前打包脚本依赖 Git 文件清单，因此重新生成发布包时需要使用克隆的仓库。在克隆仓库中完成构建后运行：

```sh
python3 src/scripts/package-learning.py
```

打包脚本生成 `releases/kiss-translator-learning-chrome.zip`、`releases/kiss-translator-learning-source.zip` 及独立校验和发布清单文件。发布流程见 [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md)。

本地开发预览：

```sh
HOST=127.0.0.1 PORT=4318 BROWSER=none pnpm start
```

打开 `http://127.0.0.1:4318/content.html` 查看网页翻译，或 `http://127.0.0.1:4318/options.html#/ai-services` 查看向导。Web 开发预览不能替代扩展环境验收。

MyMemory 与关联功能的定向测试：

```sh
CI=true node_modules/.bin/react-app-rewired test --watchAll=false --runInBand --runTestsByPath src/apis/myMemory.test.js src/config/api.test.js src/hooks/Api.test.js src/views/Options/Apis.test.js src/views/Options/AiServices.test.js src/views/Options/FreeApiTrial.test.js src/apis/trans.translate.test.js src/apis/index.test.js
```

`node src/scripts/test-free-api-live.cjs` 会向 MyMemory 发送少量合成句并消耗免费额度；普通自动测试使用模拟响应。Argos 与更完整的测试命令见 [VALIDATION.md](VALIDATION.md)。

建议从 [悬浮按钮](src/views/Action/ContentFab.js)、[整页翻译调度](src/libs/translatorManager.js)、[段落处理](src/libs/translator.js)、[服务请求](src/apis/trans.js)和 [MyMemory 适配器](src/apis/myMemory.js)开始阅读。

## 文档与来源

- [START-HERE.md](START-HERE.md)：安装、切换服务、离线准备与常见问题。
- [AI-SERVICES.md](AI-SERVICES.md)：免 Key 试用、8 个 AI 预设、自定义 API、后台网页与计费边界。
- [TRANSLATION-SKILL.md](TRANSLATION-SKILL.md)：固定翻译指令、偏好与限制。
- [VALIDATION.md](VALIDATION.md)：测试证据、实际返回、验证边界及复现命令。
- [offline/README.md](offline/README.md)：Argos 模型准备、本机服务与离线验证。
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)：安装、请求失败及常见故障排查。
- [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md)：学习版版本、打包与发布流程。
- [RELEASE-NOTES.md](RELEASE-NOTES.md)：当前版本变更、发布文件与校验说明。
- [custom-api_v2.md](custom-api_v2.md)：保留的上游高级 Custom 接口协议说明，与向导的 Chat Completions 接口不同。
- [上游基础提交](https://github.com/fishjar/kiss-translator/commit/2656f564dde5b271a8d3fb31e951a8457e8df41c)与[该提交的 README](https://github.com/fishjar/kiss-translator/blob/2656f564dde5b271a8d3fb31e951a8457e8df41c/README.md)。

基础源码于 2026-09-14 获取，原作者为 Gabe / fishjar 及上游贡献者。本学习版修改继续使用 [GPL-3.0](LICENSE)。发布包附带许可证，并提供对应源码包；源码 ZIP 不包含 `.git` 历史、账号配置、依赖目录或已下载模型。学习版问题请反馈到本仓库，避免将修改版行为误报为上游官方版本的问题。
