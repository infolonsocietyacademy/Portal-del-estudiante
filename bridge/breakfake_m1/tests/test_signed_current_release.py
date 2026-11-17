"""The current automatic release must work with the already-installed trust key."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

BASE = Path(__file__).resolve().parents[1]


class CurrentSignedRelease(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location(
            'current_release_bootstrap', BASE.parent / 'original/bridge_bootstrap.py')
        cls.boot = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.boot)
        cls.raw = (BASE / 'releases/release_1.0.19.json').read_bytes()
        cls.key = json.loads((BASE.parent / 'original/update_public_key.json').read_text())

    def test_original_installed_key_accepts_current_release(self):
        doc, _ = self.boot.parse_release(self.raw, self.key)
        self.assertEqual(doc['payload']['version'], '1.0.19')
        self.assertEqual(doc['payload']['sequence'], 19)

    def test_current_signed_files_exactly_match_tested_runtime(self):
        doc, archive = self.boot.parse_release(self.raw, self.key)
        expected = {p.relative_to(BASE/'runtime').as_posix()
                    for p in (BASE/'runtime').rglob('*')
                    if p.is_file() and p.suffix in ('.py', '.mq5')
                    and '__pycache__' not in p.parts}
        self.assertEqual(set(doc['payload']['files']), expected)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            for name in expected:
                self.assertEqual(z.read(name), (BASE/'runtime'/name).read_bytes(), name)

    def test_current_archive_contains_no_private_keys_or_crt_motor(self):
        _, archive = self.boot.parse_release(self.raw, self.key)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            for name in z.namelist():
                self.assertNotIn(b'-----BEGIN PRIVATE KEY-----', z.read(name))
                self.assertNotIn(b'-----BEGIN RSA PRIVATE KEY-----', z.read(name))
            core = z.read('gold_scalp_core.py')
            self.assertNotIn(b'def crt_context(', core)
            self.assertNotIn(b'def crt_signal(', core)


if __name__ == '__main__':
    unittest.main()
