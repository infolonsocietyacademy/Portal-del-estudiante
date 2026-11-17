import unittest
from pathlib import Path
from types import SimpleNamespace as NS
import test_breakfake as fixtures
from test_breakfake import bar,breakout,BASE
from gold_replay import Replay,ReplayBroker

class TP1Replay(unittest.TestCase):
 setUp=fixtures.Execution.setUp
 make=fixtures.Execution.make
 def replay(self,sell=False):
  rows=[bar(i) for i in range(96)]+[breakout(sell=sell)]
  self.mt.info.trade_contract_size=100.
  b=ReplayBroker(rows,self.mt.info,self.root/'paper',offset=0)
  r=Replay(b,self.cfg,self.root/'replay')
  bid=1998. if sell else 2002.
  r.tick(BASE+96*60,bid,bid+.16)
  r.tick(BASE+97*60,bid,bid+.16)
  self.assertEqual(len(b.sent),1)
  return b,r
 def test_buy_full_volume_exits_at_tp1(self):
  b,r=self.replay();order=b.sent[0]
  r.tick(BASE+97*60+1,order['tp'],order['tp']+.16)
  self.assertFalse(b.pos);self.assertEqual(b.closed[0]['reason'],'TP')
  self.assertEqual(b.closed[0]['volume'],.05)
  self.assertEqual(len(b.sent),1)
 def test_buy_stop_uses_bid(self):
  b,r=self.replay();order=b.sent[0]
  r.tick(BASE+97*60+1,order['sl'],order['sl']+.16)
  self.assertFalse(b.pos);self.assertEqual(b.closed[0]['reason'],'SL')
 def test_sell_stop_uses_ask(self):
  b,r=self.replay(sell=True);order=b.sent[0]
  r.tick(BASE+97*60+1,order['sl']-.16,order['sl'])
  self.assertFalse(b.pos);self.assertEqual(b.closed[0]['reason'],'SL')
 def test_sell_target_uses_ask(self):
  b,r=self.replay(sell=True);order=b.sent[0]
  r.tick(BASE+97*60+1,order['tp']-.16,order['tp'])
  self.assertFalse(b.pos);self.assertEqual(b.closed[0]['reason'],'TP')

if __name__=='__main__':unittest.main()
