#!/usr/bin/env python3
"""Update only an existing learning-edition Chrome folder; Python >= 3.9.

No credentials, package manager, downloaded executable or browser-profile access.
Checksums are integrity evidence from the same HTTPS release, not signatures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager

REPOSITORY = "Qinzi27/kiss-translator-learning"
HOMEPAGE = "https://github.com/" + REPOSITORY
API_URL = "https://api.github.com/repos/" + REPOSITORY + "/releases"
CHROME_ZIP = "kiss-translator-learning-chrome.zip"
SOURCE_ZIP = "kiss-translator-learning-source.zip"
RECEIPT = "release-manifest.json"
SUMS = "SHA256SUMS.txt"
ASSETS = (CHROME_ZIP, SOURCE_ZIP, RECEIPT, SUMS)
VERSION_RE = re.compile(r"^(?:v)?(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:\.(\d{1,5}))?-learning\.(\d{1,8})$")
MAX_METADATA = 2 * 1024 * 1024
MAX_ARCHIVE = 96 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 10000
MAX_CENTRAL_DIRECTORY = 8 * 1024 * 1024
MAX_SECONDS = 180
CORE_FILES = ("manifest.json", "background.js", "content.js", "popup.html", "options.html")
RESERVED = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", re.I)


class UpdateError(Exception):
    pass


def version_key(value):
    match = VERSION_RE.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise UpdateError("版本不是受支持的 learning 版本。")
    return tuple(int(part or 0) for part in match.groups())


def read_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise UpdateError("JSON 包含重复字段。")
            result[key] = value
        return result
    try:
        return json.loads(data, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as error:
        raise UpdateError("无法读取发布 JSON。") from error


class Deadline:
    def __init__(self, seconds=MAX_SECONDS):
        self.end = time.monotonic() + seconds

    def check(self):
        left = self.end - time.monotonic()
        if left <= 0:
            raise UpdateError("更新超过总时限，已停止；可稍后重试。")
        return min(10, left)


def asset_url(tag, name):
    if not isinstance(tag, str) or not tag.startswith("v"):
        raise UpdateError("发布标签无效。")
    version_key(tag)
    if name not in ASSETS:
        raise UpdateError("发布附件名无效。")
    return HOMEPAGE + "/releases/download/" + tag + "/" + name


def trusted_url(url, initial=None):
    """Only constructed repository endpoints and their asset-CDN redirects."""
    try:
        parsed = urllib.parse.urlsplit(url)
        if (parsed.scheme != "https" or parsed.username or parsed.password or
                parsed.port not in (None, 443) or parsed.fragment):
            return False
        if initial is None:
            if parsed.netloc == "api.github.com":
                return (parsed.path == "/repos/" + REPOSITORY + "/releases" and
                        re.fullmatch(r"per_page=100&page=[1-3]", parsed.query) is not None)
            if parsed.netloc != "github.com" or parsed.query:
                return False
            prefix = "/" + REPOSITORY + "/releases/download/"
            if not parsed.path.startswith(prefix):
                return False
            parts = parsed.path[len(prefix):].split("/")
            return len(parts) == 2 and url == asset_url(parts[0], parts[1])
        # The starting URL must itself be a fixed repo/tag/asset path. Never
        # follow API redirects or return from a CDN to a new arbitrary URL.
        start = urllib.parse.urlsplit(initial)
        return (start.netloc == "github.com" and trusted_url(initial) and
                parsed.netloc in ("release-assets.githubusercontent.com", "objects.githubusercontent.com") and
                re.fullmatch(r"/github-production-release-asset/\d+/[a-fA-F0-9-]+", parsed.path) is not None)
    except (ValueError, UpdateError):
        return False


class ReleaseRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, initial, deadline=None):
        self.initial = initial
        self.deadline = deadline or Deadline()
        self.count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.deadline.check()
        self.count += 1
        if self.count > 3 or not trusted_url(newurl, self.initial):
            raise UpdateError("下载重定向离开固定 GitHub 附件主机，已拒绝。")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, destination, limit, deadline, expected_size=None):
    if not trusted_url(url):
        raise UpdateError("仅允许固定项目的 GitHub 发布地址。")
    opener = urllib.request.build_opener(ReleaseRedirects(url, deadline))
    request = urllib.request.Request(url, headers={
        "User-Agent": "kiss-translator-learning-local-updater/1",
        "Accept": "application/vnd.github+json" if url.startswith(API_URL) else "application/octet-stream",
    })
    total = 0
    try:
        with opener.open(request, timeout=deadline.check()) as response:
            length = response.headers.get("Content-Length")
            if length is not None:
                try:
                    announced = int(length)
                except ValueError as error:
                    raise UpdateError("附件长度无效。") from error
                if announced < 0 or announced > limit or (expected_size is not None and announced != expected_size):
                    raise UpdateError("附件长度不符合发布记录或超过上限。")
            with destination.open("xb") as output:
                while True:
                    remaining = deadline.check()
                    # read1 performs at most one buffered/raw read, so a server
                    # cannot keep one large read alive by slowly dripping bytes.
                    socket = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
                    if socket is not None:
                        socket.settimeout(remaining)
                    chunk = response.read1(min(128 * 1024, limit - total + 1))
                    deadline.check()
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > limit:
                        raise UpdateError("下载超过大小上限。")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        if expected_size is not None and total != expected_size:
            raise UpdateError("下载不完整，文件长度与发布记录不一致。")
    except urllib.error.HTTPError as error:
        if error.code in (403, 429):
            raise UpdateError("GitHub 暂时拒绝请求或匿名访问额度已用完，请稍后重试；无需填写 Token。") from error
        raise UpdateError("GitHub 下载失败（HTTP %d），未修改扩展。" % error.code) from error
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise UpdateError("无法下载 GitHub 发布文件，请检查网络后重试。") from error
    return total


def select_release(releases):
    candidates = []
    for release in releases:
        if not isinstance(release, dict) or release.get("draft") is not False:
            continue
        tag = release.get("tag_name")
        try:
            if not isinstance(tag, str) or not tag.startswith("v"):
                continue
            version = version_key(tag)
            assets = {}
            for asset in release.get("assets", []):
                if not isinstance(asset, dict) or asset.get("name") not in ASSETS:
                    continue
                name = asset["name"]
                if name in assets or asset.get("state") != "uploaded":
                    raise UpdateError("重复或未完成附件。")
                size = asset.get("size")
                if (type(size) is not int or not 0 < size <= MAX_EXPANDED or
                        asset.get("browser_download_url") != asset_url(tag, name)):
                    raise UpdateError("附件记录无效。")
                digest = asset.get("digest")
                if digest is not None and (not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)):
                    raise UpdateError("GitHub 附件摘要格式无效。")
                if name == CHROME_ZIP and size > MAX_ARCHIVE:
                    raise UpdateError("Chrome 附件过大。")
                if name in (RECEIPT, SUMS) and size > MAX_METADATA:
                    raise UpdateError("发布校验记录过大。")
                assets[name] = asset
            if set(assets) == set(ASSETS):
                candidates.append((version, {"tag": tag, "assets": assets, "prerelease": release.get("prerelease") is True}))
        except (UpdateError, TypeError):
            continue
    if not candidates:
        raise UpdateError("没有找到四个附件齐全的 learning 发布版。")
    return max(candidates, key=lambda candidate: candidate[0])[1]


def latest_release(work, deadline):
    releases = []
    for page in range(1, 4):
        path = work / ("releases-%d.json" % page)
        download(API_URL + "?per_page=100&page=%d" % page, path, MAX_METADATA, deadline)
        items = read_json(path.read_bytes())
        if not isinstance(items, list):
            raise UpdateError("GitHub 发布列表无效或访问频率受限。")
        releases.extend(items)
        if len(items) < 100:
            break
    return select_release(releases)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(128 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_asset_digest(path, asset):
    digest = asset.get("digest")
    if digest is not None and digest != "sha256:" + sha256_file(path):
        raise UpdateError("GitHub API 附件摘要与下载文件不一致。")


def verify_receipt(work, release):
    for name in (SUMS, RECEIPT, CHROME_ZIP):
        verify_asset_digest(work / name, release["assets"][name])
    try:
        lines = (work / SUMS).read_text(encoding="ascii").splitlines()
    except (OSError, UnicodeError) as error:
        raise UpdateError("SHA256 清单无效。") from error
    checksums = {}
    for line in lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._-]+)", line)
        if not match or match[2] in checksums:
            raise UpdateError("SHA256 清单包含无效或重复记录。")
        checksums[match[2]] = match[1]
    if set(checksums) != {CHROME_ZIP, SOURCE_ZIP, RECEIPT}:
        raise UpdateError("SHA256 清单缺少发布文件。")
    if sha256_file(work / RECEIPT) != checksums[RECEIPT]:
        raise UpdateError("发布回执 SHA256 不一致。")
    receipt = read_json((work / RECEIPT).read_bytes())
    if (not isinstance(receipt, dict) or receipt.get("schema_version") != 1 or
            receipt.get("git_dirty") is not False or
            receipt.get("version_name") != release["tag"][1:] or
            not re.fullmatch(r"[a-f0-9]{40}", str(receipt.get("git_commit", "")))):
        raise UpdateError("发布回执的版本或干净构建标记无效。")
    numeric = release["tag"][1:].split("-learning.")[0]
    if receipt.get("version") != numeric:
        raise UpdateError("发布回执数字版本不一致。")
    artifacts = receipt.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != 2:
        raise UpdateError("发布回执附件列表无效。")
    seen = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise UpdateError("发布回执附件无效。")
        name = artifact.get("filename")
        if name not in (CHROME_ZIP, SOURCE_ZIP) or name in seen:
            raise UpdateError("发布回执附件重复或无效。")
        seen.add(name)
        api_digest = release["assets"][name].get("digest")
        if api_digest is not None and api_digest != "sha256:" + checksums[name]:
            raise UpdateError("GitHub API、SHA256 清单与发布回执摘要不一致。")
        if (artifact.get("sha256") != checksums[name] or
                type(artifact.get("size_bytes")) is not int or
                artifact["size_bytes"] != release["assets"][name]["size"]):
            raise UpdateError("发布回执的文件长度或 SHA256 不一致。")
    archive = work / CHROME_ZIP
    if archive.stat().st_size != release["assets"][CHROME_ZIP]["size"] or sha256_file(archive) != checksums[CHROME_ZIP]:
        raise UpdateError("Chrome ZIP 校验失败，未修改已安装扩展。")
    return receipt


def safe_parts(name):
    if not isinstance(name, str) or not name or len(name) > 600 or "\\" in name or name.startswith("/"):
        raise UpdateError("ZIP 包含不安全路径。")
    parts = name.rstrip("/").split("/")
    if any(not part or part in (".", "..") or ":" in part or
           part.endswith((".", " ")) or RESERVED.match(part) or
           any(ord(char) < 32 or ord(char) == 127 for char in part) for part in parts):
        raise UpdateError("ZIP 路径含穿越、保留名称或控制字符。")
    return parts


def preflight_zip(path, deadline):
    """Bound central-directory allocation before zipfile constructs ZipInfo objects.

    Release archives are small, single-volume, ordinary ZIPs. ZIP64 and
    self-extracting/trailing-data variants are unnecessary and rejected.
    """
    size = path.stat().st_size
    if not 22 <= size <= MAX_ARCHIVE:
        raise UpdateError("ZIP 文件长度无效或超过上限。")
    with path.open("rb") as stream:
        stream.seek(max(0, size - 65557))
        tail = stream.read(65557)
        position = tail.rfind(b"PK\x05\x06")
        if position < 0 or len(tail) - position < 22:
            raise UpdateError("ZIP 缺少完整目录结尾。")
        record = struct.unpack("<4s4H2IH", tail[position:position + 22])
        _, disk, start_disk, on_disk, count, central_size, offset, comment_size = record
        end_offset = size - len(tail) + position
        if (disk != 0 or start_disk != 0 or count != on_disk or not 0 < count <= MAX_ENTRIES or
                count == 65535 or central_size == 0xffffffff or offset == 0xffffffff or
                central_size > MAX_CENTRAL_DIRECTORY or offset + central_size != end_offset or
                position + 22 + comment_size != len(tail)):
            raise UpdateError("ZIP 目录数量、位置或格式超出安全上限（不支持 ZIP64／分卷）。")
        stream.seek(offset)
        remaining = central_size
        actual_count = 0
        while remaining:
            deadline.check()
            header = stream.read(46)
            if len(header) != 46 or header[:4] != b"PK\x01\x02":
                raise UpdateError("ZIP 中央目录损坏。")
            fields = struct.unpack("<4s6H3I5H2I", header)
            filename_size, extra_size, entry_comment_size, entry_disk = fields[10:14]
            local_offset = fields[16]
            record_size = 46 + filename_size + extra_size + entry_comment_size
            actual_count += 1
            if (actual_count > MAX_ENTRIES or record_size > remaining or
                    not 0 < filename_size <= 2400 or entry_disk != 0 or local_offset >= offset):
                raise UpdateError("ZIP 中央目录记录超出安全上限。")
            filename = stream.read(filename_size)
            if b"\x00" in filename:
                raise UpdateError("ZIP 文件名含空字符。")
            stream.seek(extra_size + entry_comment_size, os.SEEK_CUR)
            remaining -= record_size
        if actual_count != count:
            raise UpdateError("ZIP 声称的文件数与实际目录不符。")


def inspect_zip(archive):
    entries = archive.infolist()
    if not entries or len(entries) > MAX_ENTRIES:
        raise UpdateError("ZIP 文件数量超过上限或为空。")
    total = 0
    names = set()
    tree = {}
    for entry in entries:
        parts = safe_parts(entry.orig_filename)
        if entry.filename != entry.orig_filename:
            raise UpdateError("ZIP 文件名被截断。")
        normalized = unicodedata.normalize("NFC", "/".join(parts)).casefold()
        if normalized in names:
            raise UpdateError("ZIP 包含重复或大小写冲突路径。")
        names.add(normalized)
        mode = entry.external_attr >> 16
        kind = stat.S_IFMT(mode)
        if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or (kind == stat.S_IFDIR and not entry.is_dir()):
            raise UpdateError("ZIP 包含符号链接或特殊文件。")
        if entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise UpdateError("ZIP 使用加密或不支持的压缩方式。")
        if entry.file_size < 0 or entry.file_size > MAX_FILE:
            raise UpdateError("ZIP 单个文件超过上限。")
        total += entry.file_size
        if total > MAX_EXPANDED:
            raise UpdateError("ZIP 解压后超过 256 MiB 上限。")
        for index in range(1, len(parts) + 1):
            path = "/".join(parts[:index])
            key = unicodedata.normalize("NFC", path).casefold()
            is_dir = index < len(parts) or entry.is_dir()
            previous = tree.get(key)
            if previous and previous != (path, is_dir):
                raise UpdateError("ZIP 父路径存在文件或大小写冲突。")
            tree[key] = (path, is_dir)
    return entries


def extract_chrome(archive_path, work, receipt, deadline):
    root = work / "chrome"
    root.mkdir()
    try:
        preflight_zip(archive_path, deadline)
        with zipfile.ZipFile(archive_path) as archive:
            for entry in inspect_zip(archive):
                deadline.check()
                parts = safe_parts(entry.filename)
                selected = parts[0] == "chrome" and len(parts) > 1
                if entry.is_dir():
                    if selected:
                        root.joinpath(*parts[1:]).mkdir(parents=True, exist_ok=True)
                    continue
                output = None
                if selected:
                    path = root.joinpath(*parts[1:])
                    path.parent.mkdir(parents=True, exist_ok=True)
                    output = path.open("xb")
                try:
                    actual = 0
                    with archive.open(entry) as source:
                        while True:
                            deadline.check()
                            block = source.read(128 * 1024)
                            if not block:
                                break
                            actual += len(block)
                            if actual > entry.file_size or actual > MAX_FILE:
                                raise UpdateError("ZIP 实际解压大小不一致。")
                            if output:
                                output.write(block)
                    if actual != entry.file_size:
                        raise UpdateError("ZIP 文件长度不完整。")
                finally:
                    if output:
                        output.close()
        manifest = validate_extension(root)
        if manifest["version"] != receipt["version"] or manifest["version_name"] != receipt["version_name"]:
            raise UpdateError("ZIP 内 manifest 与发布回执版本不一致。")
        return root
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise UpdateError("ZIP 无法安全解压或 CRC 校验失败。") from error


def is_link_or_reparse(details):
    return stat.S_ISLNK(details.st_mode) or bool(getattr(details, "st_file_attributes", 0) & 0x400)


def no_symlink_path(path):
    absolute = Path(os.path.abspath(str(path)))
    for ancestor in (absolute, *absolute.parents):
        try:
            details = ancestor.lstat()
        except FileNotFoundError:
            continue
        if is_link_or_reparse(details):
            raise UpdateError("目标或上级目录是符号链接、junction 或重解析点，已拒绝。")
    return absolute


def validate_extension(path):
    path = no_symlink_path(path)
    if not path.is_dir():
        raise UpdateError("找不到已安装的学习版 Chrome 文件夹。")
    for name in (".git", "package.json", "updater", "offline", ".offline", "node_modules", "models"):
        if (path / name).exists():
            raise UpdateError("目标含源码、模型或其他工作目录，不是独立扩展目录。")
    count = 0
    for parent, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            count += 1
            entry = Path(parent) / name
            details = entry.lstat()
            mode = details.st_mode
            if is_link_or_reparse(details) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise UpdateError("扩展目录包含符号链接或特殊文件，未做更改。")
            if count > MAX_ENTRIES:
                raise UpdateError("扩展目录文件数量异常，未做更改。")
    for name in CORE_FILES:
        if not (path / name).is_file():
            raise UpdateError("扩展目录缺少核心文件：" + name)
    manifest_path = path / "manifest.json"
    if manifest_path.stat().st_size > MAX_METADATA:
        raise UpdateError("扩展 manifest 过大。")
    manifest = read_json(manifest_path.read_bytes())
    if (not isinstance(manifest, dict) or manifest.get("manifest_version") != 3 or
            manifest.get("homepage_url") != HOMEPAGE or
            not isinstance(manifest.get("background"), dict) or
            manifest["background"].get("service_worker") != "background.js"):
        raise UpdateError("目标不是此项目的学习版 Chrome 扩展。")
    version_key(manifest.get("version_name"))
    if manifest.get("version") != manifest["version_name"].split("-learning.")[0]:
        raise UpdateError("已安装扩展的版本字段不一致。")
    return manifest


def target_paths(target):
    return (target.parent / ("." + target.name + ".learning-backup"),
            target.parent / ("." + target.name + ".learning-update.json"),
            target.parent / ("." + target.name + ".learning-update.lock"))


def choose_target(explicit=None, script=None):
    base = (Path(script) if script else Path(__file__)).absolute().parent.parent
    if explicit:
        target = Path(explicit).expanduser()
    elif (base / "chrome").is_dir() or target_paths(base / "chrome")[1].exists():
        target = base / "chrome"
    elif (base / "package.json").is_file() and (base / "public" / "manifest.json").is_file():
        source = read_json((base / "public" / "manifest.json").read_bytes())
        if not isinstance(source, dict) or source.get("homepage_url") != HOMEPAGE:
            raise UpdateError("源码目录标记不属于本学习版。")
        target = base / "build" / "chrome"
    else:
        raise UpdateError("未找到 chrome/；请使用 --target 指定已安装的学习版扩展目录。")
    target = no_symlink_path(target)
    if target in (Path(target.anchor), Path.home().absolute(), base) or not target.parent.is_dir():
        raise UpdateError("不能替换根目录、个人目录或项目根目录。")
    return target


@contextmanager
def update_lock(target):
    path = target_paths(target)[2]
    no_symlink_path(path)
    if path.exists() and not path.is_file():
        raise UpdateError("更新锁不是普通文件。")
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptor = os.open(path, flags, 0o600)
    stream = os.fdopen(descriptor, "r+b")
    try:
        details = os.fstat(stream.fileno())
        if not stat.S_ISREG(details.st_mode) or details.st_nlink != 1:
            raise UpdateError("更新锁不是普通文件。")
        if os.name == "nt":
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, UpdateError) as error:
        stream.close()
        raise UpdateError("另一个更新器正在操作此目录，或无法取得更新锁。") from error
    try:
        yield
    finally:
        stream.close()  # OS releases the lock after normal exit or process crash.


def read_state(target):
    path = target_paths(target)[1]
    no_symlink_path(path)
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_size > 16384:
        raise UpdateError("更新事务记录无效，请保留目录并联系维护者。")
    state = read_json(path.read_bytes())
    if (not isinstance(state, dict) or state.get("schema") != 1 or state.get("target") != str(target) or
            state.get("phase") not in ("idle", "prepared", "moved")):
        raise UpdateError("更新事务记录与目标不符，未修改任何文件。")
    for field in ("old_version", "new_version"):
        version_key(state.get(field))
    return state


def sync_directory(path):
    # POSIX directory fsync strengthens rename durability. Windows has no
    # portable equivalent in Python's stdlib: crash recovery remains best effort.
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def sync_tree(path):
    directories = []
    for parent, _, files in os.walk(path):
        directories.append(Path(parent))
        for name in files:
            with (Path(parent) / name).open("r+b") as stream:
                os.fsync(stream.fileno())
    for directory in reversed(directories):
        sync_directory(directory)


def write_state(target, state):
    path = target_paths(target)[1]
    no_symlink_path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=".learning-journal-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def recover(target):
    backup, _, _ = target_paths(target)
    state = read_state(target)
    if not state or state["phase"] == "idle":
        return
    no_symlink_path(backup)
    if backup.exists():
        saved = validate_extension(backup)
        if saved["version_name"] != state["old_version"]:
            raise UpdateError("备份与未完成事务不符，已保留文件供手动处理。")
        if target.exists():
            current = validate_extension(target)
            if current["version_name"] == state["old_version"] and state["phase"] == "prepared":
                state["phase"] = "idle"
                write_state(target, state)
                return
            if current["version_name"] != state["new_version"]:
                raise UpdateError("目标在更新中被外部修改，已停止自动恢复。")
            shutil.rmtree(target)
        os.replace(backup, target)
        sync_directory(target.parent)
        print("已恢复上次未完成更新前的扩展目录。")
    elif not target.exists() or validate_extension(target)["version_name"] != state["old_version"]:
        raise UpdateError("未完成更新缺少可用备份，请保留事务文件。")
    state["phase"] = "idle"
    write_state(target, state)


def install(target, staged, expected_current):
    current = validate_extension(target)
    next_manifest = validate_extension(staged)
    if current["version_name"] != expected_current:
        raise UpdateError("扩展版本在准备更新时已改变，请重新运行。")
    if current.get("key") != next_manifest.get("key"):
        raise UpdateError("新版本扩展标识 Key 与当前不同，自动更新已拒绝；请联系维护者确认迁移。")
    sync_tree(staged)
    backup, _, _ = target_paths(target)
    no_symlink_path(backup)
    prior_state = read_state(target)
    if backup.exists():
        saved = validate_extension(backup)
        if not prior_state or prior_state["phase"] != "idle" or saved["version_name"] != prior_state["old_version"]:
            raise UpdateError("同名备份不是更新器的有效备份，未做覆盖。")
        shutil.rmtree(backup)
    state = {"schema": 1, "target": str(target), "phase": "prepared",
             "old_version": current["version_name"], "new_version": next_manifest["version_name"]}
    write_state(target, state)
    try:
        os.replace(target, backup)
        sync_directory(target.parent)
        state["phase"] = "moved"
        write_state(target, state)
        os.replace(staged, target)
        sync_directory(target.parent)
        sync_directory(staged.parent)
        validate_extension(target)
        state["phase"] = "idle"
        write_state(target, state)
    except BaseException:
        # KeyboardInterrupt is handled too. A journal permits recovery after
        # process interruption; filesystem/OS failure recovery is best effort.
        recover(target)
        raise


def rollback(target):
    current = validate_extension(target)
    backup, _, _ = target_paths(target)
    state = read_state(target)
    if not state or state["phase"] != "idle" or not backup.exists():
        raise UpdateError("没有可回退的单份备份。")
    saved = validate_extension(backup)
    if saved["version_name"] != state["old_version"]:
        raise UpdateError("备份版本与事务记录不一致。")
    with tempfile.TemporaryDirectory(prefix="." + target.name + ".learning-stage-", dir=target.parent) as directory:
        staged = Path(directory) / "chrome"
        shutil.copytree(backup, staged)
        install(target, staged, current["version_name"])
    print("已回退到 " + saved["version_name"] + "，上一版本保留为单份备份。")


def run(target, check=False, do_rollback=False):
    print("安装目录：" + str(target))
    leftovers = sorted(target.parent.glob("." + target.name + ".learning-stage-*"))
    if leftovers:
        print("发现 %d 个可能由中断留下的暂存目录；未自动删除。确认没有其他更新器运行后，可检查并手动清理：%s" % (len(leftovers), ", ".join(str(path) for path in leftovers[:3])))
    with update_lock(target):
        if check and read_state(target) and read_state(target)["phase"] != "idle":
            raise UpdateError("存在未完成更新，请先正常运行更新器恢复；--check 不修改扩展。")
        if not check:
            recover(target)
        current = validate_extension(target)
        if do_rollback:
            rollback(target)
        else:
            print("当前版本：" + current["version_name"])
            with tempfile.TemporaryDirectory(prefix="." + target.name + ".learning-stage-", dir=target.parent) as directory:
                work = Path(directory)
                deadline = Deadline()
                print("正在检查固定 GitHub 项目的完整发布版（含预发布）…")
                release = latest_release(work, deadline)
                newest = release["tag"][1:]
                comparison = version_key(newest) > version_key(current["version_name"])
                if not comparison:
                    print("已是最新版本；本机版本较新时也不会自动降级。")
                    return 0
                print("可用更新：" + newest + ("（预发布）" if release["prerelease"] else ""))
                if check:
                    print("仅检查完成，未下载 ZIP 或修改扩展。")
                    return 0
                for name in (SUMS, RECEIPT, CHROME_ZIP):
                    print("正在下载并核对：" + name)
                    download(asset_url(release["tag"], name), work / name,
                             MAX_ARCHIVE if name == CHROME_ZIP else MAX_METADATA,
                             deadline, release["assets"][name]["size"])
                receipt = verify_receipt(work, release)
                staged = extract_chrome(work / CHROME_ZIP, work, receipt, deadline)
                print("校验通过，正在原位替换扩展目录并保留单份备份…")
                install(target, staged, current["version_name"])
                print("更新完成：" + newest)
        print("请打开 chrome://extensions（Edge：edge://extensions），对简约翻译点击「重新加载」，再刷新正在阅读的页面。")
        return 0


def main(argv=None):
    if sys.version_info < (3, 9):
        print("更新器需要 Python 3.9 或更新版本。", file=sys.stderr)
        return 1
    parser = argparse.ArgumentParser(description="仅更新固定 GitHub 项目的学习版 Chrome 文件夹；无需登录或 Token。")
    parser.add_argument("--target", help="已安装学习版的 Chrome 扩展目录")
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--check", action="store_true", help="仅检查完整发布版，不修改扩展")
    modes.add_argument("--rollback", action="store_true", help="使用更新器保留的单份备份回退")
    args = parser.parse_args(argv)
    try:
        return run(choose_target(args.target), args.check, args.rollback)
    except KeyboardInterrupt:
        print("更新已中断；请再次运行以检查并恢复未完成事务。", file=sys.stderr)
        return 130
    except (UpdateError, OSError) as error:
        print("更新未完成：" + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
