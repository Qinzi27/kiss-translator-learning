# 2.0.36-learning.7 · Chrome 内更新与翻译状态

基于 fishjar/kiss-translator 2.0.32 的非官方 GPL-3.0 学习版。本次预发布增加 Chrome 内更新面板，以及网页和 PDF 侧边按钮的实时翻译状态与可调颜色。

## 本次更新

- **Chrome 内更新。** 打开插件设置 → 插件更新。首次选择并授权 Chrome 当前加载的 `chrome` 文件夹，检查版本后点击「下载并更新」，完成后点击「重新加载插件」。目录识别、下载校验、备份和恢复在面板中完成，无需打开 GitHub 网页或终端。旧版先更新到本版并重新加载，才会出现入口。
- **看得见翻译进度。** 点击网页侧边按钮后立即进入准备/排队状态，等待真实请求结束后再显示完成；进度环、颜色和图标区分翻译中、完成及错误。PDF 翻译期间显示进度环和停止图标，按钮仍可停止。切换服务和迟到结果不会串入新一轮状态。
- **自己调颜色。** 设置 → 概览 → 悬浮翻译按钮颜色，可调整待机、翻译中、完成三种颜色，支持色盘、十六进制输入、预览和恢复默认。网页与 PDF 即时同步，前景自动匹配对比度。
- **停止后不再重试旧任务。** 清理任务队列同时取消退避重试，旧请求晚到不会继续重试或覆盖新一轮状态；已发送到服务端的请求不能撤回。

## 下载与使用

- `kiss-translator-learning-chrome.zip`：扩展、许可证、文档及保留的 Python 更新工具。首次安装仍加载其中的 `chrome` 文件夹。
- `kiss-translator-learning-source.zip`：对应 GPL 源码与测试，不含依赖、模型、个人文件或账号配置。
- `SHA256SUMS.txt` 和 `release-manifest.json`：附件校验值、版本及对应提交。

具体步骤见 [更新说明](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.36-learning.7/UPDATING.md) 和 [安装说明](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.36-learning.7/START-HERE.md)。

## 验证与边界

验证记录见 [VALIDATION](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.36-learning.7/VALIDATION.md)。更新面板只用于开发者模式安装；文件选择授权由 Chrome 决定。浏览器内更新采用逐文件提交与最多一份 64 MiB 的本机 IndexedDB 备份，不是整个目录原子替换；中断时尝试恢复，强制关闭或失电可能需要下次打开面板手动恢复。更新时保持页面打开，不要同时运行 Python 更新工具。重新加载后刷新阅读标签，PDF 会话缓存可能被清除。

仅本机离线模式不会联网更新；GitHub 不可达时保留当前文件。校验信息来自同一仓库，不是独立签名。没有新增权限、依赖或共享 Key。真实公开下载与解包已验证；Chrome 原生文件授权/写入/重新加载的完整流程，以及 PDF MIME 实机接管、Windows 启动器仍保留实机验收边界。
