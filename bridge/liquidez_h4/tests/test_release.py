import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

BASE=Path(__file__).resolve().parents[1]


class ReleaseTests(unittest.TestCase):
    def test_installed_trust_key_accepts_exact_runtime_without_secrets(self):
        spec=importlib.util.spec_from_file_location('liqh4_bootstrap',BASE.parent/'original/bridge_bootstrap.py')
        boot=importlib.util.module_from_spec(spec);spec.loader.exec_module(boot)
        doc,raw=boot.parse_release((BASE/'release_1.0.21.json').read_bytes(),
                                 json.loads((BASE.parent/'original/update_public_key.json').read_text()))
        self.assertEqual(doc['payload']['version'],'1.0.21')
        self.assertEqual(doc['payload']['sequence'],21)
        paths={p.relative_to(BASE/'runtime').as_posix():p for p in (BASE/'runtime').rglob('*')
               if p.is_file() and p.suffix in ('.py','.mq5') and '__pycache__' not in p.parts}
        self.assertEqual(set(paths),set(doc['payload']['files']))
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            for name,path in paths.items():
                self.assertEqual(z.read(name),path.read_bytes())
                self.assertNotIn(b'-----BEGIN PRIVATE KEY-----',z.read(name))
                self.assertNotIn(b'-----BEGIN RSA PRIVATE KEY-----',z.read(name))
            self.assertIn('liquidez_h4.py',z.namelist())
            self.assertNotIn('breakfake_m1.py',z.namelist())


if __name__=='__main__':unittest.main()
