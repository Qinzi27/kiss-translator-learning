"""Project-local Argos runtime. No model or cache is written outside .offline."""
import os
import html
import re
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / ".offline"

# KISS serializes rich text as synthetic tags (<i1>...</i1> or <i i=1>)
# and numbered placeholders. None of those markers may pass through a model.
# Quoted attribute values may contain '>', so do not split tags at the first '>'.
PROTECTED = re.compile(
    r"<!--.*?-->|</?[A-Za-z][\w:-]*(?:[^<>\"']|\"[^\"]*\"|'[^']*')*>"
    r"|\{\{\s*\d+\s*\}\}|\{\s*\d+\s*\}"
    r"|\[\[\s*\d+\s*\]\]|\[\s*\d+\s*\]",
    re.DOTALL,
)


def configure():
    # Scope dependency-owned paths to this process, never change the user's HOME.
    for key, relative in {
        "XDG_DATA_HOME": "data",
        "XDG_CONFIG_HOME": "config",
        "XDG_CACHE_HOME": "cache",
        "ARGOS_PACKAGES_DIR": "packages",
        "STANZA_RESOURCES_DIR": "stanza",
    }.items():
        folder = DATA / relative
        folder.mkdir(parents=True, exist_ok=True)
        os.environ[key] = str(folder)
    os.environ["ARGOS_DEVICE_TYPE"] = "cpu"
    os.environ["ARGOS_MODEL_PROVIDER"] = "OPENNMT"
    os.environ["ARGOS_CHUNK_TYPE"] = "MINISBD"
    os.environ["ARGOS_INTER_THREADS"] = "1"
    os.environ["ARGOS_INTRA_THREADS"] = "2"
    # Argos logs complete source sentences and tokens when this is inherited as 1.
    os.environ["ARGOS_DEBUG"] = "0"


def deny_outbound():
    """Deny Python socket connections and subprocesses before importing inference.

    The local HTTP listener can accept requests. Downloads and outgoing socket
    connections made by Python dependencies fail instead of silently going online.
    This is process-level enforcement, not an OS firewall for native libraries.
    """
    def audit(event, args):
        if event in ("socket.connect", "socket.connect_ex"):
            raise RuntimeError("离线进程已禁止所有出站连接；请先运行 prepare.py 准备模型。")
        if event in ("subprocess.Popen", "os.system", "os.posix_spawn"):
            raise RuntimeError("离线推理进程禁止启动外部命令。")
    sys.addaudithook(audit)


def _translate_plain(text, source, target):
    from argostranslate import translate as argos
    return argos.translate(text, source, target)


def _parts(text):
    previous = 0
    for match in PROTECTED.finditer(text):
        if match.start() > previous:
            yield False, text[previous:match.start()]
        yield True, match.group()
        previous = match.end()
    if previous < len(text):
        yield False, text[previous:]


def _needs_english_space(previous, current):
    # A Chinese source has no spaces around inline tags. Independently translated
    # English fragments do: e.g. Learn<i1>new words</i1>every day.
    return bool(previous and current and current.isascii() and current.isalnum()
                and (previous == "\ufffc" or
                     (previous.isascii() and (previous.isalnum() or previous in ".!?,:;"))))


def translate(text, source, target):
    """Translate text fragments while preserving KISS markup and placeholders.

    Markup boundaries may reduce sentence-level fluency. Keeping those boundaries
    intact takes precedence over letting a model move or rewrite links and code.
    """
    source = normalize_language(source)
    target = normalize_language(target)
    parts = list(_parts(text))
    if source == "auto":
        visible_text = html.unescape("".join(value for protected, value in parts if not protected))
        source = "zh" if any("\u3400" <= char <= "\u9fff" for char in visible_text) else "en"
    if source == target:
        return text, source

    result = []
    previous_visible = ""
    for protected, value in parts:
        if protected:
            if not value.startswith("<"):
                # The placeholder may later become inline code or an image.
                # Treat it as one visible unit, preserving the token byte-for-byte.
                if target == "en" and _needs_english_space(previous_visible, "x"):
                    result.append(" ")
                previous_visible = "\ufffc"
            result.append(value)
            continue

        leading = value[:len(value) - len(value.lstrip())]
        trailing = value[len(value.rstrip()):]
        core = value.strip()
        if not core:
            result.append(value)
            if value:
                previous_visible = value[-1]
            continue

        decoded = html.unescape(core)
        # An isolated full stop between tags is not a sentence. Some models
        # hallucinate whole phrases for such input, so keep punctuation/numbers.
        translated = (_translate_plain(decoded, source, target).strip()
                      if any(char.isalpha() for char in decoded) else decoded)
        visible = leading + translated + trailing
        if target == "en" and _needs_english_space(previous_visible, visible[:1]):
            result.append(" ")
        # Only original, protected markup is emitted as markup. Model-generated
        # angle brackets and ampersands remain ordinary text in the browser.
        result.append(leading + html.escape(translated, quote=False) + trailing)
        if visible:
            previous_visible = visible[-1]
    return "".join(result), source


def normalize_language(value):
    if value in ("zh", "zh-CN", "zh-cn", "zh-Hans", "zh-TW"):
        return "zh"
    if value in ("en", "auto"):
        return value
    raise ValueError("本机模型当前仅支持中文和英文。")
