# Argos：首次准备与离线使用

Argos 在自己的电脑上进行中英翻译，扩展通过 `http://127.0.0.1:8765/translate` 调用它。**先联网安装引擎、下载模型并预热；之后启动服务与推理可以离线完成。** 扩展 ZIP 和源码 ZIP 都不内嵌 `.offline` 目录中的依赖或模型。

现有真实验收环境为 macOS Apple Silicon、Python 3.12.9、Argos Translate 1.11.0、官方 en↔zh 1.9 模型。下文也提供 Windows 和 Linux/Intel Mac 的准备方式，但没有将它们标为已实测平台。完整证据见 [验证记录](../VALIDATION.md)。

## 取得脚本与 Python

从 [同一 GitHub Release](https://github.com/Qinzi27/kiss-translator-learning/releases/tag/v2.0.33-learning.4) 下载 `kiss-translator-learning-source.zip` 并解压，或使用同一版本的源码仓库。在包含 `offline`、`src` 和 `package.json` 的**源码项目根目录**打开终端。发布的 Chrome ZIP 根目录也附带 `offline` 脚本；使用它时，在与 `offline` 同级的目录运行下列命令，不是在里面的 `chrome` 子目录运行。只加载浏览器扩展不会自动执行准备或启动服务。

以下命令按 Python 3.12 编写。安装 Python 后先确认 `python3.12 --version`，Windows 使用 `py -3.12 --version`。命令找不到时先解决 Python 安装/路径，不要改用系统中不明版本的环境。

## 首次联网准备

macOS / Linux：

```sh
python3.12 -m venv .offline/venv
.offline/venv/bin/python -m pip install -r offline/requirements.txt
.offline/venv/bin/python offline/prepare.py
.offline/venv/bin/python offline/verify.py
```

Windows PowerShell：

```powershell
py -3.12 -m venv .offline\venv
.\.offline\venv\Scripts\python.exe -m pip install -r offline\requirements.txt
.\.offline\venv\Scripts\python.exe offline\prepare.py
.\.offline\venv\Scripts\python.exe offline\verify.py
```

`requirements.txt` 固定 Argos 1.11.0，其他依赖按目标平台解析。要复现上述 **macOS Apple Silicon + Python 3.12** 的依赖快照，将安装命令里的文件名改为 `offline/requirements-macos-arm64.txt`；其他平台不要照搬这一快照。它不是所有系统通用的锁文件。

`prepare.py` 访问官方索引并安装中英两个方向的模型，还会运行两句合成文本，让分句模型在联网时准备好。下载涉及 PyPI、GitHub 和 Argos 模型站，不要求谷歌翻译可用。索引未来可能提供不同版本，以本机生成的记录为准。本次记录的两个模型压缩包合计约 145 MB；连同依赖和解压模型的实际磁盘占用会因系统而变化。

`verify.py` 在新进程中先拒绝 Python 出站连接，再加载模型进行双向推理；只有两句都得到有效译文才算通过。缺失文件会报错，不会在此步骤悄悄联网补下载。不要仅凭 `/health` 可访问就认定模型已准备完成。

准备后的本机记录位于：

| 路径（相对于源码根目录）                | 内容                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| `.offline/model-receipt.json`           | 本次准备的模型版本、来源与下载哈希；复用已安装模型时记录其版本 |
| `.offline/offline-verification.json`    | 这台电脑的新一轮离线推理结果                                   |
| `.offline/packages`                     | 解压后的中英翻译模型                                           |
| `.offline/data/argos-translate/minisbd` | 预热下载的分句模型                                             |
| `.offline/venv`                         | 当前系统的 Python 虚拟环境                                     |
| `.offline/pairing-token`                | 首次启动服务时生成的本机配对令牌，不随源码或模型分发             |

仓库中的 `offline/model-receipt.json` 与 `offline/verified-offline.json` 是开发时保留的历史证据，不能证明新电脑也已安装成功。新电脑应以自己运行 `verify.py` 的结果为准。

## 每次使用：启动、检查与停止

完成一次准备后，不必再运行 `prepare.py`。在源码根目录启动服务：

```sh
.offline/venv/bin/python offline/server.py
```

Windows：

```powershell
.\.offline\venv\Scripts\python.exe offline\server.py
```

终端出现 `Argos offline service: http://127.0.0.1:8765` 后保持运行。首次启动会在 `.offline/pairing-token` 生成随机配对令牌；macOS / Linux 的文件权限为 `0600`（仅当前用户读写）。交互终端会显示令牌供本人复制；重启服务复用同一令牌。Windows 应把项目保存在只有自己账号可以访问的个人目录，POSIX 的 `0600` 不等于 Windows ACL。

标准输出不是终端时（例如重定向到文件），服务不会显示令牌；后台进程若仍连接终端，仍可能显示。本人可用本机文本编辑器打开 `.offline/pairing-token`，复制其中的一行内容。不要提交、分享令牌或带令牌的设置备份；发布包不包含这个文件。需要重新配对时，先停止服务，将此文件移出项目妥善保管或删除，再启动生成新令牌，更新扩展 Key。旧令牌随即失效。

在浏览器打开 `http://127.0.0.1:8765/health` 可检查监听服务是否就绪；无需令牌，只返回 `{"status":"ok"}`，不会加载模型，也不证明翻译已经可用。

在扩展设置中：

1. **翻译服务 → 本机离线 · Argos → 编辑**，将令牌粘贴到 **Key**（只填令牌，不加 `Bearer ` 前缀），点击 **保存**。旧版留空 Key 的配置也必须补上；Custom 会自动发送 `Authorization: Bearer …`。
2. **概览 → 联网策略**选择 **仅本机离线**。
3. 在网页面板选择 **本机离线 · Argos**；或进入 **网页翻译 → 全局规则 → 编辑**，选择它并点击 **保存**。
4. 刷新已打开的阅读页，点击悬浮按钮。真正断网前应先打开或保存网页，扩展不能在断网后下载未缓存的文章。

服务固定监听本机 `127.0.0.1:8765`，所有翻译请求都必须带配对令牌，不是局域网共享服务。只运行一份即可，所有阅读页共用它。首次推理可能较慢，扩展接口应使用 **60 秒超时、并发 1**。服务每份请求正文最多 80,000 字节，必须在 5 秒内完整送达；最多同时处理 8 个 HTTP 连接、排队 8 个，模型推理始终并发 1。原文支持自动判断或明确选择中/英文，目标使用简体中文或英文；模型不提供可靠的繁简转换。

停止时，在运行服务的终端按 `Ctrl + C`。下次重新运行 `server.py` 即可，关闭浏览器不会替你关闭这个终端服务。服务停下后，页面已有译文可继续显示，但新请求会失败；可再次点击翻译按钮收起旧文。电脑重启后需要重新启动服务，本项目没有自动注册开机启动项。

## 没有 Argos 预置时手动添加

新安装含有预置，但旧设置或导入的服务列表可能覆盖它。无需清空设置，在 **翻译服务 → 添加 → Custom** 创建一项：

| 字段                        | 内容                              |
| --------------------------- | --------------------------------- |
| 接口名称                    | `本机离线 · Argos`                |
| URL                         | `http://127.0.0.1:8765/translate` |
| Key                         | 本机 `.offline/pairing-token` 的完整令牌，不加 `Bearer ` 前缀 |
| Request Hook、Response Hook | 无需配置；历史文本不会执行            |
| 自定义请求头、请求体        | 留空                              |
| 聚合发送、流式传输          | 关闭                              |
| 最大并发请求数量            | `1`                               |
| 请求超时时间                | `60` 秒                           |

保存并测试，然后刷新阅读页并选择该项。这里是本项目 `server.py` 对上游 Custom 协议的适配；把 URL 换成其他翻译服务不会自动获得相同协议。

## 换电脑或移动项目

目标电脑能够联网时，最可靠的流程是解压同一版本源码，在目标电脑重新创建虚拟环境，执行首次准备与验证。不要直接搬运 `.offline/venv`：其中的路径、Python 可执行文件和本机库与操作系统、架构绑定；移动整个项目目录后也应重建它。

目标电脑不能联网时：

1. 在能联网且具有**相同操作系统、CPU 架构和 Python 版本**的准备电脑上完成前述安装、预热和验证。
2. 转移同一版本源码，以及 `.offline/packages`、`.offline/data/argos-translate/minisbd`，放回目标项目的相同相对位置。
3. 在准备电脑收集匹配目标系统的依赖 wheel 文件，再转移到目标机。下面使用通用 requirements；若使用 macOS ARM64 快照，两处命令应使用同一个快照文件。

```sh
# 联网准备电脑；若某依赖没有匹配 wheel，此步骤会明确失败。
.offline/venv/bin/python -m pip download --only-binary=:all: -r offline/requirements.txt -d wheelhouse

# 目标电脑：先用目标机自身的 Python 3.12 新建虚拟环境。
python3.12 -m venv .offline/venv
.offline/venv/bin/python -m pip install --no-index --find-links wheelhouse -r offline/requirements.txt
.offline/venv/bin/python offline/verify.py
```

Windows 对应使用上文的 `py -3.12` 和 `.\.offline\venv\Scripts\python.exe` 路径。缺少适合目标系统的 wheel 时，应先在匹配系统上补齐；不要认为复制一个 macOS 虚拟环境到 Windows 即可使用。迁移流程是按脚本结构提供的操作指引，尚无跨平台迁移实测记录。

不要随模型复制 `.offline/pairing-token`。目标电脑首次启动服务会生成自己的令牌，在目标浏览器重新填写 Argos Key。

验证失败且提示分句或翻译模型缺失时，应在可联网的准备环境补齐后重新转移。离线目标机不要反复运行 `prepare.py`，因为该命令会访问在线模型索引。

## 网络隔离的范围

服务启动时通过 Python 审计钩子禁止 Python 出站 socket 连接和外部命令，仍可接受本机浏览器请求。这是进程内限制，不等同于操作系统防火墙对所有本机库的限制。扩展的「仅本机离线」也不限制网页自身或其他软件联网。

HTTP 请求要求明确的 `127.0.0.1:8765` 或 `localhost:8765` Host，拒绝其他域名。允许扩展来源以及固定预览来源 `http://127.0.0.1:4318`、`http://localhost:4318`；无 Origin 的本机客户端也可以调用，但翻译同样需要令牌。Origin / CORS 不是鉴权替代品。

macOS 可额外对**独立验证进程**拒绝操作系统网络权限：

```sh
sandbox-exec -f offline/deny-network.sb .offline/venv/bin/python offline/verify.py --require-os-network-denied
```

该命令只用于 `verify.py`，不是 HTTP 服务的启动命令；完全拒绝网络的服务也无法接受本机 HTTP 请求。其他平台的普通 `verify.py` 结果不能被记录成 macOS 这一系统级验证。

富文本适配优先保留网页标签和占位符，按标签边界翻译可能降低语序及标点质量。错误代码与排查顺序见 [排错说明](../docs/TROUBLESHOOTING.md)。
