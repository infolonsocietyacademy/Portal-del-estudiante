"""Explicit paired-DEMO Nasdaq discovery and symbol migration. No test orders."""
import math
from pathlib import Path
import time
from asset_spec import asset_kind, metadata_matches


def candidates(mt5):
    rows = mt5.symbols_get()
    if rows is None:
        raise ValueError('NAS100_SYMBOL_LIST_UNAVAILABLE')
    result = []
    for info in rows:
        if asset_kind(info.name) == 'nas100' and metadata_matches(info.name, info):
            result.append(info)
    return sorted(result, key=lambda x: x.name)[:20]


def describe(mt5, info):
    mt5.symbol_select(info.name, True)
    tick = mt5.symbol_info_tick(info.name)
    rows = mt5.copy_rates_from_pos(info.name, mt5.TIMEFRAME_M5, 1, 16)
    atr = None
    if rows is not None and len(rows) >= 15:
        atr = sum(max(float(b['high'])-float(b['low']), abs(float(b['high'])-float(a['close'])),
                      abs(float(b['low'])-float(a['close']))) for a,b in zip(rows[-15:],rows[-14:]))/14
    fields = ('name','description','currency_profit','trade_mode','trade_contract_size','trade_tick_size',
              'trade_tick_value','volume_min','volume_max','volume_step','trade_stops_level','point','digits')
    return {**{k:getattr(info,k) for k in fields}, 'atr_m5':atr,
            'bid':None if tick is None else float(tick.bid),
            'ask':None if tick is None else float(tick.ask),
            'spread_price':None if tick is None else float(tick.ask-tick.bid)}


def cash_cap(engine):
    """No larger planned dollar loss than the old fixed-volume maximum stop."""
    m = engine.mt5
    account = engine.guard(trade=True)
    if getattr(account, 'currency', None) != 'USD':
        raise ValueError('NAS100_USD_ACCOUNT_REQUIRED')
    old = engine.config
    if 'max_risk_cash' in old:
        return min(50., old['max_risk_cash'])
    if old['size_mode'] != 'fixed':
        return min(50., account.equity*old['risk_percent']/100)
    tick = m.symbol_info_tick(old['symbol'])
    if tick is None:
        raise ValueError('NAS100_PREVIOUS_RISK_UNAVAILABLE')
    loss = m.order_calc_profit(m.ORDER_TYPE_BUY, old['symbol'], old['fixed_lots'],
                              tick.ask, tick.ask-old['max_stop_price'])
    if loss is None or not math.isfinite(loss) or loss >= 0:
        raise ValueError('NAS100_PREVIOUS_RISK_UNAVAILABLE')
    return min(50., abs(loss))


def switch_settings(old, info, detail, cap):
    from gold_settings import validate_gold_settings
    if not metadata_matches(info.name, info) or asset_kind(info.name) != 'nas100':
        raise ValueError('NAS100_METADATA_MISMATCH')
    if not 0 < info.volume_min <= min(info.volume_max,1.) or info.volume_step <= 0:
        raise ValueError('NAS100_VOLUME_OUTSIDE_ENGINE_LIMIT')
    atr = detail.get('atr_m5')
    if atr is None or not math.isfinite(atr) or atr <= 0:
        raise ValueError('NAS100_M5_HISTORY_REQUIRED')
    return validate_gold_settings(dict(schema=1, symbol=info.name, size_mode='percent',
        fixed_lots=old['fixed_lots'], risk_percent=min(.5,old['risk_percent']),
        max_risk_cash=cap, max_spread_price=5., max_stop_price=round(min(300.,max(30.,4*atr)),2)))


def execute(job, root, api):
    import MetaTrader5 as mt5
    from gold_scalp_runner import connect
    from gold_settings import load_gold_settings, save_gold_settings
    from gold_scalp import stop, worker_locked, start, status
    from gold_scalp_core import LIVE_PHASES
    root = Path(root)
    folder = root/'gold-scalp-m1'
    try:
        engine = connect(mt5,root)
        available = candidates(mt5)
        if job['action'] == 'nas100_probe':
            return dict(code='NAS100_SYMBOLS_READ_ONLY', current_symbol=engine.config['symbol'],
                        account_type_verified='demo', candidates=[describe(mt5,i) for i in available])
        matches = [i for i in available if i.name == job['symbol']]
        api.require(len(matches)==1,'NAS100_EXACT_SYMBOL_UNAVAILABLE')
        info = matches[0]
        api.require(info.trade_mode == mt5.SYMBOL_TRADE_MODE_FULL,'NAS100_TRADING_UNAVAILABLE')
        detail = describe(mt5,info)
        old = dict(engine.config)
        cap = cash_cap(engine)
        config = switch_settings(old,info,detail,cap)
        # Entry pause is observed by the worker; broker protections are never touched.
        stop(root)
        deadline = time.monotonic()+20
        while worker_locked(folder) and time.monotonic()<deadline:
            time.sleep(.25)
        api.require(not worker_locked(folder),'NAS100_WAIT_PREVIOUS_SL_TP_OR_WORKER')
        engine = connect(mt5,root)
        positions = mt5.positions_get(symbol=old['symbol'])
        orders = mt5.orders_get(symbol=old['symbol'])
        nas_positions = mt5.positions_get(symbol=config['symbol'])
        nas_orders = mt5.orders_get(symbol=config['symbol'])
        api.require(all(v is not None for v in (positions,orders,nas_positions,nas_orders)), 'NAS100_BROKER_STATE_UNAVAILABLE')
        api.require(not positions and not orders and not nas_positions and not nas_orders, 'NAS100_WAIT_FLAT')
        api.require(not any(s['job']['action']=='trade' and s['phase'] in LIVE_PHASES for s in engine.states.values()),
                    'NAS100_PREVIOUS_INTENT_UNRECONCILED')
        api.atomic_json(root/'settings_before_nas100.json',old)
        save_gold_settings(root,config)
        mt5.shutdown()
        try:
            value = start(job,root,api)
            deadline = time.monotonic()+45
            while value.get('symbol') == config['symbol'] and not value.get('ready') and time.monotonic()<deadline:
                time.sleep(.5)
                value = status(root) or value
            api.require(value.get('symbol') == config['symbol'] and value.get('period')=='M5'
                        and value.get('snapshot_fresh') and value.get('ready') and not value.get('paused'), 'NAS100_ACTIVATION_NOT_READY')
        except Exception:
            # Pause the attempted session, restore prior settings and keep broker SL/TP.
            stop(root)
            save_gold_settings(root,old)
            raise
        return {**value, 'code':'NAS100_M5_RETEST_ACTIVATED', 'configuration':config,
                'previous_symbol':old['symbol'], 'contract':detail}
    except ValueError as exc:
        raise api.BridgeError(str(exc)) from None
    finally:
        mt5.shutdown()
