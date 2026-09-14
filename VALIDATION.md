# 一键双语学习版验证

更新日期：2026-09-15（Australia/Sydney）。基础版本：KISS Translator 2.0.32，提交 `2656f564dde5b271a8d3fb31e951a8457e8df41c`；当前学习版 `2.0.32-learning.3`。

本文整理已有开发与测试记录，发布文档检查本身没有新增云 API 调用或模型推理。不同轮次的测试有重叠，**不能把下列数量相加作为独立用例总数**。当前发布按预发布处理，已安装 Chrome / Edge 扩展的最终兼容性、8 家真实 Key 和后台网页登录会话均不因构建成功而自动视为通过。

| 证据类别                       | 已有结果                                               | 明确限制                                         |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| MyMemory 真实匿名 API          | 双向 HTTP 200；有 `validation/free-api-live.json` 回执 | 仅验证当时网络，不保证特定地区可达或无限免费     |
| Microsoft 真实 API             | 屏蔽 Google 的网络适配下双向成功                       | 是 Google 不可用模拟，不是运营商实测             |
| Argos 真实模型                 | macOS 独立进程拒绝网络后双向冷启动推理成功             | 不是整台浏览器/电脑的断网验收；其他系统未实测    |
| 网页交互                       | 真实浏览器中的 Web 开发页追加、切换保留与收起          | Web 开发环境不等于安装后的扩展权限与后台消息环境 |
| 8 家 AI API / 豆包与 Kimi 网页 | 配置、请求、解析和 DOM/队列测试                        | 未实调真实 Key，未完成真实登录会话验收           |

## 2026-09-15 发布准备检查

- 最终 Chrome 生产构建通过，扩展首页指向 `Qinzi27/kiss-translator-learning`；手动发布 workflow 的 YAML 结构检查通过。
- 打包脚本在临时 Git 夹具中验证了版本不匹配时拒绝打包并保留旧产物、clean/dirty 工作区处理、文档收录、源码排除、ZIP CRC 与 SHA-256/文件大小信息。
- 发布附件设计为 Chrome ZIP、对应源码 ZIP、`release-manifest.json` 和 `SHA256SUMS.txt`。校验步骤见 [安装说明](START-HERE.md)。这些是本地构建与发布准备记录，**不表示已成功上传 GitHub 或已安装扩展验收**；发布状态以仓库实际 Release 为准。

## 学习版 3：真实免费 API 验证

新增 MyMemory 免 Key 机器翻译接口和向导顶部试用卡片。以下均使用自编合成句，无个人数据、Key、邮件或登录 Cookie；它不是聊天大模型，不使用翻译 Skill。

**真实请求：** `node src/scripts/test-free-api-live.cjs` 通过，使用实际 `handleTranslate → translateMyMemory`，HTTPS 只放行 MyMemory 官方 `/get`，本地“屏蔽谷歌”策略生效，不读取缓存。双向均 HTTP 200、`responseStatus: 200`、`quotaFinished: false`。回执见 `validation/free-api-live.json`（UTC 2026-09-14T16:23:11.706Z，悉尼 9 月 15 日）。

| 方向  | 原文                                                                      | 真实返回                                             |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| 英→中 | A small translation test can help us learn how a browser extension works. | 简单的翻译测试可以帮助我们了解浏览器扩展的工作原理。 |
| 中→英 | 这个免费的接口可以帮助我们测试网页翻译。                                  | This free interface helps us test web translations.  |

**真实浏览器 Web 开发环境：** 在已启动本地开发服务器的 `options.html#/ai-services` 页面，从仅本机离线切到屏蔽谷歌，分别点击两个方向的测试按钮（`useCache: false`）。端口 4318 仅是开发服务，不是部署后的产品网址。

- `The library opens at nine in the morning.` → `图书馆早上9点开放。`
- `图书馆每天早上九点开门。` → `The library is open every morning at 9am.`

