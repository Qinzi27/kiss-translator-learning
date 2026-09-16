# KISS Translator · 一键双语学习版

[English](README.en.md) · [下载发布包](../../releases) · [安装与使用](START-HERE.md) · [验证记录](VALIDATION.md)

在普通网页上单击悬浮翻译按钮，**保留原文，在下方追加译文；再次单击收起**。主要面向中英阅读，支持在线翻译与准备模型后的本机离线翻译。

当前版本：**`2.0.37-learning.8`（预发布）**。网页悬浮按钮从首次绘制就恢复保存的位置，新增长按 **650 毫秒**切换持续翻译锁定。锁定后，后续普通网页按当前服务自动翻译；默认未锁定，新网页等待手动操作。设置内的 **插件更新**、三种状态颜色、PDF 阅读器、Python 更新工具和安全修复继续保留。Chrome 内文件夹更新尚未完成真实安装环境的端到端验收；使用前请阅读[更新说明](UPDATING.md)、[PDF 阅读说明](docs/PDF-READER.md)与[安全与升级说明](SECURITY.md)。

这是基于 [Gabe / fishjar 及贡献者的 KISS Translator](https://github.com/fishjar/kiss-translator) 开发的独立学习分支，**不是原作者发布的官方版本**。基础版本为 2.0.32，保留上游作者信息与 [GPL-3.0 许可证](LICENSE)。

## 能做什么

| 使用方式     | 本学习版提供的功能                                                                | 使用条件                                                              |
| ------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 免费接口试用 | MyMemory 中英双向翻译；向导里直接测试、添加服务                                   | 无需账号、邮件或 Key；在线匿名限量服务                                |
| AI 翻译      | 豆包、Kimi、DeepSeek、千问、智谱、腾讯混元、硅基流动、OpenRouter 共 8 个 API 预设 | 填写自己的 Key 和已开通模型；免费、试用或收费取决于服务商与模型       |
| 自定义 AI    | OpenAI Chat Completions 兼容地址、模型、Key 和翻译偏好                            | 适用于自己的远程服务或本机兼容服务                                    |
| 本机离线     | Argos Translate 英中、中文双向推理                                                | 首次联网安装依赖和模型；之后运行本机服务                              |
| PDF 双语阅读 | Chrome 151+ 直接打开阅读器、单页 / 全文翻译、后两页预翻译、会话内恢复译文         | 默认只显示原文；基于随包提供的 Mozilla PDF.js，无 OCR 或译文 PDF 导出 |
| 后台网页     | 豆包 / Kimi 网页方式，使用同一浏览器的登录状态                                    | **实验性**，需要安装扩展并手动登录；未完成真实登录会话验收            |

网页翻译默认保留双语，随滚动处理后续内容。切换服务或目标语言时，先保留旧译文，成功后逐段替换；失败的段落保留旧译文。原有的划词、输入框、悬停、字幕、规则和同步等功能继续保留，但并未全部纳入本学习版验收。

网页与 PDF 侧边按钮会按实际请求状态显示进度环、完成勾号或错误图标。PDF 翻译中，环内方块可停止当前处理；网页按钮按原有点击方式停止或打开菜单。进入 **概览 → 悬浮翻译按钮颜色**，可调整空闲、翻译中、完成三种颜色，输入完整六位色值后自动保存，并同步到已打开页面。图标自动选择高对比黑 / 白色；恢复默认颜色不会改变按钮位置、隐藏设置或点击方式，系统减少动态效果设置也会生效。

网页按钮的位置会在首次绘制时直接恢复，避免先出现在角落再移到保存位置。打开新网页会创建新文档，扩展仍会在每个新文档中注入按钮，并沿用已保存的位置、点击偏好和三种颜色。切换翻译语言仍是当前页的翻译操作。

### 长按锁定持续翻译

- 长按网页悬浮按钮约 **650 毫秒**切换锁定；出现小锁徽标时，后续普通顶层网页、刷新和单页应用的新路径会自动开启翻译。启用锁定也会开启当前页翻译。
- 再次长按解锁，当前页已有译文保留，后续新网页不再自动翻译。默认普通单击只开关当前页，不改变锁定；保留旧菜单点击偏好的用户仍可从菜单操作。
- 按钮获得焦点后，按 **向下箭头**或 **Shift + F10** 打开菜单，选择锁定 / 关闭持续翻译锁定。拖动、松手或切走窗口会取消未完成的长按；成功长按后的松手不会额外触发一次单击。

锁定是当前浏览器配置中的本机持久偏好，与按钮位置和颜色分开保存；拖动或改色不会覆盖它。其他已经打开的标签只同步小锁标记，不会突然开始发送文本。未锁定时，旧网站 / 全局规则中保存的自动开启状态也不会使新网页自动翻译。按钮标题和状态播报会说明锁定状态；保存失败会提示重试，不能把失败当作已锁定。

网站黑名单与联网策略继续生效。网页锁定不会让 iframe 或 PDF 自动翻译，PDF 仍使用阅读器自己的翻译按钮和翻页设置。使用在线服务时，锁定后的新网页会向所选服务发送待译文本并使用相应额度。

AI 向导使用[固定中英翻译 Skill](TRANSLATION-SKILL.md)，可补充风格与术语偏好；MyMemory 是机器翻译接口，不使用聊天 AI Skill。预设不附带共享 Key。**免费聊天网页不等于免费 API，开源插件也不等于所有服务免费。**

## 安装与更新

目前提供可在 **Chrome / Edge** 加载的开发者模式安装包。

1. 在本仓库 [Releases](../../releases) 下载 `kiss-translator-learning-chrome.zip` 并解压。
2. Chrome 打开 `chrome://extensions`，或 Edge 打开 `edge://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的 **`chrome` 文件夹**，其中应直接包含 `manifest.json`。不要直接选择 ZIP 或源码目录。
4. 刷新一篇普通网页，单击网页边缘的翻译按钮；也可按 `Alt + Q`（Mac 为 `Option + Q`）。再次单击收起。

从源码构建时，对应安装目录是 `build/chrome`。浏览器设置页、扩展商店等受保护页面不能注入网页翻译；访问本地 HTML 需要在扩展详情中允许文件网址访问。

**Chrome 151+：** 本版通过官方 `mimeHandler` 接管顶层 PDF，在原地址直接显示阅读器，不接管网页内嵌 PDF。默认只读取并显示原文，点击翻译后才向所选服务发送文字；本地文件通过浏览器提供的 PDF 流读取，无需另开文件网址权限。页面中可关闭「打开 PDF 时直接使用双语阅读器」，或点击「返回 Chrome 原生阅读器」。其他浏览器是否支持这条路径，以实际 API 可用性为准。[Chrome 官方文档](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler)

**旧版浏览器或关闭接管后：** 打开 PDF，再点击扩展菜单的「翻译当前 PDF」或按 `Alt / Option + Q`，进入同标签翻译。直接读取本地 `file:///` 地址仍需文件网址权限；也可在阅读器点击「选择 PDF 并翻译」重选文件，无需该权限。设置里的「PDF 双语阅读」可打开空阅读器。

点击「翻译本页」或开启翻页翻译后，会优先翻译当前页并预翻译后两页，最多并发 2 个请求，消耗相应服务额度。翻页重排待处理任务，保留已在途请求；停止或换文件才取消任务并丢弃迟到结果。全文模式优先当前页，再处理其余页，命中缓存的段落不重复请求。译文会话缓存采用 LRU 淘汰，合计最多 80 页、8 MiB；同一文件和服务配置命中缓存时可恢复，刷新不会自动续发请求。手选文件刷新后需重选同一文件。扩展缓存使用 `storage.session`，浏览器会话结束清除；Web 预览使用 `sessionStorage`，浏览器恢复标签时可能保留，生命周期不同。详见 [PDF 阅读说明](docs/PDF-READER.md)。

同一 Release 另附独立的 `SHA256SUMS.txt` 和 `release-manifest.json`。下载后核对安装包或源码包的 SHA-256 与校验文件一致；发布清单记录版本、源码提交及包信息。具体内容见[发布说明](RELEASE-NOTES.md)。

**Chrome 内更新：** 在设置左侧打开 **插件更新**。开发者模式安装首次使用时，选择并授权 Chrome 真正加载的 `chrome` 文件夹；页面会写入一次随机纯文本探测文件，从本扩展地址读回核对，再清理探测文件，因此同版本副本不能代替安装目录。随后点击 **检查更新 → 下载并更新 → 重新加载插件**，最后刷新阅读标签。此流程不需要 Python、Git、Node.js、Token 或新增扩展清单权限；文件夹读写授权仍须由用户确认。

浏览器更新会先校验下载，再将最多 64 MiB 的旧文件内容保存为插件自身 IndexedDB 中的一份备份，然后逐文件写入，最后提交入口文件。**这不是整目录原子替换。** 写入失败会尝试恢复，页面关闭、断电或外部程序修改文件后可能需要手动恢复；完成恢复前不要重新加载。更新只使用固定仓库的公开 GitHub 发布和附件 CDN，不携带登录凭据或翻译 Key；「仅本机离线」会阻止浏览器内检查和下载。真实 Chrome 文件授权 / 更新完整流程尚未实测，当前证据为合成事务、存储、界面测试与构建检查。详见 [UPDATING.md](UPDATING.md)。

**保留的 Python 更新方式：** macOS 双击 `更新插件.command`，Windows 双击 `更新插件.bat`，需要 Python 3.9+；完成后仍须重新加载扩展并刷新阅读页。**不要同时运行浏览器更新和 Python 更新工具**，两者的备份与锁独立。通常无需卸载或清空设置；已有设置可能不会自动补入新预设，缺少 MyMemory 时可在向导添加，缺少 Argos 时按[手动添加步骤](offline/README.md#没有-argos-预置时手动添加)配置。商店中的上游版本与本学习版不同。

首次升级到 learning.8 后，务必先重新加载扩展，再刷新已打开的阅读标签，才能使用新的按钮位置与长按行为。锁定默认关闭，已有位置、配色和点击偏好保留。

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

首次启动会生成本机配对令牌。将终端显示的令牌填入 Argos 服务的 **Key** 字段并保存，旧版空 Key 配置也需要补填。不要把令牌提交到仓库或发给别人。

本机端点为 `http://127.0.0.1:8765/translate`。在「概览 → 联网策略」选择「仅本机离线」，将网页翻译服务设为「本机离线 · Argos」，刷新阅读页后使用。Windows 的虚拟环境 Python 路径为 `.offline\venv\Scripts\python.exe`；换电脑、模型准备和缺少预设的完整操作见 [Argos 使用说明](offline/README.md)，请求失败时参见[本机服务排错](docs/TROUBLESHOOTING.md#argos-本机服务)。

联网策略有「常规联网」「屏蔽谷歌」「仅本机离线」三档，约束插件内置请求层。它不会把云服务变成本地模型，也不控制网页自身联网或关闭电脑网络。离线阅读的网页本身需要提前加载或保存。

## 已验证到哪里

| 内容                     | 已完成                                                                                             | 尚未证明                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| MyMemory                 | 真实 HTTPS 中英双向请求成功；真实浏览器 Web 开发环境追加双语成功                                   | 中国特定运营商可达性、长期稳定性、无限免费                              |
| Argos                    | 真实模型中英双向推理；macOS 操作系统拒绝网络的独立进程验证；开发网页接入成功                       | 整台浏览器或电脑完全断网的所有行为                                      |
| 8 家 AI API              | 官方资料核对、请求与解析测试、配置向导测试                                                         | 未使用用户 Key 实调这 8 家云模型                                        |
| 豆包 / Kimi 网页         | DOM 夹具、后台消息、队列、取消和任务标记测试                                                       | 当前官网的真实登录会话兼容性                                            |
| Chrome / Edge 交付       | Chrome 生产包构建成功，供两者开发者模式加载                                                        | 最终包尚未在真实扩展环境安装验收；其他浏览器未验收                      |
| PDF 既有 Web 验证        | 真实 8 页论文解析、原稿绘制；屏蔽谷歌模式下 MyMemory 第一页 32 段翻译；后续自编三页 PDF 翻页与停止 | 全文 200 段未完整调用；本轮未实测 Argos PDF 翻译                        |
| learning.5 PDF 新路径    | 官方接口核对、合成测试与构建检查，结果见验证记录                                                   | 已安装的 Chrome 153 中，MIME 接管、预翻译与会话恢复完整流程尚未实机验收 |
| learning.7 Chrome 内更新 | 内存文件系统 / IndexedDB 事务夹具覆盖升级、回滚、取消、外部修改保护、目录探测和容量限制            | 真实 Chrome 的文件夹授权、磁盘写入、失败恢复与重新加载完整流程尚未验收  |
| learning.8 位置与锁定    | 首次渲染位置、真实组件组合中的长按 / 拖拽取消、键盘菜单与合成事件拒绝等自动回归                    | 合成事件测试不替代真实 Chrome 中长按、跨页持久锁定的完整安装验收        |

MyMemory 适配器测试 39 项通过，关联回归 7 套 221 项通过；学习版 2 的 AI 与关联回归曾有 26 套 561 项通过。这些是不同轮次的记录，不应相加当成一次全仓测试，也不能代替 Chrome MIME 与文件夹更新路径的安装验收。私人 PDF 不作为公开发布附件或测试样本。

- [MyMemory 真实请求回执](validation/free-api-live.json)
- [Argos 断网推理回执](offline/verified-offline.json)与[模型来源、版本和校验值](offline/model-receipt.json)
- [完整验证记录与复现命令](VALIDATION.md)

按标签和字节分片可以保留链接、代码及占位符，但会损失句子上下文。格式保留、测试通过都不代表译文完全准确。

## 从源码构建与学习

克隆本仓库或解压 `kiss-translator-learning-source.zip` 后，在包含 `package.json` 的目录运行。包含 PDF.js 的当前源码使用 **Node.js 24 / pnpm 11**；首次安装需要联网。learning.4 及更早发布包不包含本版 PDF 阅读器。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
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

打开 `http://127.0.0.1:4318/content.html` 查看网页翻译，`http://127.0.0.1:4318/options.html#/ai-services` 查看向导，或 `http://127.0.0.1:4318/pdf.html` 使用 PDF 阅读器。Web 预览读取远程 PDF 受 CORS 限制，失败时选择已下载的本地文件。Web 开发预览不能替代扩展环境验收。

MyMemory 与关联功能的定向测试：

```sh
CI=true node_modules/.bin/react-app-rewired test --watchAll=false --runInBand --runTestsByPath src/apis/myMemory.test.js src/config/api.test.js src/hooks/Api.test.js src/views/Options/Apis.test.js src/views/Options/AiServices.test.js src/views/Options/FreeApiTrial.test.js src/apis/trans.translate.test.js src/apis/index.test.js
```

`node src/scripts/test-free-api-live.cjs` 会向 MyMemory 发送少量合成句并消耗免费额度；普通自动测试使用模拟响应。Argos 与更完整的测试命令见 [VALIDATION.md](VALIDATION.md)。

建议从 [悬浮按钮](src/views/Action/ContentFab.js)、[整页翻译调度](src/libs/translatorManager.js)、[段落处理](src/libs/translator.js)、[服务请求](src/apis/trans.js)和 [MyMemory 适配器](src/apis/myMemory.js)开始阅读。

源码开始逐步迁移 TypeScript：第一批仅覆盖翻译进度与按钮配色，继续运行原有 JavaScript 验证。启动诊断的复现方法、体积前后对照、类型检查范围和下一轮拆分候选见 [渐进迁移记录](docs/MIGRATION.md)。

## 文档与来源

- [START-HERE.md](START-HERE.md)：安装、切换服务、离线准备与常见问题。
- [UPDATING.md](UPDATING.md)：Chrome 内更新、文件夹授权、恢复备份及保留的 Python 工具。
- [docs/PDF-READER.md](docs/PDF-READER.md)：PDF 接管、预翻译与会话缓存、在线与离线翻译、开源组件与限制。
- [AI-SERVICES.md](AI-SERVICES.md)：免 Key 试用、8 个 AI 预设、自定义 API、后台网页与计费边界。
- [TRANSLATION-SKILL.md](TRANSLATION-SKILL.md)：固定翻译指令、偏好与限制。
- [SECURITY.md](SECURITY.md)：安全修复、密钥处理、升级兼容性与报告方式。
- [VALIDATION.md](VALIDATION.md)：测试证据、实际返回、验证边界及复现命令。
- [docs/MIGRATION.md](docs/MIGRATION.md)：TypeScript 渐进迁移、启动测量及每轮工程决策。
- [offline/README.md](offline/README.md)：Argos 模型准备、本机服务与离线验证。
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)：安装、请求失败及常见故障排查。
- [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md)：学习版版本、打包与发布流程。
- [RELEASE-NOTES.md](RELEASE-NOTES.md)：当前版本变更、发布文件与校验说明。
- [custom-api_v2.md](custom-api_v2.md)：保留的上游高级 Custom 接口协议说明，与向导的 Chat Completions 接口不同。
- [上游基础提交](https://github.com/fishjar/kiss-translator/commit/2656f564dde5b271a8d3fb31e951a8457e8df41c)与[该提交的 README](https://github.com/fishjar/kiss-translator/blob/2656f564dde5b271a8d3fb31e951a8457e8df41c/README.md)。

基础源码于 2026-09-14 获取，原作者为 Gabe / fishjar 及上游贡献者。本学习版修改继续使用 [GPL-3.0](LICENSE)。发布包附带许可证，并提供对应源码包；源码 ZIP 不包含 `.git` 历史、账号配置、依赖目录或已下载模型。学习版问题请反馈到本仓库，避免将修改版行为误报为上游官方版本的问题。
