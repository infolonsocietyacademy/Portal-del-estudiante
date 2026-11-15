"""Run real-browser diagnostics with synthetic local failures; Windows tests the CMD itself."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
SECRET = "VPS_TEST_SECRET_NEVER_LOG"


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path.startswith('/failure'):
            data = json.dumps({'code': 'VPS_TEST_500', 'message': 'Synthetic server failure',
                               'password': SECRET}).encode()
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
        elif self.path.startswith('/disconnect'):
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        elif self.path.startswith('/fixture.js'):
            data = ("console.warn('VPS_TEST_WARNING');"
                    "console.log(JSON.stringify({access_token:'" + SECRET + "'}));"
                    "fetch('/failure?token=" + SECRET + "');"
                    "fetch('/disconnect').catch(()=>{});"
                    "setTimeout(()=>{throw new Error('VPS_TEST_JS_ERROR password=" + SECRET + "');},300);").encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
        else:
            data = ("<!doctype html><body><div id='auth'>Login</div><div id='portal' class='hidden'>Portal</div>"
                    "<script src='/fixture.js?token=" + SECRET + "'></script></body>").encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser-executable')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='olfx-diagnostics-') as temp:
            directory = Path(temp)
            env = os.environ.copy()
            env['OLFX_DIAG_UNATTENDED'] = '1'
            # Exercise spaces and an apostrophe in the Windows extraction/install path.
            env['OLFX_DIAG_ROOT'] = str(directory / "VPS user's diagnostic folder")
            logdir = directory / 'logs'
            common = ['--no-agent', '--no-health', '--headless', '--seconds', '4',
                      '--url', f'http://127.0.0.1:{server.server_port}/', '--log-dir', str(logdir)]
            if args.browser_executable:
                common += ['--browser-executable', args.browser_executable]
            command = ([os.environ.get('COMSPEC', 'cmd.exe'), '/d', '/c', str(ROOT / 'OLFX_DIAGNOSTICO_VPS.cmd')]
                       if sys.platform == 'win32' else [sys.executable, str(ROOT / 'diagnostico-vps/portal_monitor.py')])
            result = subprocess.run(command + common, env=env, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    encoding='utf-8', errors='replace', timeout=300)
            if result.returncode:
                print(result.stdout)
                raise SystemExit(result.returncode)
            raw = (logdir / 'portal-live.jsonl').read_text(encoding='utf-8')
            rows = [json.loads(line) for line in raw.splitlines()]
            events = {row['event'] for row in rows}
            assert {'JAVASCRIPT_ERROR', 'API_ERROR', 'NETWORK_FAILURE', 'SCREEN_STATE', 'FINISHED'} <= events, events
            error = next(row for row in rows if row['event'] == 'API_ERROR')
            assert (error['status'], error['code']) == (500, 'VPS_TEST_500'), error
            assert error['request_id'] != '-', error
            js = next(row for row in rows if row['event'] == 'JAVASCRIPT_ERROR')
            assert 'VPS_TEST_JS_ERROR' in js['message'], js
            assert 'fixture.js:' in js['stack'], js
            assert SECRET not in raw, 'A test credential leaked into the log'
            assert SECRET not in result.stdout, 'A test credential leaked into the console'
            assert rows[-1]['exit_code'] == 0, rows[-1]
            print('Real browser QA passed: JavaScript stack, HTTP 500/code, failed connection, UI state, secret redaction, clean exit.')
            if sys.platform == 'win32':
                print('Windows CMD extracted, installed dependencies and ran successfully with a quoted user path.')
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
