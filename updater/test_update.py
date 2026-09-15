"""Offline regression tests. All updates operate on temporary synthetic folders."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import warnings
import tempfile
import types
import unittest
from unittest import mock
import urllib.error
import zipfile

SPEC = importlib.util.spec_from_file_location("learning_updater", Path(__file__).with_name("update.py"))
update = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(update)
OLD = "2.0.34-learning.5"
NEW = "2.0.35-learning.6"


def manifest(version=OLD, **changes):
    value = {"manifest_version": 3, "version": version.split("-learning")[0],
             "version_name": version, "homepage_url": update.HOMEPAGE,
             "name": "Synthetic learning fixture", "background": {"service_worker": "background.js"}}
    value.update(changes)
    return value


def extension(path, version=OLD, **changes):
    path.mkdir(parents=True)
    for name in update.CORE_FILES:
        (path / name).write_text(json.dumps(manifest(version, **changes)) if name == "manifest.json" else "synthetic " + version)
    return path


def zip_bytes(entries):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries:
                archive.writestr(name, data)
    return output.getvalue()


def chrome_zip(version=NEW, extra=(), **changes):
    entries = [("chrome/" + name, json.dumps(manifest(version, **changes)) if name == "manifest.json" else "synthetic " + version)
               for name in update.CORE_FILES]
    return zip_bytes(entries + [("updater/update.py", "raise RuntimeError('must never execute')"),
                                ("offline/README.md", "not extracted")] + list(extra))


def release(version=NEW, data=None):
    tag = "v" + version
    data = data or {name: b"synthetic" for name in update.ASSETS}
    return {"draft": False, "tag_name": tag, "prerelease": True,
            "assets": [{"name": name, "size": len(data[name]), "state": "uploaded",
                        "browser_download_url": update.asset_url(tag, name),
                        "digest": "sha256:" + hashlib.sha256(data[name]).hexdigest()} for name in update.ASSETS]}


def fixture_release(version=NEW, archive=None, dirty=False):
    archive = archive if archive is not None else chrome_zip(version)
    data = {update.CHROME_ZIP: archive, update.SOURCE_ZIP: b"source fixture never downloaded"}
    receipt = {"schema_version": 1, "version": version.split("-learning")[0], "version_name": version,
               "git_dirty": dirty, "git_commit": "a" * 40,
               "artifacts": [{"filename": name, "size_bytes": len(data[name]), "sha256": hashlib.sha256(data[name]).hexdigest()}
                             for name in (update.CHROME_ZIP, update.SOURCE_ZIP)]}
    data[update.RECEIPT] = json.dumps(receipt).encode()
    data[update.SUMS] = "".join(hashlib.sha256(data[name]).hexdigest() + "  " + name + "\n"
                               for name in (update.CHROME_ZIP, update.SOURCE_ZIP, update.RECEIPT)).encode()
    return release(version, data), data


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()  # macOS /var can itself be an alias.
        self.target = extension(self.root / "chrome")
        self.work = self.root / "downloads"
        self.work.mkdir()
        self.output = mock.patch("builtins.print")
        self.output.start()
        self.addCleanup(self.output.stop)

    def prepared(self, version=NEW, **changes):
        return extension(self.root / ("staged-" + version), version, **changes)

    def files(self, directory=None):
        return {path.relative_to(directory or self.target).as_posix(): path.read_bytes()
                for path in (directory or self.target).rglob("*") if path.is_file()}

    def fake_network(self, raw_release, data):
        requests = []
        def download(url, destination, limit, deadline, expected_size=None):
            requests.append(url)
            payload = json.dumps([raw_release]).encode() if url.startswith(update.API_URL) else data[url.rsplit("/", 1)[1]]
            if len(payload) > limit or expected_size is not None and len(payload) != expected_size:
                raise update.UpdateError("synthetic size mismatch")
            destination.write_bytes(payload)
            return len(payload)
        return requests, mock.patch.object(update, "download", side_effect=download)

    def write_release(self, raw=None, data=None):
        if raw is None:
            raw, data = fixture_release()
        for name, payload in data.items():
            if name != update.SOURCE_ZIP:
                (self.work / name).write_bytes(payload)
        return update.select_release([raw])

    def test_numeric_version_comparison_and_pre_releases(self):
        candidates = [release("2.0.34-learning.9"), release("2.0.34-learning.10"), release("2.0.33-learning.99")]
        self.assertEqual(update.select_release(candidates)["tag"], "v2.0.34-learning.10")
        self.assertGreater(update.version_key("2.0.35-learning.1"), update.version_key("2.0.34-learning.999"))
        self.assertEqual(update.version_key("2.0.34.0-learning.5"), update.version_key(OLD))
        for invalid in ("2.0.35", "v2.0.35-beta.1", "2.0.35-learning.-1", "v2/../../x-learning.1"):
            with self.subTest(invalid=invalid), self.assertRaises(update.UpdateError):
                update.version_key(invalid)

    def test_skips_drafts_incomplete_releases_and_asset_relocation(self):
        valid = release(OLD)
        newer = release(NEW)
        draft = dict(newer, draft=True)
        incomplete = dict(newer, assets=newer["assets"][:-1])
        relocated = copy.deepcopy(newer)
        relocated["assets"][0]["browser_download_url"] = "https://example.test/payload.zip"
        duplicate = copy.deepcopy(newer)
        duplicate["assets"].append(duplicate["assets"][0])
        self.assertEqual(update.select_release([draft, incomplete, relocated, duplicate, valid])["tag"], "v" + OLD)
        with self.assertRaises(update.UpdateError):
            update.select_release([draft, incomplete])

    def test_url_rules_reject_arbitrary_start_and_unsafe_redirects(self):
        initial = update.asset_url("v" + NEW, update.CHROME_ZIP)
        self.assertTrue(update.trusted_url(initial))
        self.assertTrue(update.trusted_url(update.API_URL + "?per_page=100&page=1"))
        cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/123/abc-def?signature=synthetic"
        self.assertTrue(update.trusted_url(cdn, initial))
        self.assertFalse(update.trusted_url(cdn))
        for url in (initial.replace("https:", "http:"), initial.replace("github.com", "github.com.evil.test"),
                    initial.replace("github.com", "user:pass@github.com"), initial.replace("github.com", "github.com:444"),
                    initial + "?x=1", "https://raw.githubusercontent.com/anything", "file:///tmp/x"):
            with self.subTest(url=url):
                self.assertFalse(update.trusted_url(url))
        for url in ("https://example.test/x", cdn.replace("https:", "http:"), cdn.replace("/123/abc-def", "/other")):
            self.assertFalse(update.trusted_url(url, initial))
        self.assertFalse(update.trusted_url(cdn, update.API_URL + "?per_page=100&page=1"))

    def test_receipt_checks_sha_size_clean_git_and_api_digests(self):
        selected = self.write_release()
        result = update.verify_receipt(self.work, selected)
        self.assertEqual(result["version_name"], NEW)
        for name in update.ASSETS:
            broken = copy.deepcopy(selected)
            broken["assets"][name]["digest"] = "sha256:" + "0" * 64
            with self.subTest(name=name), self.assertRaises(update.UpdateError):
                update.verify_receipt(self.work, broken)
        selected["assets"][update.CHROME_ZIP]["size"] += 1
        with self.assertRaises(update.UpdateError):
            update.verify_receipt(self.work, selected)

    def test_nullable_legacy_api_digest_still_requires_sha_and_receipt(self):
        selected = self.write_release()
        for asset in selected["assets"].values():
            asset["digest"] = None
        self.assertEqual(update.verify_receipt(self.work, selected)["version_name"], NEW)
        with (self.work / update.CHROME_ZIP).open("ab") as stream:
            stream.write(b"tampered")
        with self.assertRaises(update.UpdateError):
            update.verify_receipt(self.work, selected)

    def test_dirty_receipt_and_duplicate_checksum_lines_rejected(self):
        raw, data = fixture_release(dirty=True)
        selected = self.write_release(raw, data)
        with self.assertRaises(update.UpdateError):
            update.verify_receipt(self.work, selected)
        (self.work / update.SUMS).write_bytes(data[update.SUMS] + data[update.SUMS].splitlines()[0] + b"\n")
        selected["assets"][update.SUMS]["digest"] = None
        with self.assertRaises(update.UpdateError):
            update.verify_receipt(self.work, selected)

    def test_json_duplicate_keys_rejected(self):
        with self.assertRaises(update.UpdateError):
            update.read_json('{"git_dirty":true,"git_dirty":false}')

    def test_extracts_only_chrome_and_never_runs_or_replaces_updater(self):
        selected = self.write_release()
        receipt = update.verify_receipt(self.work, selected)
        extracted = update.extract_chrome(self.work / update.CHROME_ZIP, self.work, receipt, update.Deadline())
        self.assertEqual(update.validate_extension(extracted)["version_name"], NEW)
        self.assertFalse((self.work / "updater").exists())
        self.assertFalse((self.work / "offline").exists())
        self.assertEqual(set(self.files(extracted)), set(update.CORE_FILES))

    def test_zip_manifest_must_match_release_receipt(self):
        raw, data = fixture_release(archive=chrome_zip(OLD))
        selected = self.write_release(raw, data)
        receipt = update.verify_receipt(self.work, selected)
        with self.assertRaises(update.UpdateError):
            update.extract_chrome(self.work / update.CHROME_ZIP, self.work, receipt, update.Deadline())

    def test_malicious_zip_paths_and_types_rejected_before_extraction(self):
        cases = [[("../outside", "x")], [("/absolute", "x")], [("chrome/../../outside", "x")],
                 [("chrome\\outside", "x")], [("C:/windows", "x")], [("chrome/file:stream", "x")],
                 [("chrome/NUL.txt", "x")], [("chrome/file.", "x")], [("chrome/file ", "x")],
                 [("chrome//file", "x")], [("chrome/a", "x"), ("chrome/A", "y")],
                 [("chrome/é", "x"), ("chrome/e\u0301", "y")],
                 [("chrome/A/a", "x"), ("chrome/a/b", "y")],
                 [("chrome/file", "x"), ("chrome/file/child", "x")],
                 [("chrome/a", "x"), ("chrome/a", "y")]]
        link = zipfile.ZipInfo("chrome/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        device = zipfile.ZipInfo("chrome/device")
        device.external_attr = (stat.S_IFCHR | 0o600) << 16
        cases.extend([[(link, "../../outside")], [(device, "x")]])
        for entries in cases:
            with self.subTest(entries=entries):
                payload = zip_bytes(entries)
                with zipfile.ZipFile(io.BytesIO(payload)) as archive, self.assertRaises(update.UpdateError):
                    update.inspect_zip(archive)
        self.assertFalse((self.root / "outside").exists())

    def test_nul_filename_rejected_in_real_zip_bytes(self):
        payload = zip_bytes([("chrome/evilXignored", "x")]).replace(b"evilXignored", b"evil\x00ignored")
        path = self.work / "nul.zip"
        path.write_bytes(payload)
        with self.assertRaises(update.UpdateError):
            update.preflight_zip(path, update.Deadline())
        with zipfile.ZipFile(path) as archive, self.assertRaises(update.UpdateError):
            update.inspect_zip(archive)

    def test_central_directory_preflight_rejects_lies_before_zipfile_allocation(self):
        normal = chrome_zip()
        offset = normal.rfind(b"PK\x05\x06")
        fields = list(struct.unpack("<4s4H2IH", normal[offset:offset + 22]))
        variants = []
        for index, value in ((3, 0), (4, 65535), (5, 0xffffffff), (6, len(normal) + 1), (7, 1)):
            modified = fields.copy()
            modified[index] = value
            variants.append(normal[:offset] + struct.pack("<4s4H2IH", *modified))
        variants.extend([normal[:-5], normal + b"unexpected suffix"])
        path = self.work / "unsafe.zip"
        for payload in variants:
            with self.subTest(length=len(payload)):
                path.write_bytes(payload)
                with self.assertRaises(update.UpdateError):
                    update.preflight_zip(path, update.Deadline())
        path.write_bytes(normal)
        with mock.patch.object(update, "MAX_ENTRIES", 1), mock.patch.object(update.zipfile, "ZipFile", side_effect=AssertionError("must reject before allocation")), self.assertRaises(update.UpdateError):
            update.extract_chrome(path, self.work, manifest(NEW), update.Deadline())

    def test_journal_failures_after_old_move_or_new_install_restore_original(self):
        original = self.files()
        for phase in ("moved", "idle"):
            staged = self.prepared()
            write = update.write_state
            failed = False
            def fail_phase(target, state):
                nonlocal failed
                if not failed and state["phase"] == phase:
                    failed = True
                    raise OSError("synthetic journal failure")
                return write(target, state)
            with mock.patch.object(update, "write_state", side_effect=fail_phase), self.assertRaises(OSError):
                update.install(self.target, staged, OLD)
            self.assertEqual(self.files(), original)
            self.assertEqual(update.read_state(self.target)["phase"], "idle")
            if staged.exists():
                for path in staged.iterdir(): path.unlink()
                staged.rmdir()

    def test_rollback_failure_restores_version_being_rolled_back(self):
        update.install(self.target, self.prepared(), OLD)
        current = self.files()
        replace = os.replace
        def fail_restore(source, destination):
            if ".learning-stage-" in str(source) and Path(destination) == self.target:
                raise OSError("synthetic rollback rename failure")
            return replace(source, destination)
        with mock.patch.object(update.os, "replace", side_effect=fail_restore), self.assertRaises(OSError):
            update.rollback(self.target)
        self.assertEqual(self.files(), current)

    def test_malformed_background_is_a_friendly_error(self):
        (self.target / "manifest.json").write_text(json.dumps(manifest(background=[])))
        with self.assertRaises(update.UpdateError):
            update.validate_extension(self.target)

    def test_zip_size_count_limits_and_special_compression(self):
        payload = zip_bytes([("chrome/a", "a" * 20), ("chrome/b", "b" * 20)])
        for field, limit in (("MAX_ENTRIES", 1), ("MAX_FILE", 10), ("MAX_EXPANDED", 30)):
            with mock.patch.object(update, field, limit), zipfile.ZipFile(io.BytesIO(payload)) as archive, self.assertRaises(update.UpdateError):
                update.inspect_zip(archive)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            entries = archive.infolist()
            entries[0].flag_bits |= 1
            with self.assertRaises(update.UpdateError):
                update.inspect_zip(archive)

    def test_target_validation_rejects_unrelated_source_and_symlink_trees(self):
        unrelated = self.root / "unrelated"
        unrelated.mkdir()
        with self.assertRaises(update.UpdateError):
            update.validate_extension(unrelated)
        (self.target / ".offline").mkdir()
        with self.assertRaises(update.UpdateError):
            update.validate_extension(self.target)
        (self.target / ".offline").rmdir()
        link = self.root / "alias"
        link.symlink_to(self.target, target_is_directory=True)
        with self.assertRaises(update.UpdateError):
            update.choose_target(str(link))
        (self.target / "linked").symlink_to(self.root / "other")
        with self.assertRaises(update.UpdateError):
            update.validate_extension(self.target)
        with self.assertRaises(update.UpdateError):
            update.choose_target(str(Path.home()))

    def test_windows_junction_attribute_is_rejected(self):
        self.assertTrue(update.is_link_or_reparse(types.SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)))
        self.assertFalse(update.is_link_or_reparse(types.SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x10)))

    def test_default_release_and_source_layout_require_markers(self):
        script = self.root / "updater" / "update.py"
        self.assertEqual(update.choose_target(script=script), self.target)
        source = self.root / "source"
        (source / "public").mkdir(parents=True)
        (source / "package.json").write_text("{}")
        (source / "public" / "manifest.json").write_text(json.dumps(manifest()))
        extension(source / "build" / "chrome")
        self.assertEqual(update.choose_target(script=source / "updater" / "update.py"), source / "build" / "chrome")

    def test_success_updates_in_place_one_backup_and_preserves_unrelated_settings_models(self):
        raw, data = fixture_release()
        requests, network = self.fake_network(raw, data)
        settings = self.root / "synthetic-user-settings.json"
        settings.write_text('{"apiKey":"not-a-real-key"}')
        models = self.root / ".offline"
        models.mkdir()
        (models / "model.bin").write_bytes(b"do not touch")
        with network:
            self.assertEqual(update.run(self.target), 0)
        self.assertEqual(update.validate_extension(self.target)["version_name"], NEW)
        backup, journal, _ = update.target_paths(self.target)
        self.assertEqual(update.validate_extension(backup)["version_name"], OLD)
        self.assertEqual(update.read_state(self.target)["phase"], "idle")
        self.assertEqual(settings.read_text(), '{"apiKey":"not-a-real-key"}')
        self.assertEqual((models / "model.bin").read_bytes(), b"do not touch")
        self.assertFalse(any(url.endswith(update.SOURCE_ZIP) for url in requests))
        self.assertEqual([path.name for path in self.root.glob("*.learning-stage-*")], [])
        self.assertTrue(journal.exists())

    def test_check_current_and_newer_versions_leave_target_and_backup_unchanged(self):
        original = self.files()
        for published, check in ((NEW, True), (OLD, False), ("2.0.33-learning.999", False)):
            raw, data = fixture_release(published)
            requests, network = self.fake_network(raw, data)
            with self.subTest(published=published), network:
                self.assertEqual(update.run(self.target, check=check), 0)
            self.assertEqual(self.files(), original)
            self.assertEqual(len(requests), 1)
            backup, journal, _ = update.target_paths(self.target)
            self.assertFalse(backup.exists())
            self.assertFalse(journal.exists())

    def test_integrity_failure_does_not_touch_current_installation(self):
        raw, data = fixture_release()
        data[update.CHROME_ZIP] = b"x" * len(data[update.CHROME_ZIP])
        requests, network = self.fake_network(raw, data)
        original = self.files()
        with network, self.assertRaises(update.UpdateError):
            update.run(self.target)
        self.assertEqual(self.files(), original)
        self.assertFalse(update.target_paths(self.target)[0].exists())

    def test_failed_rename_and_keyboard_interrupt_restore_original_folder(self):
        for interrupt in (OSError("synthetic rename failure"), KeyboardInterrupt()):
            staged = self.prepared()
            original = self.files()
            replace = os.replace
            def fail_staged(source, destination):
                if Path(source) == staged:
                    raise interrupt
                return replace(source, destination)
            with mock.patch.object(update.os, "replace", side_effect=fail_staged), self.assertRaises(type(interrupt)):
                update.install(self.target, staged, OLD)
            self.assertEqual(self.files(), original)
            self.assertEqual(update.read_state(self.target)["phase"], "idle")
            for path in staged.iterdir():
                path.unlink()
            staged.rmdir()

    def test_process_interruption_journal_recovers_missing_or_new_target(self):
        backup, _, _ = update.target_paths(self.target)
        state = {"schema": 1, "target": str(self.target), "phase": "moved", "old_version": OLD, "new_version": NEW}
        os.replace(self.target, backup)
        update.write_state(self.target, state)
        update.recover(self.target)
        self.assertEqual(update.validate_extension(self.target)["version_name"], OLD)
        os.replace(self.target, backup)
        extension(self.target, NEW)
        update.write_state(self.target, state)
        update.recover(self.target)
        self.assertEqual(update.validate_extension(self.target)["version_name"], OLD)

    def test_rollback_swaps_versions_without_network_and_keeps_one_backup(self):
        update.install(self.target, self.prepared(), OLD)
        with mock.patch.object(update, "download", side_effect=AssertionError("rollback must not network")):
            self.assertEqual(update.run(self.target, do_rollback=True), 0)
        self.assertEqual(update.validate_extension(self.target)["version_name"], OLD)
        self.assertEqual(update.validate_extension(update.target_paths(self.target)[0])["version_name"], NEW)
        update.run(self.target, do_rollback=True)
        self.assertEqual(update.validate_extension(self.target)["version_name"], NEW)

    def test_changed_extension_id_key_refused_before_mutation(self):
        original = self.files()
        with self.assertRaises(update.UpdateError):
            update.install(self.target, self.prepared(key="synthetic-different-id"), OLD)
        self.assertEqual(self.files(), original)
        self.assertFalse(update.target_paths(self.target)[0].exists())

    def test_unowned_backup_or_foreign_journal_not_deleted(self):
        backup, journal, _ = update.target_paths(self.target)
        extension(backup)
        before = self.files(backup)
        with self.assertRaises(update.UpdateError):
            update.install(self.target, self.prepared(), OLD)
        self.assertEqual(self.files(backup), before)
        journal.write_text(json.dumps({"schema": 1, "target": "/another", "phase": "moved", "old_version": OLD, "new_version": NEW}))
        with self.assertRaises(update.UpdateError):
            update.recover(self.target)
        self.assertEqual(self.files(backup), before)

    def test_os_lock_prevents_concurrent_updates(self):
        with update.update_lock(self.target):
            with self.assertRaises(update.UpdateError):
                with update.update_lock(self.target):
                    self.fail("second updater acquired same lock")
        with update.update_lock(self.target):
            pass

    def test_download_limits_deadline_and_403_errors(self):
        url = update.asset_url("v" + NEW, update.CHROME_ZIP)
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read1(self, size): return b"x" * size
        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch.object(update.urllib.request, "build_opener", return_value=opener), self.assertRaises(update.UpdateError):
            update.download(url, self.work / "oversize", 20, update.Deadline())
        opener.open.side_effect = urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
        with mock.patch.object(update.urllib.request, "build_opener", return_value=opener), self.assertRaisesRegex(update.UpdateError, "额度"):
            update.download(url, self.work / "blocked", 20, update.Deadline())
        with self.assertRaises(update.UpdateError):
            update.Deadline(-1).check()

    def test_redirect_hop_limit_and_timeout(self):
        url = update.asset_url("v" + NEW, update.CHROME_ZIP)
        handler = update.ReleaseRedirects(url)
        handler.count = 3
        with self.assertRaises(update.UpdateError):
            handler.redirect_request(None, None, 302, "", {}, "https://release-assets.githubusercontent.com/github-production-release-asset/12/abcdef")
        handler = update.ReleaseRedirects(url, update.Deadline(-1))
        with self.assertRaises(update.UpdateError):
            handler.redirect_request(None, None, 302, "", {}, "https://example.test")


if __name__ == "__main__":
    unittest.main()
