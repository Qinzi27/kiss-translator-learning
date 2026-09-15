#!/bin/bash
# Keep this launcher beside the chrome/ and updater/ directories.
updater_root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)" || exit 1
updater_status=1
if command -v python3 >/dev/null 2>&1; then
  python3 "$updater_root/updater/update.py" "$@"
  updater_status=$?
else
  printf '%s\n' '需要 Python 3.9 或更高版本。请先安装 Python 3，再运行此工具。' \
    '说明：同一文件夹中的 UPDATING.md。'
fi
if [ -t 0 ] && [ "$#" -eq 0 ]; then
  printf '\n%s' '按回车关闭此窗口…'
  read -r updater_reply
fi
exit "$updater_status"
