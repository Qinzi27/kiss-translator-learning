# 渐进迁移与启动测量

记录日期：2026-09-16（Australia/Sydney）。第 1 轮基于已发布的 `v2.0.37-learning.8` / `7b4b9b831a8051206b4b14339f8fe8ff33a31eab`，在 `codex/typescript-migration-phase1` 分支开发。该轮是源码工程改进，尚未分配新安装包版本；不要用相同版本覆盖已发布附件。

## 决策：先建立类型边界和基线

此前按钮跳动来自首帧位置恢复时序，learning.8 已处理。换语言不会自动缩短服务响应或解决页面生命周期问题。本轮保留既有 JavaScript/React 架构，以两个独立模块建立严格类型边界：

| 模块                              | 新边界                                     | 保留的运行行为                                     |
| --------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `src/libs/translationProgress.ts` | 进度阶段、只读快照与订阅、任务结果、控制器 | 准备超时、取消、重开、迟到任务隔离、计数与状态文案 |
| `src/libs/fabAppearance.ts`       | 未知设置输入、已验证颜色、前景色结果       | 六位颜色校验、默认回退、各状态配色、黑白对比色     |

原有 `.js` 测试和无扩展名的 import 保留。`allowJs: true` 允许混合工程；`checkJs: false` 表示**尚未对整仓 JavaScript 做类型检查**。`strict: true` 约束已迁移的 TS 模块。类型契约位于 `type-tests/translation-ui.test.ts`，由 `tsc --noEmit` 检查，既有合法用法必须成立，`@ts-expect-error` 标记的非法用法必须被拒绝；这些文件不进入扩展入口，也不由 Jest 执行。

将原本锁文件中已有的 TypeScript **4.9.5** 声明为直接开发依赖，沿用 react-scripts 5 的现有兼容组合。未更新其他依赖版本，未增加运行时库。当前边界使用 DOM 类型，不自动引入 Node/React 的环境声明；后续迁移相应模块时再显式配置兼容类型。格式化支持 `.ts`/`.tsx`，源码打包保留它们；产物仍为浏览器执行的 JavaScript。

## 已建立的两类测量

### 生产构建体积

工具 `src/scripts/measure-build.cjs` 离线读取构建目录，不执行 bundle、不联网。它核对 manifest、生成 HTML 和 asset-manifest 声明的文件存在且非空，记录各入口、所有 JS、整个构建的原始字节、逐文件 gzip 字节和 SHA-256。它不解析动态拼接的资源 URL，文件完整不代表运行一定成功。

```sh
pnpm build:chrome
pnpm measure:build --build-dir build/chrome --output build-metrics.json
```

输出文件的父目录须已存在，且不能位于被测构建目录内。旧版基线已与保留的公开 learning.8 安装包逐入口 SHA-256 对照一致。此轮正常 Chrome 构建对比如下：

| 入口                        | 迁移前原始字节 | 迁移后原始字节 |                变化 | 迁移前/后 gzip 字节 |
| --------------------------- | -------------: | -------------: | ------------------: | ------------------: |
| 网页 content.js             |      2,020,315 |      2,021,435 | +1,120（约 0.055%） |   565,307 / 565,612 |
| 后台 background.js          |        830,227 |        830,227 |                   0 |   218,886 / 218,886 |
| 选项页（含声明的 HTML/CSS） |      2,140,777 |      2,140,810 |                 +33 |   591,570 / 591,586 |
| PDF 页（含声明的 HTML/CSS） |        882,367 |        882,400 |                 +33 |   238,447 / 238,458 |

这是体积比较，**不是启动时间比较，也没有证明 TypeScript 提速**。正常构建中核对不到启动计时标记或诊断日志字符串；记录器只在诊断构建中启用。第一轮仍保留同步可达的界面依赖，未宣称完成瘦身。

### 本地启动分段计时

```sh
pnpm exec cross-env REACT_APP_STARTUP_PROFILE=true PORT=4319 BROWSER=none pnpm start
```

打开本机 `http://127.0.0.1:4319/content.html`，在开发者工具 Console 筛选 `[KISS startup profile]`，或在 Performance 面板查看 `kiss-startup:` User Timing 条目。每次完整刷新获得独立样本。至少固定页面、设置、浏览器版本、前后台状态与缓存条件，再比较同类构建；不要拿开发构建和生产构建互相推断性能。

