# 2.0.34-learning.5 · PDF 一键双语与预翻译缓存

基于 fishjar/kiss-translator 2.0.32 的非官方 GPL-3.0 学习版。此次预发布增加浏览器 PDF 阅读，继承 learning.4 的安全修复。

## 本次更新

- **直接打开 PDF 阅读。** Chrome 151+ 使用官方 MIME 接口，双击本地 PDF 或打开 PDF 链接后，原地址保留，页面直接显示原稿和翻译按钮。只接管顶层 PDF；打开时只读取原文，点击翻译才调用所选服务。页面内可关闭自动接管或返回 Chrome 原生阅读器。
- **阅读时一键翻译。** 页面右侧浮动按钮可以翻译当前页或停止任务；支持全文翻译、中英切换、保留旧译文并逐段替换。旧版 Chrome / Edge 仍保留插件按钮和 Alt / Option + Q 入口。
- **提前翻译后面 2 页。** 当前页优先，最多同时处理 2 个翻译请求；翻页优先处理所读页面，停止后取消排队任务并忽略迟到结果。
- **有上限的临时缓存。** 扩展使用浏览器内存会话存储，最多 80 个页面分区 / 8 MiB，超限淘汰最久未使用内容。按文件内容、服务配置、语言和段落指纹隔离；不保存 PDF 文件或 API 密钥。浏览器会话结束清除，刷新后可恢复已缓存译文，恢复本身不自动调用翻译服务。
- **本地读取与联网翻译分开。** PDF.js 6.3.289 和 Worker、字符映射、字体、许可证全部随包分发。选择云服务时，当前页及预取页的文本会发给该服务；使用本机 Argos 则沿用本机推理配置。

Chrome 官方 MIME 路径读取浏览器已经收到的 PDF 流，本地文件不需要另开文件网址权限；不会重新请求原下载地址。旧浏览器的手动 file:// 入口仍需文件网址权限，也可用「选择 PDF 并翻译」直接选择文件。**由文件选择器打开的文件，刷新后需重选同一文件才能恢复缓存**，因为缓存不保存 PDF 原件。Chrome 151 以下不会注册自动接管。

## 下载与更新

- `kiss-translator-learning-chrome.zip`：解压后加载其中的 `chrome` 文件夹。已安装者保留原文件夹位置，替换内容，在扩展管理页点击「重新加载」，再重新打开 PDF。
- `kiss-translator-learning-source.zip`：与本版对应的 GPL 源码，不含依赖、模型、个人文件或账号配置。
- `SHA256SUMS.txt` 和 `release-manifest.json`：安装包校验值、版本及对应提交。

安装方法与 PDF 说明见 [START-HERE](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.34-learning.5/START-HERE.md) 和 [PDF 阅读指南](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.34-learning.5/docs/PDF-READER.md)。

## 验证与限制

本版的完整自动回归、依赖审计、生产构建和测试边界记录在 [VALIDATION](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.34-learning.5/VALIDATION.md)。此前已用公开论文和自编 PDF 在 Web 预览完成真实 MyMemory 翻译；本地手册解析与 Argos 单句测试也有记录。此次 MIME 接管和预取缓存以合成测试验证，**尚未完成安装后的 Chrome / Edge 端到端验收**，因此保持预发布。用户 PDF 不随源码或安装包发布。

扫描件需要先做 OCR；复杂公式、双栏、横向表格需对照原稿。本版不导出保持版式的中文 PDF。免费接口可能有额度和地区限制，预翻译同样消耗所选服务额度；网页 AI 和 8 家 Key 预设的真实账号兼容性仍需用户验证。

Web 开发预览使用标签页 sessionStorage，与扩展的 storage.session 生命周期不同，浏览器恢复会话时预览缓存可能保留；会话关闭清除的承诺针对扩展版本。安全修复与旧配置迁移见 [SECURITY](https://github.com/Qinzi27/kiss-translator-learning/blob/v2.0.34-learning.5/SECURITY.md)。
