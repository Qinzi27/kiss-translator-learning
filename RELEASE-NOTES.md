# 2.0.35-learning.6 · 本地一键更新

基于 fishjar/kiss-translator 2.0.32 的非官方 GPL-3.0 学习版。此次预发布增加无需打开 GitHub 网页的本地更新工具，保留 PDF 一键双语、后两页预翻译、会话缓存及既有安全修复。

## 本次更新

- **双击更新。** macOS 运行安装目录里的 `更新插件.command`，Windows 运行 `更新插件.bat`。需要 Python 3.9+ 和能连接 GitHub 的网络，无需登录、Token、Git 或 Node.js。
- **下载、校验、备份与替换。** 只接收本学习版完整发布，包括预发布。核对同一发布的 SHA-256、清单、版本和大小，安全解压后在原路径替换，保留一份可回退备份。失败时保留或尽力恢复旧文件；支持只检查和手动回退。
- **保留安装位置与设置。** 不卸载扩展，不读取浏览器配置、API Key、Cookie、PDF 或模型。更新成功后仍需在扩展管理页点一次「重新加载」，并刷新阅读标签。
- **学习版更新入口。** 关于页展示本地更新步骤；修正原来指向上游仓库的链接，学习版不再自动查询上游站点的版本号。

## 下载与使用

- `kiss-translator-learning-chrome.zip`：扩展、许可证、文档和更新工具。首次安装仍在浏览器加载其中的 `chrome` 文件夹。保留同层的 `updater` 文件夹和两个启动器。
- `kiss-translator-learning-source.zip`：对应 GPL 源码和更新器测试，不含依赖、模型、个人文件或账号配置。
- `SHA256SUMS.txt` 和 `release-manifest.json`：安装包校验值、版本及对应提交。

旧版补入工具、Python 准备、回退和排错见 [一键更新说明](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.35-learning.6/UPDATING.md)。初次安装见 [START-HERE](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.35-learning.6/START-HERE.md)，PDF 阅读方式见 [PDF 指南](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.35-learning.6/docs/PDF-READER.md)。

## 验证与边界

本次测试、真实发布下载与临时目录验证结果见 [VALIDATION](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.35-learning.6/VALIDATION.md)。这仍是已解压的学习版，更新工具不能让 Chrome 静默安装文件，更新后需手动重新加载。工具只替换 `chrome` 内容，不自更新外部脚本，也不更新源码、Python、模型或设置；重新加载可能清除 PDF 会话缓存。

下载仍依赖 GitHub API / 附件网络，断网或被屏蔽时会停止并保留当前版本。校验来自同一发布仓库，不是独立签名。Chrome 153 的 PDF MIME 接管、Windows 启动器及安装后的完整阅读流程仍保留实机验收边界；不把合成测试或打包成功当作全平台验收。
