"""Offline local-panel queue and input tests. No broker/network access."""
import base64
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"runtime"))
from panel_client import Mailbox, PanelError, make_trade, make_close, load_states
from resident_core import validate

NOW=1800000000.
CONFIG={"symbol":"XAUUSD","size_mode":"fixed","fixed_lots":0.05,"risk_percent":0.5}
class FakeGitHub:
    def __init__(self):
        self.control={"schema":2,"device":"worker-01-resident","enabled":True,"jobs":[]}
        self.sha=1
        self.writes=0
        self.conflict_once=False
        self.unknown_once=False
        self.unrelated={"id":"remote-other","action":"ping","expires_at":"2099-01-01T00:00:00Z"}
    def get(self,*args,**kwargs):
        return json.dumps(self.control).encode(),str(self.sha)
    def request(self,method,path,payload):
        assert method=="PUT"
        if self.conflict_once:
            self.conflict_once=False
            self.control["jobs"].append(deepcopy(self.unrelated))
            self.sha+=1
            raise Exception("GITHUB_HTTP_409")
        assert payload["sha"]==str(self.sha)
        self.control=json.loads(base64.b64decode(payload["content"]))
        self.sha+=1
        self.writes+=1
        if self.unknown_once:
            self.unknown_once=False
            raise Exception("GITHUB_NETWORK_ERROR")
        return {"commit":{"sha":"ok"}}
class PanelTest(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.gh=FakeGitHub()
        self.mailbox=Mailbox(self.gh,"olfx-mt5-bridge","worker-01-resident",self.tmp.name,
                             lambda job,symbol:validate(job,symbol,NOW),"XAUUSD")
    def job(self,identifier="local-one",**kwargs):
        return make_trade(CONFIG,"buy",None,0,clock=lambda:NOW,identifier=identifier,sl_distance=5.,tp_distance=10.,**kwargs)
    def test_manual_job_has_no_strategy_timeframe(self):
        job=self.job()
        self.assertNotIn("timeframe",job)
        self.assertEqual(job["hold_seconds"],0)
        self.assertEqual(job["lots"],0.05)
        validate(job,"XAUUSD",NOW)
    def test_direct_entry_expires_in_two_minutes(self):
        job=self.job()
        stamp=datetime.fromisoformat(job["expires_at"]).timestamp()
        self.assertEqual(stamp-NOW,120)
    def test_structure_uses_selected_timeframe(self):
        job=make_trade(CONFIG,"structure","M1",5,clock=lambda:NOW)
        self.assertEqual(job["timeframe"],"M1")
        self.assertNotIn("sl_distance",job)
    def test_explicit_risk_excludes_fixed_lots(self):
        job=self.job(size_mode="risk",size=0.5)
        self.assertEqual(job["risk_percent"],0.5)
        self.assertNotIn("lots",job)
    def test_configured_percent_is_explicit(self):
        config={**CONFIG,"size_mode":"percent","risk_percent":1.0}
        job=make_trade(config,"buy",None,0,clock=lambda:NOW,sl_distance=5.,tp_distance=10.)
        self.assertEqual(job["risk_percent"],1.0)
        self.assertNotIn("lots",job)
    def test_close_has_specific_target(self):
        job=make_close("other",clock=lambda:NOW)
        self.assertEqual(job["target_id"],"other")
        validate(job,"XAUUSD",NOW)
    def test_append_preserves_old_jobs(self):
        self.gh.control["jobs"]=[deepcopy(self.gh.unrelated)]
        self.mailbox.submit(self.job())
        self.assertEqual(self.gh.control["jobs"][0],self.gh.unrelated)
        self.assertEqual(len(self.gh.control["jobs"]),2)
    def test_conflict_merges_concurrent_chat_command(self):
        self.gh.conflict_once=True
        self.mailbox.submit(self.job())
        self.assertEqual([j["id"] for j in self.gh.control["jobs"]],["remote-other","local-one"])
        self.assertEqual(self.gh.writes,1)
    def test_repeated_same_job_never_duplicates(self):
        self.mailbox.submit(self.job())
        self.mailbox.submit(self.job())
        self.assertEqual(self.gh.writes,1)
    def test_changed_id_payload_is_rejected(self):
        job=self.job()
        self.mailbox.submit(job)
        with self.assertRaisesRegex(PanelError,"TASK_ID_REUSED"):
            self.mailbox.submit({**job,"lots":0.1})
        self.assertEqual(self.gh.writes,1)
    def test_unknown_write_can_retry_same_id_without_duplicate(self):
        self.gh.unknown_once=True
        with self.assertRaises(Exception):
            self.mailbox.submit(self.job())
        self.assertEqual(len(self.mailbox.unresolved()),1)
        self.mailbox.submit(self.job())
        self.assertEqual(len(self.gh.control["jobs"]),1)
        self.assertEqual(self.gh.writes,1)
        self.assertFalse(self.mailbox.unresolved())
    def test_retry_expired_but_already_queued_is_verification_only(self):
        job=self.job()
        self.mailbox.submit(job)
        self.mailbox.validator=lambda *_: (_ for _ in ()).throw(Exception("TASK_EXPIRED"))
        self.assertEqual(self.mailbox.submit(job),"ALREADY_QUEUED")
        self.assertEqual(self.gh.writes,1)
    def test_disabled_mailbox_does_not_accept_new_entry(self):
        self.gh.control["enabled"]=False
        with self.assertRaisesRegex(PanelError,"DISABLED"):
            self.mailbox.submit(self.job())
        self.assertEqual(self.gh.writes,0)
    def test_full_queue_does_not_drop_old_jobs(self):
        self.gh.control["jobs"]=[{**self.gh.unrelated,"id":"old-"+str(i)} for i in range(100)]
        with self.assertRaisesRegex(PanelError,"QUEUE_FULL"):
            self.mailbox.submit(self.job())
        self.assertEqual(len(self.gh.control["jobs"]),100)
    def test_invalid_trade_never_writes(self):
        job={**self.job(),"lots":50.}
        with self.assertRaises(Exception):
            self.mailbox.submit(job)
        self.assertFalse(self.gh.writes)
    def test_journal_excludes_credentials(self):
        self.mailbox.submit(self.job())
        text=(Path(self.tmp.name)/"local-one.json").read_text()
        for value in ("token","password","login","server"):
            self.assertNotIn(value,text)
    def test_state_list_skips_invalid_json(self):
        (Path(self.tmp.name)/"broken.json").write_text("{")
        self.assertEqual(load_states(self.tmp.name),[])

if __name__=="__main__":
    unittest.main()