随后点击添加服务，在新的 `free-api-demo.html` 阅读页选择 MyMemory，点击悬浮翻译按钮。首次翻译成功追加：`A free translation API can make a short article easier to read.` → `免费翻译API可以使一篇简短的文章更易于阅读。` 原链接及其地址、`const count = 2026;` 代码均保留；中文段落保持原样。含链接段按标签拆分，因此译文较生硬，格式保留不代表整句质量最佳。

**自动测试：** MyMemory 适配器 39 项通过（Node 环境，覆盖 UTF-8 字节、长段、换行、HTML/占位符/代码、同语跳过、异常和额度、并发间隔、取消、限额冷却）；配置、已有 API 调用链和选项界面的关联回归 7 套 221 项通过。真实网络 smoke 单独运行，不计入模拟测试数量。

**构建：** Chrome 生产构建成功，标识 `2.0.32-learning.3`；未新增权限。安装包和对应源码包更新，安装包也附带 `validation/free-api-live.json` 回执。简短网页是开发验收样例，不放入扩展安装目录。

**范围：** MyMemory API 当前网络可达；没有验证中国特定运营商网络或长期稳定性，不保证无限免费。本次官方每日额度页面访问受限，未写死每日数字。额度耗尽/429 会停止同一运行环境已排队的请求，冷却 60 秒后仅接受新的手动调用；不会自动重试、换平台。接口仅用于中英文本/网页翻译，不提供 AI 词典或繁简转换能力。浏览器实测仍是开发环境，未将新包安装到真实 Chrome 扩展环境。

复现：

```sh
node src/scripts/test-free-api-live.cjs
CI=true node_modules/.bin/react-app-rewired test --watchAll=false --runInBand --runTestsByPath src/apis/myMemory.test.js src/config/api.test.js src/hooks/Api.test.js src/views/Options/Apis.test.js src/views/Options/AiServices.test.js src/views/Options/FreeApiTrial.test.js src/apis/trans.translate.test.js src/apis/index.test.js
```

## 学习版 2：AI 接入与译文替换

- 新增 8 家 API 预设、自定义 Chat Completions 接口、固定中英翻译 Skill、豆包/Kimi 实验性后台网页通道。服务费用与官方依据见 `AI-SERVICES.md`。
- Chrome 生产构建成功，产物标识 `2.0.32-learning.2`，保留原有扩展权限；安装包和对应 GPL 源码包已重新生成并校验 ZIP 完整性。
- 本轮同一次定向 Jest：**26 个套件、561 项全部通过**。覆盖 8 家生成请求、返回解析、配置与向导、消息权限、后台串行队列、取消与快速切换、网络策略以及原有翻译链路。
- 切换刷新有 **12 项测试**：等待时保留旧译文、失败与空结果保留、连续切换拒绝迟到结果、关闭与取消、语言变化、原文与链接保留、减少动态效果、擦除淡入及视口外段落等。
- 后台网页 DOM 及任务调度 **23 项测试通过**；其中使用真实 CRA 生产 Babel 配置与 Terser 转换单文件，将压缩产物函数脱离模块闭包执行完整准备、提交和读取流程。最终明确 `window.location` 的 lint 修正后再次通过这 23 项。
- 浏览器 Web 开发环境已查看全部 8 个服务、自定义表单、Kimi API/后台方式与离线策略禁用状态；一键展开既有 Argos 译文并收起恢复原文正常。此次浏览器回归允许使用既有缓存，不计作新一轮真实模型推理。
- 真实页面通过面板从 Argos 切到 Google（保持“仅本机离线”）：Google 请求被策略拒绝，既有译文完整保留，段落提示“新译文未完成，保留原译文”。切回 Argos 后译文正常，失败提示被清除。
- 没有用户 API Key，**没有实调这 8 家云 API**；没有真实登录会话，**没有完成豆包/Kimi 网站兼容性验收**。后台页面测试是 DOM 夹具，不能证明当前官网一定兼容。
- 在网页翻译面板切换已加载的服务或语言支持保留旧译文；同一服务编辑 Key、地址或偏好后需刷新阅读页。后台网页会复用浏览器登录状态，创建专用的不激活标签；取消不能保证撤回服务端已接收的请求。

