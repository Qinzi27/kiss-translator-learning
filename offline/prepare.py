"""One-time online download of official Chinese/English Argos model packages."""
import hashlib
import json
from datetime import datetime, timezone
from runtime import DATA, configure, translate

configure()
from argostranslate import package

package.update_package_index()
available = package.get_available_packages()
installed = package.get_installed_packages()
receipt = []
for source, target in (("en", "zh"), ("zh", "en")):
    existing = next((p for p in installed if p.from_code == source and p.to_code == target), None)
    if existing:
        print(f"Already installed: {source} -> {target}", flush=True)
        receipt.append({"from": source, "to": target, "version": existing.package_version, "existing": True})
        continue
    candidates = [p for p in available if p.from_code == source and p.to_code == target]
    if not candidates:
        raise SystemExit(f"Official package index has no {source} -> {target} model.")
    model = candidates[0]
    print(f"Downloading official model: {source} -> {target} ({model.package_version})", flush=True)
    archive = model.download()
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    package.install_from_path(archive)
    receipt.append({"from": source, "to": target, "version": model.package_version,
                    "urls": model.links, "bytes": archive.stat().st_size, "sha256": digest})

# Warm both directions while online, including any sentence-boundary models.
for text, source, target in (("Hello, the weather is nice today.", "en", "zh"),
                              ("我们每天学习新的知识。", "zh", "en")):
    print(json.dumps({"source": text, "translation": translate(text, source, target)[0]}, ensure_ascii=False), flush=True)
(DATA / "model-receipt.json").write_text(json.dumps({
    "prepared_at": datetime.now(timezone.utc).isoformat(), "models": receipt,
}, ensure_ascii=False, indent=2))
print("Models prepared. Run verify.py in a new process to verify without outgoing connections.", flush=True)
