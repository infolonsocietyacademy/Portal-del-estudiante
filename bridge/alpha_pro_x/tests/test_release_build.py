import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

BASE=Path(__file__).resolve().parents[1]

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result

class SignedBuild(unittest.TestCase):
    def setUp(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        pub=key.public_key().public_numbers()
        self.public={'n':format(pub.n,'x'),'e':pub.e}
        self.key=self.root/'temporary-test-key.pem'
        self.key.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
        self.public_file=self.root/'public.json';self.public_file.write_text(json.dumps(self.public))
        self.builder=module('candidate_release_builder',BASE/'build_release.py')
        self.launcher=module('installed_launcher',BASE.parent/'original'/'bridge_bootstrap.py')
    def test_signed_package_uses_installed_launcher_format(self):
        raw=self.builder.build(self.key,self.public_file)
        doc,archive=self.launcher.parse_release(raw,self.public)
        self.assertEqual(doc['payload']['version'],'1.0.15')
        self.assertIn('alpha_pro_x.py',doc['payload']['files'])
        self.assertIn('gold_scalp_core.py',doc['payload']['files'])
        self.assertGreater(len(archive),1000)
    def test_wrong_signing_key_cannot_build_original_trust_release(self):
        original=BASE.parent/'original'/'update_public_key.json'
        with self.assertRaisesRegex(ValueError,'KEY_DOES_NOT_MATCH_INSTALLED_LAUNCHER'):
            self.builder.build(self.key,original)

if __name__=='__main__':unittest.main()