以下在线与离线实测来自 2026-09-14 的学习版 1 验证，保留原证据，不将其当作新增 AI 服务的实测。

## 学习版 1 基础验证

- 当轮 `pnpm install --frozen-lockfile` 安装成功；当时沿用上游锁文件，pnpm 11 的 overrides 兼容配置位于 `pnpm-workspace.yaml`。当前发布依赖以对应源码包的 `package.json` 与锁文件为准。
- 最终 `pnpm build:chrome` 成功，包含联网策略、Argos 预设、新装中文默认和本地 favicon。
- 同一次定向 Jest 运行：**16 个套件、389 项全部通过**。覆盖配置初始化、已有偏好保留、普通与流式请求策略、订阅请求链、翻译引擎及调度器、悬浮按钮及选项页面。
- 其中新增的一键验收覆盖保留原节点与链接事件、换行追加、关闭恢复、重复开启、迟到响应、快速开关和页面自身更新。
- `offline/test_runtime.py`：**11 项通过**，覆盖富文本标签、数字占位符、空白和英文词边界、无效请求及异常日志。
- `git diff --check` 通过。

Jest 的 DOM、接口和视口观察为模拟。以下测试使用真实浏览器或真实模型补充验证，不将两者混为一谈。

## 真实在线与谷歌不可用模拟

在本地 Web 开发环境的真实浏览器中，使用 Microsoft 服务点击悬浮按钮，成功在原文下追加译文；再次点击收起，原网页测试按钮仍正常响应。

`node src/scripts/test-network-live.cjs` 已通过。它执行真实上游 `handleTranslate → genTransReq → parseTransRes`，网络适配仅放行 `https://edge.microsoft.com` 并拒绝重定向：Google 请求被阻止，Microsoft 两次请求均为 HTTP 200。

| 方向  | 原文                                                     | 真实返回                                               |
| ----- | -------------------------------------------------------- | ------------------------------------------------------ |
| 英→中 | I read a short article and learn one new word every day. | 我每天读一篇短文，学一个新单词。                       |
| 中→英 | 我每天读一篇短文章，并学习一个新词。                     | I read a short article every day and learn a new word. |

另在浏览器选择实际「屏蔽谷歌」策略及 Microsoft，翻译新的未缓存段落成功：`A translation tool can still be useful when Google services are unavailable.` → `当谷歌服务无法使用时，翻译工具仍然非常有用。`

这是 Google 不可用的模拟，不是特定地区或运营商可达性的实测，免费接口的长期可用性也不在本次验证范围。

## 真实离线模型与网页

本机安装 Argos Translate 1.11.0 和官方 en↔zh 1.9 模型。模型来源、版本及 SHA-256 记录在 `offline/model-receipt.json`。

在 macOS `sandbox-exec` 拒绝全部网络访问的独立进程中，先用连接探测得到操作系统 PermissionError，再冷启动模型，完成双向真实推理。证据 `offline/verified-offline.json`（2026-09-14T05:21:59Z）含 `os_network_denied: true`。

- `Reading helps us understand the world.` → `阅读帮助我们理解世界。`
- `今天我想学习如何翻译网页。` → `Today I want to learn how to translate the page.`

在已启动本地 Web 开发服务器的 `content.html` 页面选择「仅本机离线」及「本机离线 · Argos」，本机 HTTP 服务收到实际请求并返回 200，页面追加真实译文。开发编译稳定后重新加载，单击展开，再次单击全部收起；原页面按钮事件有效，链接和代码仍保留。

