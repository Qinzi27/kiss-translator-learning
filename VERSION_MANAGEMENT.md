# 学习版版本与发布

本分支基于上游 2.0.32。Chrome 的数字版本使用 `public/manifest.json` 的 `version`，当前为 `2.0.33`；学习版标识使用 `version_name`，当前为 `2.0.33-learning.4`，GitHub 标签对应 `v2.0.33-learning.4`。

更新学习版时同步修改 `version_name`、README 和 `RELEASE-NOTES.md`。若需要提升浏览器数字版本，使用保留的 `pnpm version:*` / `pnpm sync-version` 脚本同步 package.json、.env 和各平台清单，再检查学习版 `version_name`。

## 发布步骤

1. 确认 Git 远程指向自己的学习版仓库，保留上游作者和 GPL 许可；不要向 fishjar 上游直接推送学习版产物。
2. 更新文档和验证边界，运行 README / VALIDATION 中与修改有关的测试；真实接口测试会联网，按需明确执行。
3. 检查 `git diff --check` 和待提交文件，提交代码；模型、依赖、用户 Key、日志及内部交接文件不得进入仓库。
4. 从该提交构建和打包：

   ```sh
   pnpm install --frozen-lockfile
   pnpm build:chrome
   python3 src/scripts/package-learning.py
   ```

5. 检查 `releases/release-manifest.json` 的提交号、版本及工作区状态。生产构建和测试必须另外成功；打包脚本只验证清单与包结构，不证明功能通过。
6. 在该提交创建版本标签和 GitHub Release，附 `RELEASE-NOTES.md` 内容；当前学习版应标记为预发布。
7. 上传两个 ZIP、`SHA256SUMS.txt` 和 `release-manifest.json`，确认下载可用、SHA-256 一致，并列提供对应源码。

源码 ZIP 不包含 Git 历史，不能直接从无 `.git` 的目录重新制作源码包；重新发布请克隆本仓库。源码包本身可以直接安装依赖并构建扩展。

## GitHub Actions

`.github/workflows/release.yml` 已改为手动运行的 **Build learning edition**：运行全套 JavaScript 回归、离线服务合成测试和依赖审计，构建 Chrome、生成 ZIP 和校验文件并保存构建产物。它不会在标签推送后自动发布 Release 或部署 Pages；首次 fork 后可在 Actions 页面按需启用并运行。

上游的全平台构建脚本与发布技能仍保留供学习，其 `dev → master` 发版规则不作为本学习分支的默认流程。其他平台的产物不属于本次发布验收范围。
