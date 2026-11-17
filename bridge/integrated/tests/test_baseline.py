import hashlib,importlib.util,json,sys,tempfile,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
import install_integrated as installer
spec=importlib.util.spec_from_file_location("bootstrap_baseline",BASE/"launcher"/"bridge_bootstrap.py")
u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
class BaselineTest(unittest.TestCase):
    def test_only_locally_pinned_baseline_can_be_loaded(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);package=root/"package";(package/"runtime").mkdir(parents=True)
            (package/"runtime"/"bridge_agent.py").write_text("# fixture\n")
            (package/"runtime"/"update_handoff.py").write_text("# fixture\n")
            managed=root/"managed";installer.install_baseline(package,managed)
            key=json.loads((BASE/"launcher"/"update_public_key.json").read_text())
            store=u.ReleaseStore(managed,key)
            self.assertEqual(store.current(),"000000-2.2.0")
            target=managed/"versions"/store.current()/"bridge_agent.py"
            target.write_text("# changed\n")
            with self.assertRaises(u.UpdateError):store.current()
    def test_production_public_key_is_preserved(self):
        self.assertEqual((BASE/"launcher"/"update_public_key.json").read_bytes(),(BASE/"original_launcher"/"update_public_key.json").read_bytes())
    def test_unsigned_network_release_cannot_enter_store(self):
        with tempfile.TemporaryDirectory() as folder:
            key=json.loads((BASE/"launcher"/"update_public_key.json").read_text())
            with self.assertRaises(u.UpdateError):u.ReleaseStore(folder,key).install(b'{"payload":{},"signature":"bad"}')
