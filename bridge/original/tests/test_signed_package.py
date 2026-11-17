import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

BASE = Path(__file__).resolve().parents[1]
sys_path = str(BASE / "runtime")
import sys
sys.path.insert(0, sys_path)
from gold_scalp_core import VERSION
spec = importlib.util.spec_from_file_location("original_bootstrap", BASE / "bridge_bootstrap.py")
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class SignedPackageTest(unittest.TestCase):
    def release(self):
        local = BASE / "signed_release.json"
        path = local if local.is_file() else BASE.parents[1] / "bridge" / "updates" / "releases" / (VERSION+".json")
        return path.read_bytes(), json.loads((BASE / "update_public_key.json").read_text())

    def test_installed_original_launcher_accepts_signature_and_exact_sources(self):
        raw, key = self.release()
        doc, archive = bootstrap.parse_release(raw, key)
        self.assertEqual(doc["payload"]["version"], VERSION)
        self.assertEqual(doc["payload"]["launcher"], 1)
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            for name in z.namelist():
                self.assertEqual(z.read(name), (BASE / "runtime" / name).read_bytes(), name)

    def test_altered_release_is_rejected(self):
        raw, key = self.release()
        doc = json.loads(raw)
        doc["payload"]["version"] = "9.9.9"
        with self.assertRaises(bootstrap.UpdateError):
            bootstrap.parse_release(json.dumps(doc).encode(), key)


if __name__ == "__main__":
    unittest.main()
