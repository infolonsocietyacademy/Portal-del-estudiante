"""Installer state checks; no Windows process or broker access."""
import json
import os
import hashlib
import subprocess
from contextlib import contextmanager
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from install_panel import active_requests,launcher,running
class InstallerTest(unittest.TestCase):
    def test_active_position_blocks_update(self):
        with TemporaryDirectory() as folder:
            path=Path(folder)/"one.json"
            path.write_text(json.dumps({"id":"one","phase":"open","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),["one"])
    def test_waiting_strategy_blocks_update_instead_of_cancelling(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"one.json").write_text(json.dumps({"id":"one","phase":"waiting","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),["one"])
    def test_corrupt_state_fails_closed(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"bad.json").write_text("{")
            self.assertTrue(active_requests(folder))
    def test_finished_state_allows_update(self):
        with TemporaryDirectory() as folder:
            (Path(folder)/"one.json").write_text(json.dumps({"id":"one","phase":"done","job":{"action":"trade"}}))
            self.assertEqual(active_requests(folder),[])
    def test_launcher_uses_new_runtime_only(self):
        value=launcher("run","DEMO")
        self.assertIn("2.0.1-rc1",value)
        self.assertNotIn("taskkill",value.lower())
        self.assertNotIn("mt5-test",value.lower())

@contextmanager
def held_worker_lock(folder):
    """A distinct Windows process holds exactly the byte protected by the resident."""
    code="import msvcrt,sys; from pathlib import Path; p=Path(sys.argv[1]); f=p.open('a+b'); f.seek(0,2); f.write(b'0') if f.tell()==0 else None; f.flush(); f.seek(0); msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1); print('READY',flush=True); sys.stdin.readline(); f.close()"
    child=subprocess.Popen([sys.executable,"-u","-c",code,str(Path(folder)/"worker.lock")],
        stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        if child.stdout.readline().strip()!="READY":
            raise AssertionError("Worker lock fixture failed")
        yield child
    finally:
        try:
            child.communicate("\n",timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate(timeout=5)

@unittest.skipUnless(os.name=="nt","Requires real Windows byte-range locks")
class WindowsInstallerLockTest(unittest.TestCase):
    def test_probe_never_reads_byte_locked_by_active_worker(self):
        with TemporaryDirectory() as folder:
            with held_worker_lock(folder):
                with self.assertRaises(PermissionError):
                    with (Path(folder)/"worker.lock").open("rb") as stream:
                        stream.read(1)
                self.assertTrue(running(folder))
    def test_probe_allows_install_after_worker_releases_lock(self):
        with TemporaryDirectory() as folder:
            with held_worker_lock(folder):
                self.assertTrue(running(folder))
            self.assertFalse(running(folder))
            self.assertFalse(running(folder))

class InstallerScopeTest(unittest.TestCase):
    def test_published_resident_worker_remains_byte_identical(self):
        path=Path(__file__).resolve().parents[1]/"runtime"/"resident_worker.py"
        data=path.read_bytes()
        blob=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
        self.assertEqual(blob,"3fb9e51f4e84ed5555048178f2368bfeea1a1809")

if __name__=="__main__":
    unittest.main()
