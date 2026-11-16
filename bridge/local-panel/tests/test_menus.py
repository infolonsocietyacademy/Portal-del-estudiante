"""UI separation tests. No broker or network calls."""
import contextlib
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch,Mock
BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
sys.path.insert(0,str(BASE/"menus"))
from menu_scope import mode_actions,allowed_direction,request_in_mode,selected_states
import panel_local as ui
from panel_client import PanelError
from separar_menus import install_ui

def state(jid,direction,phase="open"):
    return {"id":jid,"phase":phase,"job":{"action":"trade","direction":direction,"symbol":"XAUUSD"},"updated_at":1}

class MenuScopeTest(unittest.TestCase):
    def setUp(self):
        self.states=[state("manual-buy","buy"),state("manual-sell","sell"),
                     state("strategy","structure","waiting"),state("finished","buy","done")]
    def test_manual_menu_has_no_structure_entry(self):
        actions={entry[1] for entry in mode_actions("manual").values()}
        self.assertIn("buy",actions)
        self.assertIn("sell",actions)
        self.assertNotIn("structure",actions)
    def test_strategy_menu_has_no_direct_entries(self):
        actions={entry[1] for entry in mode_actions("strategy").values()}
        self.assertIn("structure",actions)
        self.assertNotIn("buy",actions)
        self.assertNotIn("sell",actions)
    def test_manual_active_selection_excludes_strategy(self):
        self.assertEqual([s["id"] for s in selected_states(self.states,"manual",True)],["manual-buy","manual-sell"])
    def test_strategy_selection_excludes_manual(self):
        self.assertEqual([s["id"] for s in selected_states(self.states,"strategy")],["strategy"])
    def test_close_retry_inherits_target_scope(self):
        job={"action":"close","target_id":"strategy"}
        self.assertTrue(request_in_mode(job,"strategy",self.states))
        self.assertFalse(request_in_mode(job,"manual",self.states))
    def test_unknown_target_cannot_cross_scope(self):
        self.assertFalse(request_in_mode({"action":"close","target_id":"missing"},"manual",self.states))
    def test_invalid_mode_rejected(self):
        with self.assertRaises(ValueError):
            mode_actions("all")
    def test_manual_function_blocks_structure_before_any_submission(self):
        with patch.object(ui,"MODE","manual"),patch.object(ui,"assert_receiver") as guard:
            with self.assertRaises(PanelError):
                ui.trade_menu(Mock(),{},"structure")
            guard.assert_not_called()
    def test_strategy_function_blocks_manual_before_any_submission(self):
        with patch.object(ui,"MODE","strategy"),patch.object(ui,"assert_receiver") as guard:
            with self.assertRaises(PanelError):
                ui.trade_menu(Mock(),{},"buy")
            guard.assert_not_called()
    def close_all(self,mode):
        with TemporaryDirectory() as folder:
            root=Path(folder)
            (root/"state").mkdir()
            for s in self.states:
                (root/"state"/(s["id"]+".json")).write_text(json.dumps(s))
            sent=[]
            with patch.object(ui,"DATA",root),patch.object(ui,"MODE",mode),patch("builtins.input",return_value="CERRAR"),patch.object(ui,"submit_and_watch",side_effect=lambda mailbox,job:sent.append(job)),contextlib.redirect_stdout(io.StringIO()):
                ui.close_menu(Mock(),all_active=True)
            return [j["target_id"] for j in sent]
    def test_manual_close_all_cannot_close_strategy(self):
        self.assertCountEqual(self.close_all("manual"),["manual-buy","manual-sell"])
    def test_strategy_close_all_cannot_close_manual(self):
        self.assertEqual(self.close_all("strategy"),["strategy"])

class MenuInstallerTest(unittest.TestCase):
    def test_ui_install_keeps_receiver_state_and_token_unchanged(self):
        with TemporaryDirectory() as folder:
            root=Path(folder)
            source=root/"source"
            data=root/"resident-v2"
            panel=data/"panel"
            desktop=root/"desktop"
            source.mkdir()
            panel.mkdir(parents=True)
            for name in ("panel_local.py","menu_scope.py","PANEL_ORDENES.cmd","ESTRATEGIA.cmd"):
                (source/name).write_text("new "+name)
            (panel/"panel_local.py").write_text("old menu")
            (panel/"panel_client.py").write_text("existing client")
            (data/"state").mkdir()
            (data/"state"/"active.json").write_text("existing active state")
            (data/"worker.lock").write_text("0")
            (data/"INICIAR_RESIDENTE.cmd").write_text("original receiver launcher")
            token=root/"token.dpapi"
            token.write_bytes(b"private fixture")
            expected={p:p.read_bytes() for p in (panel/"panel_client.py",data/"state"/"active.json",data/"worker.lock",data/"INICIAR_RESIDENTE.cmd",token)}
            install_ui(source,data,desktop)
            for path,value in expected.items():
                self.assertEqual(path.read_bytes(),value)
            self.assertFalse((data/"STOP").exists())
            self.assertTrue((desktop/"OLFX_PANEL_ORDENES.cmd").is_file())
            self.assertTrue((desktop/"OLFX_ESTRATEGIA.cmd").is_file())
    def test_missing_panel_refuses_install(self):
        with TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError):
                install_ui(folder,Path(folder)/"missing")