计时从 `common.run()` 内开始，依次覆盖迁移、设置读取、规则匹配、词表、按钮设置和 Manager 初始化；最终记录 `total:ready/skipped/error`，按钮 layout effect 记录首次 `fab-commit`。**静态 import 的解析/执行、脚本下载、浏览器注入等待不包含在内；commit 不是 paint，也不是首段译文时间。** 隐藏按钮或受限页面可能没有 commit，应保留该结果，不当作零毫秒。

诊断开关仅由构建环境启用；普通网页消息和查询参数不能打开它。测量只含固定阶段名、序号和耗时，没有原文、URL、设置或凭据，不发送网络请求。内存与 User Timing 最多保留最近 4 次运行，每次最多 32 个阶段、一个总计和一个首次 commit；控制台历史由浏览器管理。被淘汰运行的晚到回调不再记录。计时 API 不存在或抛错时，翻译继续运行。

本轮在 Codex 内置浏览器、本机开发预览、未锁定且没有点击翻译的条件下，连续完整刷新 3 次：

| 样本 | 初始化总计 | Manager 创建 | 首次 FAB layout commit（从 run 开始） |
| ---- | ---------: | -----------: | ------------------------------------: |
| 1    |     5.0 ms |       3.9 ms |                               19.8 ms |
| 2    |     4.7 ms |       3.9 ms |                               19.4 ms |
| 3    |     5.8 ms |       4.9 ms |                               27.4 ms |

该小样本用于验证测量路径，不是 Chrome 已安装扩展的冷启动基准，也没有迁移前同环境计时对照，不能据此计算加速比例。诊断本身也有计时和控制台开销。原始分段与构建摘要见 [typescript-phase1.json](../validation/typescript-phase1.json)。

## 继续使用同一套验证

```sh
pnpm install --frozen-lockfile
pnpm typecheck
CI=true pnpm test --watchAll=false --runInBand
python3 -m unittest discover -s offline -p 'test_*.py'
python3 -m unittest discover -s updater -p 'test_*.py'
pnpm build:chrome
pnpm measure:build --build-dir build/chrome --output build-metrics.json
```

本轮完整 JavaScript 回归 **183 套 / 2973 项通过**，原来的 181 套 / 2950 项均保留；新增 7 项诊断生命周期测试、16 项体积工具/CLI 测试。随后对最终诊断编译开关定向再验 2 套 / 42 项，通过；重叠用例不相加。严格类型检查、修改文件 ESLint、Chrome 生产构建、离线服务 29 项及更新器 30 项均通过。手动 Actions 增加类型检查和体积报告，保留原有 JavaScript、离线、更新器、审计与打包步骤；本机验证不代表远端 CI 已执行。

已用现有缓存完成冻结锁文件的离线安装检查。临时 Git 夹具中运行真实打包脚本，核对源码 ZIP 包含迁移后的 `.ts`、类型契约和 tsconfig、排除已删除的旧 `.js`；Chrome 执行目录不含 `.ts`/`.tsx`。夹具随后清除，本机保留的 learning.8 发布附件字节未变。

此前 MyMemory、Google 被屏蔽、Argos 本机断网推理和真实公开更新下载的脚本与历史回执继续保留。本轮没有重跑真实云 API、模型断网或 Chrome 目录写入；历史证据不能冒充本轮结果。Chrome 受保护扩展页的实机操作限制也继续适用。完整历史见 [VALIDATION.md](../VALIDATION.md)。

## 下轮候选与验收条件

静态依赖链为 `content.js → common → TranslatorManager → Fab/Popup/Transbox/RuleEditor`，其中包含 ReactDOM、Emotion、MUI；划词界面经 `TranForm → AiDictCont` 同步引入 Markdown 渲染。候选是只在 AI 字典实际显示时加载 Markdown 渲染器，先验证普通翻译和按钮启动不依赖它，再比较 content.js 与总 JS 体积、冷/暖启动耗时。

真正实施懒加载前需覆盖加载中与加载失败的文字回退、页面已关闭/取消后的迟到模块、Chrome 内容脚本分包的资源可访问声明及 CSP。现有发布版可作为回退基准，每批迁移独立提交、保留行为测试，完成实机验证后再发布新安装版本。

参考：[TypeScript allowJs](https://www.typescriptlang.org/tsconfig/allowJs.html)、[checkJs](https://www.typescriptlang.org/tsconfig/checkJs.html)、[Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)。本项目继续保留上游作者和 GPL-3.0；工程记录用于说明本分支新增的实现、验证和未完成项。
