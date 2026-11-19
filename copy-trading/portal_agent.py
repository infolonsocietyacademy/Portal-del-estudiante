"""OLFX Copy: fetch this owner's settings; paper or demo only, fail closed offline."""
from __future__ import annotations
import json
import logging
import os
from pathlib import Path
import sys
import time
import urllib.request

from copy_bot import Blocked, Engine, MT5, Paper, State, exclusive, snapshot, validate_config

LOG = logging.getLogger('olfx.copy.portal')
HOME = Path(os.environ.get('LOCALAPPDATA', str(Path.home())))
DATA = HOME / 'OLFXCopy'
ENDPOINT = 'https://xanhhfashgkyrvphprts.supabase.co/functions/v1/olfx-copy-control'


def request(token, body):
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body, allow_nan=False).encode(),
                                 headers={'Content-Type': 'application/json', 'x-olfx-agent-token': token}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            result = json.load(response)
    except Exception as exc:
        raise Blocked('Portal sin conexión o solicitud rechazada; se detuvo este ciclo') from exc
    if result.get('error'):
        raise Blocked('El portal rechazó la solicitud; actualiza los ajustes')
    return result


def validate_group(group, reader_path):
    if group.get('mode') not in ('paper', 'demo') or type(group.get('paused')) is not bool:
        raise Blocked('Modo de ejecución no permitido')
    if not isinstance(group.get('revision'), int) or group['revision'] < 1:
        raise Blocked('Revisión inválida')
    validate_config(group['settings'])
    # The statistics agent switches logins in its terminal. Never share that terminal.
    reader = os.path.normcase(os.path.abspath(reader_path))
    for account in [group['settings']['master'], *group['settings']['followers']]:
        if os.path.normcase(os.path.abspath(account['terminal_path'])) == reader:
            raise Blocked('Usa terminales exclusivos para Copy Trade, distintos al sincronizador de estadísticas')


class ControlledEngine(Engine):
    def __init__(self, cfg, state, gate):
        super().__init__(cfg, state)
        self.gate = gate

    def send(self, data, broker, action):
        # Recheck authorization before EVERY order, including closes and SL/TP edits.
        self.gate()
        return super().send(data, broker, action)


def cycle(group, api, state, gate):
    cfg = group['settings']
    engine = ControlledEngine(cfg, state, gate)
    statuses = {}
    for f in cfg['followers']:
        if not f['enabled']:
            statuses[f['id']] = 'paused'
            continue
        try:
            gate()
            with MT5(api, cfg, cfg['master']) as master:
                snap = snapshot(master, cfg)
            with MT5(api, cfg, f, demo=group['mode'] == 'demo') as follower:
                broker = follower if group['mode'] == 'demo' else Paper(follower, state.follower(f['id']))
                engine.sync(f, snap, broker)
            # Skipped entries are observable as blocked, rather than a false success.
            data = state.follower(f['id'])
            statuses[f['id']] = 'blocked' if data['pending'] or any(r.get('reason') and r.get('reason') != 'abierta antes de activar esta seguidora' for r in data['records'].values()) else 'ok'
        except Exception as exc:
            LOG.error('%s: %s', f['id'], exc)
            statuses[f['id']] = 'error'
    return statuses


def main():
    if sys.platform != 'win32':
        raise Blocked('Este agente requiere Windows y MT5')
    import MetaTrader5 as api
    settings_file = HOME / 'OLFXConnect' / 'settings.json'
    local = json.loads(settings_file.read_text(encoding='utf-8-sig'))
    token, reader_path = local['agent_token'], local['mt5_path']
    DATA.mkdir(parents=True, exist_ok=True)
    LOG.info('Copy Trade: simulación/demo. No se ejecutan cuentas reales. Ctrl+C para detener.')
    validated = None
    with exclusive(DATA / 'portal-agent.lock'):
        while True:
            group = None
            try:
                group = request(token, {'action': 'agent-config'}).get('group')
                if not group:
                    LOG.info('Esperando que guardes la maestra y receptoras en el portal')
                    time.sleep(5)
                    continue
                validate_group(group, reader_path)
                cfg = group['settings']
                path = DATA / (group['id'] + '.' + group['mode'] + '.state.json')
                state = State(path, cfg, group['mode'])
                if validated != (group['id'], group['revision']):
                    # Verify local terminal/account identities even while paused.
                    with MT5(api, cfg, cfg['master']):
                        pass
                    for f in cfg['followers']:
                        if f['enabled']:
                            with MT5(api, cfg, f, demo=group['mode'] == 'demo'):
                                pass
                    validated = (group['id'], group['revision'])

                def gate():
                    latest = request(token, {'action': 'agent-config'}).get('group')
                    if not latest or latest['id'] != group['id'] or latest['paused'] or latest['revision'] != group['revision']:
                        raise Blocked('Pausa o cambio de ajustes; se detuvo la solicitud')

                statuses = {f['id']: 'paused' for f in cfg['followers']} if group['paused'] else cycle(group, api, state, gate)
                phase = 'paused' if group['paused'] else 'error' if 'error' in statuses.values() else group['mode']
                request(token, {'action': 'agent-heartbeat', 'group_id': group['id'], 'revision': group['revision'], 'state': phase, 'followers': statuses})
            except Exception as exc:
                LOG.error('%s', exc)
                if group:
                    try:
                        request(token, {'action': 'agent-heartbeat', 'group_id': group['id'], 'revision': group['revision'], 'state': 'error', 'followers': {f['id']: 'error' for f in group['settings']['followers']}})
                    except Exception:
                        pass
            time.sleep(2)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    try:
        main()
    except KeyboardInterrupt:
        print('Copy Trade detenido. Las posiciones conservan su SL/TP del bróker.')
    except Exception as exc:
        print('ERROR:', exc)
        sys.exit(1)
