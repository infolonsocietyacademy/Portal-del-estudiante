import importlib.util
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

BASE=Path(__file__).resolve().parents[1]

def mod(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class OwnerRecovery(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.owner=mod('owner_recovery',BASE/'recovery/install_owner.py')
  cls.boot=mod('owner_bootstrap_fixture',BASE/'recovery/bridge_bootstrap.py')
 def test_signed_recovery_release_verifies_and_matches_all_runtime_files(self):
  raw=(BASE/'recovery/release_1.0.16.json').read_bytes()
  doc,archive=self.boot.parse_release(raw,self.owner.NEW_KEY)
  import zipfile,io
  with zipfile.ZipFile(io.BytesIO(archive)) as z:
   self.assertEqual(doc['payload']['version'],'1.0.16')
   for name in z.namelist():self.assertEqual(z.read(name),(BASE/'runtime'/name).read_bytes(),name)
 def test_new_release_is_rejected_by_original_trust_until_owner_installs_new_key(self):
  raw=(BASE/'recovery/release_1.0.16.json').read_bytes()
  with self.assertRaises(self.boot.UpdateError):self.boot.parse_release(raw,self.owner.OLD_KEY)
 def test_recovery_bootstrap_is_identical_to_original(self):
  raw=(BASE/'recovery/bridge_bootstrap.py').read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),self.owner.BOOTSTRAP_SHA)
  self.assertEqual(raw,(BASE.parent/'original/bridge_bootstrap.py').read_bytes())
 def test_release_hash_is_pinned_in_owner_installer(self):
  raw=(BASE/'recovery/release_1.0.16.json').read_bytes()
  self.assertEqual(hashlib.sha256(raw).hexdigest(),self.owner.RELEASE_SHA)
 def test_staging_does_not_activate_or_overwrite_original_signed_version(self):
  raw=(BASE/'recovery/release_1.0.16.json').read_bytes()
  with TemporaryDirectory() as temp:
   root=Path(temp);old=root/'current_runtime.json';old.write_text('{"dir":"000014-1.0.14"}')
   store=self.boot.ReleaseStore(root,self.owner.NEW_KEY);slug=store.install(raw)
   self.assertEqual(old.read_text(),'{"dir":"000014-1.0.14"}')
   self.assertEqual(slug,'000016-1.0.16')
 def test_material_configuration_is_required_and_only_hashed(self):
  with TemporaryDirectory() as temp:
   root=Path(temp)
   with self.assertRaisesRegex(RuntimeError,'EXISTING_CONFIGURATION'):self.owner.critical_hashes(root)
   for name in self.owner.CRITICAL:
    p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'preserve-me')
   before=self.owner.critical_hashes(root)
   self.assertEqual(len(before),len(self.owner.CRITICAL))
   self.assertTrue(all(len(v)==64 for v in before.values()))
   self.assertTrue(all((root/name).read_bytes()==b'preserve-me' for name in self.owner.CRITICAL))
 def test_original_launcher_discovery_is_read_only_and_safe_off_windows(self):
  with patch.object(self.owner.os,'name','posix'):
   self.assertEqual(self.owner.original_launchers(),[])
 def test_private_key_is_not_embedded_in_public_recovery_files(self):
  for p in (BASE/'recovery').iterdir():
   if p.is_file():
    raw=p.read_bytes()
    self.assertNotIn(b'-----BEGIN PRIVATE KEY-----',raw)
    self.assertNotIn(b'-----BEGIN RSA PRIVATE KEY-----',raw)

if __name__=='__main__':unittest.main()
