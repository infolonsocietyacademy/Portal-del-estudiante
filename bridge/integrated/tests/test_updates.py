import base64,hashlib,io,json,os,subprocess,sys,tempfile,time,unittest,zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import padding,rsa
import importlib.util
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE/"runtime"))
spec=importlib.util.spec_from_file_location("integrated_bootstrap_under_test",BASE/"launcher"/"bridge_bootstrap.py")
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
import update_handoff as h

class UpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        n=cls.private.public_key().public_numbers();cls.key={'n':format(n.n,'x'),'e':n.e}

    def signed(self,payload):
        sig=self.private.sign(u.canonical(payload),padding.PKCS1v15(),hashes.SHA256())
        return json.dumps({'payload':payload,'signature':base64.b64encode(sig).decode()},sort_keys=True).encode()

    def release(self,sequence=1,version='1.0.7',files=None):
        files=files or {'bridge_agent.py':b'print("engine")\n','update_handoff.py':b'# stub\n'}
        raw=io.BytesIO()
        with zipfile.ZipFile(raw,'w',zipfile.ZIP_DEFLATED) as z:
            for name,data in files.items():z.writestr(name,data)
        data=raw.getvalue();payload=dict(schema=1,sequence=sequence,version=version,launcher=2,session_schema=1,
            archive=base64.b64encode(data).decode(),archive_sha256=hashlib.sha256(data).hexdigest(),
            files={name:{'sha256':hashlib.sha256(blob).hexdigest(),'size':len(blob)} for name,blob in files.items()})
        return self.signed(payload)

    def test_signature_tampering_and_wrong_key_are_rejected(self):
        raw=self.release();self.assertEqual(u.parse_release(raw,self.key)[0]['payload']['version'],'1.0.7')
        doc=json.loads(raw);doc['payload']['version']='9.9.9'
        with self.assertRaises(u.UpdateError):u.parse_release(json.dumps(doc).encode(),self.key)
        doc=json.loads(raw);doc['signature']=base64.b64encode(b'\0'*256).decode()
        with self.assertRaises(u.UpdateError):u.parse_release(json.dumps(doc).encode(),self.key)
        other=rsa.generate_private_key(public_exponent=65537,key_size=2048).public_key().public_numbers()
        with self.assertRaises(u.UpdateError):u.parse_release(raw,{'n':format(other.n,'x'),'e':other.e})

    def test_signed_but_unsafe_archives_are_rejected(self):
        for name in ('../bad.py','/tmp/bad.py','demo/../../bad.py','C:/bad.py','demo\\bad.py','CON.py','settings.json','token.dpapi','bridge_bootstrap.py'):
            with self.subTest(name=name),self.assertRaises(u.UpdateError):
                u.parse_release(self.release(files={'bridge_agent.py':b'ok','update_handoff.py':b'ok',name:b'bad'}),self.key)

    def test_hash_mismatch_and_bad_metadata_fail_even_when_signed(self):
        doc=json.loads(self.release())
        for mutate in [lambda p:p['files']['bridge_agent.py'].update(sha256='0'*64),
            lambda p:p.update(archive_sha256='0'*64),lambda p:p.update(launcher=1),
            lambda p:p.update(sequence=True),lambda p:p.update(version='../oops')]:
            fresh=json.loads(json.dumps(doc['payload']));mutate(fresh)
            with self.subTest(payload=fresh['version']),self.assertRaises(u.UpdateError):u.parse_release(self.signed(fresh),self.key)

    def test_install_is_versioned_and_preserves_all_runtime_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sentinels=['token.dpapi','settings.json','gold_settings.json','structure-session.json','state/task.json','mt5-test/MQL5/Files/trades.csv']
            for name in sentinels:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'PRESERVE')
            store=u.ReleaseStore(root,self.key);first=store.install(self.release());store.activate(first)
            second=store.install(self.release(2,'1.0.8'));self.assertEqual(store.current(),first)
            store.activate(second);self.assertEqual(store.current(),second);store.activate(first)
            for name in sentinels:self.assertEqual((root/name).read_bytes(),b'PRESERVE')
            self.assertTrue((store.versions/second).exists())

    def test_partial_install_and_installed_tampering_cannot_be_activated(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=u.ReleaseStore(tmp,self.key);slug=store.install(self.release());store.activate(slug)
            (store.versions/slug/'bridge_agent.py').write_bytes(b'changed')
            with self.assertRaises(u.UpdateError):store.current()
            self.assertFalse((Path(tmp)/'outside.py').exists())

    def test_extra_executable_and_pointer_traversal_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            store=u.ReleaseStore(tmp,self.key);slug=store.install(self.release());store.activate(slug)
            (store.versions/slug/'unlisted.py').write_text('bad')
            with self.assertRaises(u.UpdateError):store.current()
            u.atomic_json(Path(tmp)/'current_runtime.json',{'dir':'../other'})
            with self.assertRaises(u.UpdateError):store.current()

    def test_mailbox_migration_does_not_overwrite_existing_config_or_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'data';root.mkdir();install=Path(tmp)/'install';install.mkdir()
            values=dict(repository='owner/repo',branch='updates',device='worker-01')
            (install/'bootstrap_config.json').write_text(json.dumps(values))
            (root/'token.dpapi').write_bytes(b'ENCRYPTED');(root/'settings.json').write_text('ORIGINAL')
            self.assertEqual(u.configure_mailbox(root,install),values)
            (install/'bootstrap_config.json').write_text(json.dumps(dict(values,repository='other/repo')))
            self.assertEqual(u.configure_mailbox(root,install),values)
            self.assertEqual((root/'token.dpapi').read_bytes(),b'ENCRYPTED');self.assertEqual((root/'settings.json').read_text(),'ORIGINAL')

    def test_handoff_requires_matching_live_nonce(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'OLFX_BRIDGE_LAUNCH_NONCE':'live'}):
            h.mark_ready(tmp,'1.0.7');self.assertTrue(u.healthy(tmp,'live','1.0.7'))
            u.atomic_json(Path(tmp)/'update_pending.json',{'nonce':'stale','sequence':2});self.assertFalse(h.update_pending(tmp))
            u.atomic_json(Path(tmp)/'update_pending.json',{'nonce':'live','sequence':2});self.assertTrue(h.update_pending(tmp))

    def stub(self,version,crash=False):
        if crash:return b'raise SystemExit(2)\n'
        return ('''import json,os,time,sys
from pathlib import Path
root=Path(os.environ['LOCALAPPDATA'])/'OLFX_MT5_BRIDGE';nonce=os.environ['OLFX_BRIDGE_LAUNCH_NONCE']
(root/'agent_health.json').write_text(json.dumps({'nonce':nonce,'version':%r}))
deadline=time.monotonic()+6
while time.monotonic()<deadline:
 try:
  p=json.loads((root/'update_pending.json').read_text())
  if p.get('nonce')==nonce:raise SystemExit(75)
 except (OSError,ValueError):pass
 if (root/'finish_test').exists():raise SystemExit(0)
 time.sleep(.02)
raise SystemExit(0)
'''%version).encode()

    def test_real_subprocess_update_and_preserved_mt5_marker(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'LOCALAPPDATA':tmp}):
            root=Path(tmp)/'OLFX_MT5_BRIDGE';store=u.ReleaseStore(root,self.key)
            first=store.install(self.release(files={'bridge_agent.py':self.stub('1.0.7'),'update_handoff.py':b'# helper'}));store.activate(first)
            latest=self.release(2,'1.0.8',files={'bridge_agent.py':self.stub('1.0.8'),'update_handoff.py':b'# helper'})
            sentinel=root/'mt5-stays-running';sentinel.write_text('UNCHANGED')
            def fetch():
                if store.load(store.current())[1]['sequence']==2:(root/'finish_test').touch()
                return latest
            code=u.Supervisor(store,fetch,check_seconds=.02,health_seconds=2).run()
            self.assertEqual(code,0);self.assertEqual(store.load(store.current())[1]['version'],'1.0.8')
            self.assertEqual(sentinel.read_text(),'UNCHANGED')

    def test_real_subprocess_bad_update_rolls_back_and_is_not_retried(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'LOCALAPPDATA':tmp}):
            root=Path(tmp)/'OLFX_MT5_BRIDGE';store=u.ReleaseStore(root,self.key)
            first=store.install(self.release(files={'bridge_agent.py':self.stub('1.0.7'),'update_handoff.py':b'# helper'}));store.activate(first)
            bad=self.release(2,'1.0.8',files={'bridge_agent.py':self.stub('1.0.8',True),'update_handoff.py':b'# helper'})
            def fetch():
                if store.failed(2):(root/'finish_test').touch()
                return bad
            code=u.Supervisor(store,fetch,check_seconds=.02,health_seconds=2).run()
            self.assertEqual(code,0);self.assertEqual(store.current(),first);self.assertTrue(store.failed(2))

    def test_unsigned_network_update_keeps_current_engine(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'LOCALAPPDATA':tmp}):
            root=Path(tmp)/'OLFX_MT5_BRIDGE';store=u.ReleaseStore(root,self.key)
            first=store.install(self.release(files={'bridge_agent.py':self.stub('1.0.7'),'update_handoff.py':b'# helper'}));store.activate(first)
            def fetch():(root/'finish_test').touch();return b'{"payload":{},"signature":"bad"}'
            self.assertEqual(u.Supervisor(store,fetch,check_seconds=.02,health_seconds=2).run(),0)
            self.assertEqual(store.current(),first)

if __name__=='__main__':unittest.main()
