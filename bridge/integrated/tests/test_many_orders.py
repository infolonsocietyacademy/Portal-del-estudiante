"""Multiple DEMO commands, open terminals and mailbox growth; simulated broker only."""
import base64
import json
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
import test_resident as regression
from resident_core import Fault, magic_for
from panel_client import Mailbox, PanelError, validate_control

class ManyOrdersTest(unittest.TestCase):
    setUp=regression.EngineTest.setUp
    make=regression.EngineTest.make
    job=regression.EngineTest.job
    open=regression.EngineTest.open

    def manual(self,jid,direction="buy"):
        job=self.job(jid,direction=direction,sl_distance=5.,hold_seconds=0)
        job.pop("timeframe")
        return job

    def test_accepts_more_than_old_mailbox_limit_without_opening_anything(self):
        for i in range(125):
            self.engine.accept(self.job("waiting"+str(i),direction="structure"))
        self.assertEqual(len(self.engine.states),125)
        self.assertFalse(self.m.sent)

    def test_open_terminal_accepts_25_buys_and_sells_and_preserves_foreign_trade(self):
        foreign=NS(ticket=1,magic=999,symbol="XAUUSD",volume=.01,type=0,
                   time=int(self.now()),price_open=1999.,profit=3.,swap=0.)
        self.m.pos.append(foreign)
        for i in range(25):
            self.engine.accept(self.manual("manual"+str(i),"buy" if i%2==0 else "sell"))
        for _ in range(26):
            self.engine.tick()
        self.assertEqual(len(self.m.sent),25)
        self.assertEqual(len(self.m.pos),26)
        self.assertTrue(all(s["phase"]=="open" for s in self.engine.states.values()))
        self.assertEqual(len({p.magic for p in self.m.pos}),26)
        self.assertIn(foreign,self.m.pos)
        self.assertTrue(all("sl" in r and "tp" in r for r in self.m.sent))

    def test_closing_one_of_twelve_preserves_all_other_positions(self):
        for i in range(12):
            self.engine.accept(self.manual("manual"+str(i)))
            self.engine.tick()
            self.engine.tick()
        self.engine.accept({"id":"close-one","action":"close","target_id":"manual5",
                            "expires_at":self.job()["expires_at"]})
        self.engine.tick()
        self.engine.tick()
        self.assertEqual(len(self.m.pos),11)
        self.assertNotIn(magic_for("manual5"),[p.magic for p in self.m.pos])
        self.assertEqual(self.engine.states["manual5"]["phase"],"done")

    def test_uncertain_send_queues_new_commands_but_never_duplicates_entry(self):
        self.m.next_code=None
        self.open("uncertain")
        self.engine.accept(self.manual("next"))
        self.m.next_code=self.m.TRADE_RETCODE_DONE
        for _ in range(4):
            self.engine.tick()
        self.assertEqual(len(self.m.sent),1)
        self.assertEqual(self.engine.states["next"]["phase"],"waiting")
        self.assertEqual(self.engine.states["next"]["code"],"WAIT_RECONCILIATION")

    def test_restart_and_redelivery_do_not_duplicate_many_positions(self):
        for i in range(12):
            self.engine.accept(self.manual("manual"+str(i)))
            self.engine.tick()
            self.engine.tick()
        self.engine=self.make()
        for i in range(12):
            self.engine.accept(self.manual("manual"+str(i)))
        self.engine.tick()
        self.assertEqual(len(self.m.sent),12)
        self.assertEqual(len(self.m.pos),12)

    def test_broker_rejection_still_blocks_every_order(self):
        self.m.check_code=10019
        for i in range(12):
            self.engine.accept(self.manual("manual"+str(i)))
        self.engine.tick()
        self.assertFalse(self.m.sent)
        self.assertTrue(all(s["phase"]=="failed" for s in self.engine.states.values()))

class FakeGitHub:
    def __init__(self,control):
        self.control=control
        self.writes=0
    def get(self,path,ref=None):
        return json.dumps(self.control).encode(),"current-sha"
    def request(self,method,path,payload):
        self.control=json.loads(base64.b64decode(payload["content"]))
        self.writes+=1
        return {"content":{"sha":"next-sha"}}

class MailboxGrowthTest(unittest.TestCase):
    setUp=regression.EngineTest.setUp
    make=regression.EngineTest.make
    job=regression.EngineTest.job

    def control(self,count):
        return {"schema":2,"device":"worker-01-resident","enabled":True,
                "jobs":[self.job("existing"+str(i)) for i in range(count)]}

    def test_reader_accepts_more_than_100_jobs(self):
        control=self.control(150)
        self.assertEqual(len(validate_control(control,"worker-01-resident")),150)

    def test_panel_appends_101st_and_102nd_job_and_preserves_queue(self):
        gh=FakeGitHub(self.control(100))
        original=json.loads(json.dumps(gh.control["jobs"]))
        box=Mailbox(gh,"olfx-mt5-bridge","worker-01-resident",
                    Path(self.tmp.name)/"journal",lambda *args:None,"XAUUSD")
        self.assertEqual(box.submit(self.job("new101")),"QUEUED")
        self.assertEqual(box.submit(self.job("new102")),"QUEUED")
        self.assertEqual(box.submit(self.job("new102")),"ALREADY_QUEUED")
        self.assertEqual(gh.control["jobs"][:100],original)
        self.assertEqual(len(gh.control["jobs"]),102)
        self.assertEqual(gh.writes,2)

    def test_duplicate_ids_still_rejected_in_large_queue(self):
        control=self.control(150)
        control["jobs"].append(dict(control["jobs"][0]))
        with self.assertRaises(PanelError):
            validate_control(control,"worker-01-resident")

    def test_wrong_device_still_rejected(self):
        with self.assertRaises(PanelError):
            validate_control(self.control(150),"another-device")

if __name__=="__main__":
    unittest.main()
