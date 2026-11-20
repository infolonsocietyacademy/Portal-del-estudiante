import contextlib
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

RUNTIME=Path(__file__).resolve().parents[1]/"runtime"
sys.path.insert(0,str(RUNTIME))
import lab_manager as lm
import bridge_agent as agent

class LabManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)/"bridge";self.root.mkdir()
        self.target=self.root/"olfx-lab";self.target.mkdir()
        (self.target/"lab.py").write_text("# OLFX original\n")
        (self.target/"ABRIR_OLFX_LAB.py").write_text("# original launcher\n")
        self.config=b'{"symbol":"USTECH","commission_roundtrip_per_lot":8.25,"private_note":"LOCAL_ONLY"}'
        (self.target/"config.json").write_bytes(self.config)
        (self.target/"validaciones_consumidas.json").write_text('[{"start":"2026-01-01","end":"2026-02-01"}]')
        exp=self.target/"experimentos"/"20261119_old";exp.mkdir(parents=True)
        (exp/"estado.json").write_text('{"status":"INCOMPLETO","error":"LOCAL_ONLY"}')
        self.roots=patch.object(lm,"allowed_roots",return_value=[self.target])
        self.roots.start()
    def tearDown(self):
        self.roots.stop();self.tmp.cleanup()
    def job(self,action,**kwargs):
        return dict(id="test-lab-job",action=action,
             expires_at=(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat(),**kwargs)
    def test_only_known_actions_and_fields(self):
        for extra in ({"shell":"whoami"},{"path":"C:/Windows"},{"source_ref":"a"*40},{"url":"https://x.invalid"}):
            with self.assertRaises(lm.LabError):
                lm.validate_job(self.job("lab_update",**extra))
        with self.assertRaises(lm.LabError): lm.validate_job(self.job("run_shell"))
    def test_bridge_expiry_and_fixed_actions(self):
        agent.validate_task(self.job("lab_update"))
        job=self.job("lab_status");job["expires_at"]="2020-01-01T00:00:00+00:00"
        with self.assertRaises(agent.BridgeError):agent.validate_task(job)
        with self.assertRaises(agent.BridgeError):agent.validate_task(self.job("lab_run",source_path="x.py"))
    def test_update_preserves_config_ledger_results(self):
        ledger=(self.target/"validaciones_consumidas.json").read_bytes()
        out=lm.update(self.root)
        self.assertEqual(out["code"],"LAB_UPDATED")
        self.assertEqual((self.target/"config.json").read_bytes(),self.config)
        self.assertEqual((self.target/"validaciones_consumidas.json").read_bytes(),ledger)
        self.assertEqual(json.loads((self.target/"experimentos"/"20261119_old"/"estado.json").read_text())["error"],"LOCAL_ONLY")
        self.assertTrue(lm.signature_matches(self.target))
        self.assertEqual((next((self.target/"actualizaciones").iterdir())/"lab.py").read_text(),"# OLFX original\n")
    def test_busy_lab_is_staged_then_applied_when_closed(self):
        lm.bind(self.root)
        with lm.lab_lock(self.target):
            self.assertEqual(lm.update(self.root)["code"],"LAB_UPDATE_WAITING_FOR_CLOSE")
            self.assertEqual((self.target/"lab.py").read_text(),"# OLFX original\n")
            lm.maintain(self.root)
            self.assertFalse(lm.signature_matches(self.target))
        lm.maintain(self.root)
        self.assertTrue(lm.signature_matches(self.target))
        self.assertFalse((lm.state_dir(self.root)/"pending_update.json").exists())
    def test_failed_copy_rolls_back_all_code(self):
        original_replace=lm.os.replace
        def fail(src,dst):
            if Path(src).name=="simple_ui.py.updating":raise OSError("synthetic copy failure")
            return original_replace(src,dst)
        with patch.object(lm.os,"replace",side_effect=fail):
            with self.assertRaises(OSError):lm.update(self.root)
        self.assertEqual((self.target/"lab.py").read_text(),"# OLFX original\n")
        self.assertEqual((self.target/"ABRIR_OLFX_LAB.py").read_text(),"# original launcher\n")
        self.assertFalse((self.target/"bootstrap.py").exists())
        self.assertEqual((self.target/"config.json").read_bytes(),self.config)
    def test_unsafe_binding_rejected(self):
        lm.write(lm.state_dir(self.root)/"binding.json",{"path":str(Path(self.tmp.name)/"elsewhere")})
        with self.assertRaises(lm.LabError):lm.installed(self.root)
    def test_symlink_rejected(self):
        other=Path(self.tmp.name)/"outside";other.mkdir()
        link=self.target/"alias";link.symlink_to(other,target_is_directory=True)
        with self.assertRaises(lm.LabError):lm.safe_target(link/"x.py",self.root)
    def test_multiple_candidates_require_attach(self):
        with patch.object(lm,"discover",return_value=[{"id":"a","busy":False},{"id":"b","busy":False}]):
            with self.assertRaisesRegex(lm.LabError,"MULTIPLE"):lm.bind(self.root)
    def test_attach_uses_opaque_local_candidate(self):
        key="0123456789abcdef"
        lm.write(lm.state_dir(self.root)/"candidates.json",{key:str(self.target)})
        self.assertEqual(lm.execute(self.job("lab_attach",candidate_id=key),self.root)["code"],"LAB_ATTACHED")
        with self.assertRaises(lm.LabError):lm.validate_job(self.job("lab_attach",candidate_id="../../bad"))
    def test_payload_tampering_blocks_execution(self):
        lm.update(self.root);(self.target/"lab.py").write_text("tampered")
        with self.assertRaisesRegex(lm.LabError,"UPDATE_REQUIRED"):lm.start(self.root,"optimize")
    def test_launch_has_fixed_command_and_no_shell(self):
        lm.update(self.root)
        with patch.object(lm.subprocess,"Popen") as popen:
            out=lm.start(self.root,"doctor")
        self.assertEqual(out["code"],"LAB_JOB_STARTED")
        args=popen.call_args.args[0];kw=popen.call_args.kwargs
        self.assertEqual(args[2],str(self.target/"lab_remote_worker.py"))
        self.assertEqual(args[3:5],["--mode","doctor"])
        self.assertNotIn("shell",kw)
        self.assertEqual(kw["cwd"],self.target)
        with self.assertRaisesRegex(lm.LabError,"ALREADY_RUNNING"):lm.start(self.root,"optimize")
    def test_stop_is_cooperative_and_only_for_remote_job(self):
        lm.update(self.root)
        with self.assertRaises(lm.LabError):lm.stop(self.root)
        lm.write(self.target/"remote_result.json",{"state":"RUNNING","mode":"optimize"})
        out=lm.stop(self.root)
        self.assertEqual(out["code"],"LAB_STOP_REQUESTED")
        self.assertTrue((self.target/"remote_stop").exists())
        self.assertFalse((self.root/"STOP").exists())
    def test_status_does_not_publish_paths_or_config(self):
        lm.update(self.root)
        out=json.dumps(lm.status(self.root))
        self.assertNotIn(str(self.tmp.name),out)
        self.assertNotIn("LOCAL_ONLY",out)
        self.assertNotIn("USTECH",out)
    def test_results_filter_private_fields(self):
        lm.update(self.root)
        p=self.target/"experimentos"/"20261119_old"/"estado.json"
        lm.write(p,{"status":"LISTA_PARA_DEMO","error":"LOCAL_ONLY","validation":{"trades":50,"winrate":.7,"password":"LOCAL_ONLY"},"windows_14_30_60_90":{"14":{"trades":5,"private_note":"LOCAL_ONLY"}}})
        out=lm.results(self.root)
        self.assertEqual(out["validation"]["trades"],50)
        self.assertNotIn("LOCAL_ONLY",json.dumps(out))
        self.assertEqual(set(out["windows_14_30_60_90"]),{"14","30","60","90"})
    def test_worker_nonce_rejects_unrequested_job(self):
        lm.update(self.root)
        lm.write(self.target/"remote_control.json",{"mode":"doctor","nonce":"expected"})
        run=subprocess.run([sys.executable,str(self.target/"lab_remote_worker.py"),"--mode","doctor","--nonce","wrong"],capture_output=True,timeout=10)
        self.assertEqual(run.returncode,2)
        self.assertFalse((self.target/"remote_result.json").exists())
    def test_management_failure_does_not_hide_bridge_status(self):
        with patch.object(lm,"status",side_effect=OSError("synthetic")):
            out=agent.status_snapshot(self.root,"offline")
        self.assertEqual(out["lab"]["code"],"LAB_STATUS_UNAVAILABLE")
        self.assertEqual(out["state"],"offline")

if __name__=="__main__":unittest.main()

