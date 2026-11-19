"""Escenario reproducible sin Windows, MT5 ni credenciales."""
import copy
import json
from pathlib import Path
import tempfile
import time

from copy_bot import Engine, Paper, State


def example_config():
    cfg = json.loads(Path(__file__).with_name("config.example.json").read_text())
    cfg["followers"][0].update(enabled=True, lot_multiplier=0.5)
    return cfg


SPEC = {"point": 0.01, "digits": 2, "trade_tick_size": 0.01, "trade_contract_size": 100,
        "currency_profit": "USD", "volume_min": 0.01, "volume_step": 0.01, "volume_max": 100,
        "trade_stops_level": 0, "trade_freeze_level": 0, "filling_mode": 1}


class Quotes:
    equity = 10000

    def verify(self):
        return {"equity": self.equity}

    def symbol(self, name):
        return dict(SPEC)

    def quote(self, name):
        return {"ask": 2500.10, "bid": 2500.00}

    def risk(self, side, symbol, volume, price, sl):
        return abs(price - sl) * 100 * volume


def source(**changes):
    return {"identifier": 9001, "ticket": 9001, "symbol": "XAUUSD", "type": 0, "volume": 0.2,
            "sl": 2498.0, "tp": 2505.0, "price_open": 2500.10, "time_msc": int(time.time() * 1000), **changes}


def snap(*positions):
    return {"time": time.time(), "positions": copy.deepcopy(list(positions)), "symbols": {"XAUUSD": dict(SPEC)}}


def demonstrate():
    cfg = example_config()
    f = cfg["followers"][0]
    with tempfile.TemporaryDirectory(prefix="olfx_sim_") as directory:
        state = State(Path(directory) / "sim.json", cfg, "paper")
        data = state.follower(f["id"])
        broker = Paper(Quotes(), data)
        engine = Engine(cfg, state)
        engine.sync(f, snap(), broker)
        p = source()
        engine.sync(f, snap(p), broker)
        assert len(broker.positions()) == 1 and broker.positions()[0]["volume"] == 0.1
        print("1. BUY maestro 0.20 -> BUY simulado 0.10")
        engine.sync(f, snap(p), broker)
        assert len(broker.positions()) == 1
        print("2. Mismo evento repetido -> sigue una sola copia")
        p.update(sl=2499.0)
        engine.sync(f, snap(p), broker)
        assert broker.positions()[0]["sl"] == 2499.0
        print("3. SL maestro ajustado -> SL simulado actualizado")
        p.update(volume=0.1)
        engine.sync(f, snap(p), broker)
        assert broker.positions()[0]["volume"] == 0.05
        print("4. Cierre parcial maestro -> quedan 0.05 lotes simulados")
        engine.sync(f, snap(), broker)
        engine.sync(f, snap(), broker)
        assert not broker.positions() and data["records"]["9001"]["status"] == "closed"
        print("5. Cierre maestro -> copia cerrada; ningún cierre duplicado")
        print("SIMULACIÓN COMPLETADA: 0 órdenes enviadas a un bróker.")


if __name__ == "__main__":
    demonstrate()