真实模型的双向富文本样例保留标签和数字占位符。按标签分段会降低部分句序和标点的流畅度；Argos 的翻译质量不等同于大型在线模型。

## 验证边界

- 真实浏览器采用 **Web 开发环境**，最终 Chrome 包已构建但尚未安装。扩展权限、后台消息和常用网站兼容性仍需加载扩展后验证。
- 操作系统断网测试只限制独立推理进程，没有关闭用户整台电脑的网络。网页测试采用插件请求策略和禁止 Python 出站连接的本机服务，没有声称整台浏览器断网。
- 「仅本机离线」约束插件内置 HTTP 请求层，允许显式 loopback 地址，阻止远程请求和重定向；不改变网页自身联网，不取消切换前的请求。自定义脚本和浏览器语音组件不等同于该请求层。
- 首次安装依赖和准备模型需要联网；完成后本机推理不需要谷歌或其他在线翻译服务。Ollama 本次未安装或实测。
- 参考的沉浸式翻译设置地址受浏览器工具访问限制，未读取其个人配置。本项目以公开 KISS 源码为基础。

## 复现命令

先按 [源码构建说明](START-HERE.md#从源码学习和构建) 安装依赖，并在源码根目录执行。下列 Jest 是确定性模拟测试；网络 smoke 是额外的真实请求，运行会消耗相应匿名额度，不应作为循环监控。离线模型的安装与不同系统命令见 [Argos 说明](offline/README.md)。Windows PowerShell 使用 `$env:CI='true'` 设置 CI 环境，虚拟环境 Python 路径为 `.\.offline\venv\Scripts\python.exe`。

学习版 2 的新增功能与关联回归：

```sh
CI=true node_modules/.bin/react-app-rewired test --watchAll=false --runInBand --runTestsByPath src/config/api.test.js src/config/setting.test.js src/config/prompt.test.js src/config/aiServices.test.js src/config/translationSkill.test.js src/apis/trans.learningAi.test.js src/apis/trans.translate.test.js src/apis/index.test.js src/libs/webAiBridge.test.js src/libs/webAiDomAdapter.test.js src/libs/webAiMessages.test.js src/libs/webAiClient.test.js src/libs/translator.test.js src/libs/translationRefresh.test.js src/libs/oneClickAcceptance.test.js src/libs/translatorManager.test.js src/views/Action/ContentFab.integration.test.js src/views/Options/AiServices.test.js src/views/Options/Apis.test.js src/views/Options/Navigator.test.js src/views/Options/Layout.test.js src/views/Options/index.test.js src/libs/networkPolicy.test.js src/libs/networkPolicy.integration.test.js src/libs/request.test.js src/libs/requestStream.test.js
```

基础验证及打包：

```sh
pnpm test --watchAll=false --runInBand --runTestsByPath src/config/api.test.js src/config/setting.test.js src/hooks/Api.test.js src/libs/storage.test.js src/views/Action/ContentFab.test.js src/views/Action/ContentFab.integration.test.js src/libs/translator.test.js src/libs/translatorManager.test.js src/libs/oneClickAcceptance.test.js src/libs/networkPolicy.test.js src/libs/networkPolicy.integration.test.js src/libs/request.test.js src/libs/requestStream.test.js src/subtitle/youtubeCaptionTracks.test.js src/views/Options/Layout.test.js src/views/Options/SubtitleSegmentationPlayground.test.js
.offline/venv/bin/python -m unittest discover -s offline -p test_runtime.py
node src/scripts/test-network-live.cjs
sandbox-exec -f offline/deny-network.sb .offline/venv/bin/python offline/verify.py --require-os-network-denied
pnpm build:chrome
python3 src/scripts/package-learning.py
```

在线测试需要网络；`sandbox-exec` 命令只适用于 macOS。其他平台可运行 `offline/verify.py` 验证 Python 进程出站限制，但不能将其记录为操作系统级网络隔离。
