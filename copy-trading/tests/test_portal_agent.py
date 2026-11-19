import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from copy_bot import Blocked, State
from scenario import example_config
from portal_agent import ControlledEngine, cycle, validate_group


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.group = {'id': 'g', 'revision': 1, 'mode': 'paper', 'paused': True, 'settings': example_config()}

    def test_real_mode_rejected(self):
        self.group['mode'] = 'real'
        with self.assertRaises(Blocked):
            validate_group(self.group, 'reader.exe')

    def test_shared_statistics_terminal_rejected(self):
        with self.assertRaises(Blocked):
            validate_group(self.group, self.group['settings']['master']['terminal_path'])

    def test_remote_pause_or_network_failure_stops_before_every_send(self):
        gate = Mock(side_effect=Blocked('paused'))
        engine = ControlledEngine(self.group['settings'], Mock(), gate)
        broker = Mock()
        for kind in ['open', 'close', 'modify']:
            with self.assertRaises(Blocked):
                engine.send({}, broker, {'kind': kind})
        broker.prepare.assert_not_called()
        broker.execute.assert_not_called()

    def test_disabled_receiver_does_not_access_mt5(self):
        self.group['settings']['followers'][0]['enabled'] = False
        with patch('portal_agent.MT5') as mt5:
            statuses = cycle(self.group, Mock(), Mock(), Mock())
        mt5.assert_not_called()
        self.assertEqual(list(statuses.values()), ['paused'])

    def test_gate_failure_never_opens_terminal(self):
        self.group['settings']['followers'][0]['enabled'] = True
        with patch('portal_agent.MT5') as mt5:
            statuses = cycle(self.group, Mock(), Mock(), Mock(side_effect=Blocked('offline')))
        mt5.assert_not_called()
        self.assertEqual(list(statuses.values()), ['error'])


if __name__ == '__main__':
    unittest.main()
