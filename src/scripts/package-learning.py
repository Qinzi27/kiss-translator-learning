"""Package existing Chrome artifacts and source; does not build or run tests."""
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CHROME_ZIP = "kiss-translator-learning-chrome.zip"
SOURCE_ZIP = "kiss-translator-learning-source.zip"
REQUIRED_DOCUMENTS = (
    "LICENSE",
    "README.md",
    "README.en.md",
    "START-HERE.md",
    "SECURITY.md",
    "docs/PDF-READER.md",
    "AI-SERVICES.md",
    "TRANSLATION-SKILL.md",
    "VALIDATION.md",
    "RELEASE-NOTES.md",
    "VERSION_MANAGEMENT.md",
    "custom-api_v2.md",
    "validation/free-api-live.json",
    "validation/pdf-preview.json",
)
EXCLUDED_SOURCE_FILES = {"PAUSED-HANDOFF.md", "dev-server-check.log"}
EXCLUDED_DIRECTORIES = {
    ".git", ".offline", ".pnpm-store", "node_modules", "build", "releases",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "coverage", "tmp",
}
SUPPLEMENT_EXTENSIONS = {
    ".md", ".rst", ".txt", ".json", ".jsonl", ".csv", ".yaml", ".yml",
    ".toml", ".py", ".js", ".mjs", ".cjs", ".sh", ".sb", ".ps1", ".bat", ".cmd",
}
MAX_SUPPLEMENT_BYTES = 1024 * 1024


def git_output(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8")


def regular_file(base, name):
    """Reject links/traversal instead of accidentally packaging files outside a tree."""
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts:
        raise SystemExit(f"Unsafe package path: {name}")
    path = base.joinpath(*relative.parts)
    if path.is_symlink():
        raise SystemExit(f"Symlinks are not included in release archives: {name}")
    try:
        path.resolve().relative_to(base.resolve())
    except ValueError:
        raise SystemExit(f"Package path leaves its source directory: {name}")
    if not path.is_file():
        raise SystemExit(f"Missing package file: {name}")
    return path


def source_allowed(name):
    relative = PurePosixPath(name)
    return (
        name not in EXCLUDED_SOURCE_FILES
        and not any(part in EXCLUDED_DIRECTORIES for part in relative.parts)
        and relative.suffix not in {".pyc", ".pyo"}
        and relative.name != ".DS_Store"
    )


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    build = ROOT / "build" / "chrome"
    source_manifest = json.loads(regular_file(ROOT, "public/manifest.json").read_text(encoding="utf-8"))
    build_manifest = json.loads(regular_file(build, "manifest.json").read_text(encoding="utf-8"))
    if not source_manifest.get("version"):
        raise SystemExit("Source manifest has no version.")
    for field in ("version", "version_name", "mime_types_handler"):
        if source_manifest.get(field) != build_manifest.get(field):
            raise SystemExit(
                f"Manifest {field} mismatch: source={source_manifest.get(field)!r}, "
                f"build={build_manifest.get(field)!r}. Rebuild before packaging."
            )

    required = {"background.js", "content.js", "popup.html", "options.html",
                "pdf.html", "pdf.js", "pdfjs/pdf.mjs", "pdfjs/pdf.worker.mjs", "pdfjs/LICENSE"}
    for content in build_manifest.get("content_scripts", []):
        required.update(content.get("js", []))
        required.update(content.get("css", []))
    required.update(build_manifest.get("icons", {}).values())
    for name in sorted(required):
        regular_file(build, name)
    documents = {name: regular_file(ROOT, name) for name in REQUIRED_DOCUMENTS}

    listed = sorted(set(filter(None, git_output(
        "ls-files", "--cached", "--others", "--exclude-standard", "-z"
    ).split("\0"))))
    source_files = {}
    for name in listed:
        # A tracked deletion is omitted from this working-tree source snapshot.
        if not source_allowed(name) or not (ROOT / name).exists():
            continue
        path = regular_file(ROOT, name)
        source_files[name] = path
        relative = PurePosixPath(name)
        if relative.parts[0] in {"docs", "offline"}:
            if relative.suffix.lower() in SUPPLEMENT_EXTENSIONS and path.stat().st_size <= MAX_SUPPLEMENT_BYTES:
                documents[name] = path
            else:
                print(f"Not included as supplementary Chrome documentation (format/size): {name}")
    # Required release documents must accompany source even if ignored locally.
    source_files.update(documents)

    commit = git_output("rev-parse", "HEAD").strip()
    dirty = bool(git_output("status", "--porcelain=v1", "--untracked-files=normal", "-z"))
    release = ROOT / "releases"
    release.mkdir(exist_ok=True)
    # Prepare and verify a complete set before replacing the previous artifacts.
    with tempfile.TemporaryDirectory(prefix=".package-learning-", dir=release) as temporary:
        staging = Path(temporary)
        with zipfile.ZipFile(staging / CHROME_ZIP, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(build.rglob("*")):
                if path.is_file() or path.is_symlink():
                    name = path.relative_to(build).as_posix()
                    archive.write(regular_file(build, name), "chrome/" + name)
            for name, path in sorted(documents.items()):
                archive.write(path, name)
        with zipfile.ZipFile(staging / SOURCE_ZIP, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, path in sorted(source_files.items()):
                archive.write(path, "kiss-translator/" + name)

        artifacts = []
        for name in (CHROME_ZIP, SOURCE_ZIP):
            path = staging / name
            with zipfile.ZipFile(path) as archive:
                corrupt = archive.testzip()
                if corrupt is not None:
                    raise SystemExit(f"Corrupt ZIP: {name}; entry: {corrupt}")
            artifacts.append({"filename": name, "size_bytes": path.stat().st_size, "sha256": sha256_file(path)})

        receipt = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "version": source_manifest["version"],
            "version_name": source_manifest.get("version_name"),
            "git_commit": commit,
            "git_dirty": dirty,
            "checks_performed": ["source_and_build_manifest_versions_match", "zip_crc_integrity"],
            "not_verified_by_this_script": ["tests_passed", "build_succeeded", "binary_matches_source"],
            "artifacts": artifacts,
        }
        receipt_path = staging / "release-manifest.json"
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        checksums = [f"{item['sha256']}  {item['filename']}" for item in artifacts]
        checksums.append(f"{sha256_file(receipt_path)}  release-manifest.json")
        (staging / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")

        for name in (CHROME_ZIP, SOURCE_ZIP, "release-manifest.json", "SHA256SUMS.txt"):
            (staging / name).replace(release / name)
        for item in artifacts:
            print(f"{item['filename']}: {item['size_bytes']:,} bytes; ZIP integrity verified; SHA-256 {item['sha256']}")
        print(f"Version: {source_manifest.get('version_name') or source_manifest['version']}; commit: {commit}; dirty: {dirty}")
        print("Wrote SHA256SUMS.txt and release-manifest.json. Builds and tests were not run or certified.")


if __name__ == "__main__":
    main()
