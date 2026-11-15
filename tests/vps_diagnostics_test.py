import asyncio
import base64
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


monitor = module("portal_monitor", ROOT / "diagnostico-vps/portal_monitor.py")
builder = module("build_diagnostics", ROOT / "scripts/build-vps-diagnostics.py")


class Events:
    def __init__(self):
        self.rows = []

    def emit(self, level, event, **data):
        self.rows.append({"level": level, "event": event, **monitor.redact(data)})


class Request:
    url = "https://example.test/path?token=SECRET#access_token=SECRET"
    method = "POST"
    resource_type = "fetch"
    failure = "net::ERR_CONNECTION_RESET"


class Response:
    def __init__(self, url, data, status=200, length=None):
        self.url, self.data, self.status = url, data, status
        self.request = Request()
        self.length = length
        self.reads = 0

    async def header_value(self, name):
        return "application/json" if name == "content-type" else self.length

    async def body(self):
        self.reads += 1
        return json.dumps(self.data).encode()


class SafetyTests(unittest.TestCase):
    def test_urls_drop_tokens_userinfo_queries_and_fragments(self):
        self.assertEqual(monitor.safe_url("https://user:password@example.test:443/api?apikey=secret#token=secret"),
                         "https://example.test:443/api")
        self.assertEqual(monitor.safe_url("http://[::1]:9000/path?secret=1"), "http://[::1]:9000/path")

    def test_nested_console_secrets_are_hidden_without_losing_error_details(self):
        value = json.dumps({"message": "operation failed at script.js:42", "nested": {
            "access_token": "ABC_SECRET", "refreshToken": "REFRESH_SECRET", "password": "PASS_SECRET",
            "investorPassword": "INVESTOR_SECRET", "encrypted": {"wrappedKey": "KEY_SECRET"}}})
        redacted = monitor.redact(value)
        self.assertIn("script.js:42", redacted)
        self.assertNotIn("_SECRET", redacted)

    def test_raw_secrets_and_signed_links_are_hidden_in_stacks(self):
        value = ("Authorization: Bearer BEARER_SECRET password='PASSWORD_SECRET with spaces'\n"
                 "at https://example.test/script.js?token=URL_SECRET#access_token=FRAGMENT_SECRET:4\n"
                 "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature123 olfx_OLFX_SECRET123456\n"
                 "-----BEGIN PRIVATE KEY-----\nPEM_SECRET\n-----END PRIVATE KEY-----")
        self.assertNotIn("SECRET", monitor.redact(value + ' token=TOKEN_SECRET client_secret=CLIENT_SECRET'))
        self.assertIn('script.js:42:3', monitor.redact('at https://example.test/script.js?v=1&token=SECRET:42:3'))

    def test_account_allowlist_preserves_exact_amounts_and_ignores_credentials(self):
        data = {"id": "account-id", "login_masked": "****1234", "balance": 123.45, "equity": 121.25,
                "status": "active", "encrypted_payload": {"ciphertext": "SECRET"},
                "agentToken": "SECRET", "email": "private@example.test", "full_name": "Private"}
        clean = monitor.account_snapshot(data)
        self.assertEqual(clean["balance"], 123.45)
        self.assertEqual(clean["equity"], 121.25)
        self.assertEqual(set(clean), {"id", "login_masked", "balance", "equity", "status"})

    def test_jsonl_has_timestamps_sequence_and_redacted_text(self):
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            reporter = monitor.Reporter(temp)
            reporter.emit("ERROR", "EXAMPLE", message="password=SECRET", status=503)
            reporter.emit("INFO", "NEXT", count=2)
            reporter.close()
            lines = (Path(temp) / "portal-live.jsonl").read_text().splitlines()
            first, second = map(json.loads, lines)
            self.assertNotIn("SECRET", "\n".join(lines))
            self.assertTrue(first["utc"].endswith("+00:00"))
            self.assertEqual((first["seq"], second["seq"]), (1, 2))
            self.assertEqual(first["session"], second["session"])
            self.assertEqual(first["status"], 503)

    def test_one_monitor_per_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            first, second = monitor.SingleInstance(temp), monitor.SingleInstance(temp)
            try:
                self.assertTrue(first.acquire())
                self.assertFalse(second.acquire())
                first.close()
                self.assertTrue(second.acquire())
            finally:
                first.close()
                second.close()

    def test_existing_or_unknown_agent_processes_never_start_a_duplicate(self):
        self.assertFalse(monitor.agent_start_decision([42], True)[0])
        self.assertFalse(monitor.agent_start_decision(None, True)[0])
        self.assertFalse(monitor.agent_start_decision([], False)[0])
        self.assertTrue(monitor.agent_start_decision([], True)[0])

    def test_probe_only_sends_read_only_http_without_auth(self):
        response = mock.MagicMock()
        response.__enter__.return_value.status = 204
        with mock.patch.object(monitor, "urlopen", return_value=response) as open_url:
            result = monitor.probe(monitor.BACKEND_URL, "OPTIONS")
        request = open_url.call_args.args[0]
        self.assertEqual(request.get_method(), "OPTIONS")
        self.assertIsNone(request.data)
        self.assertNotIn("Authorization", request.headers)
        self.assertEqual(result["status"], 204)
        response.read.assert_not_called()

    def test_cmd_is_a_complete_integrity_checked_bundle(self):
        source = (ROOT / "diagnostico-vps/portal_monitor.py").read_bytes()
        actual = (ROOT / "OLFX_DIAGNOSTICO_VPS.cmd").read_bytes()
        self.assertEqual(actual, builder.build(source))
        lines = actual.splitlines()
        marker = lines.index(builder.MARKER.encode())
        decoded = base64.b64decode(b"".join(lines[marker + 1:]), validate=True)
        self.assertEqual(decoded, source)
        self.assertIn(hashlib.sha256(decoded).hexdigest().encode(), actual)
        self.assertLess(max(map(len, lines)), 8191)
        self.assertIn(b"exit /b", b"\n".join(lines[:marker]))
        compile(decoded, "embedded_monitor.py", "exec")


class EventTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.events = Events()
        self.monitor = monitor.Monitor(self.events)

    async def test_auth_success_does_not_read_body_or_tokens(self):
        response = Response("https://example.test/auth/v1/token", {"access_token": "SECRET"})
        await self.monitor.response(response)
        self.assertEqual(response.reads, 0)
        self.assertNotIn("SECRET", json.dumps(self.events.rows))

    async def test_api_error_retains_code_status_request_and_safe_details(self):
        response = Response("https://example.test/rest/v1/rpc/test", {
            "code": "42501", "message": "Access denied", "details": "password=SECRET", "data": "SECRET"}, 403)
        self.monitor.request(response.request)
        await self.monitor.response(response)
        error = next(r for r in self.events.rows if r["event"] == "API_ERROR")
        self.assertEqual((error["status"], error["code"], error["message"]), (403, "42501", "Access denied"))
        self.assertNotEqual(error["request_id"], "-")
        self.assertNotIn("SECRET", json.dumps(self.events.rows))

    async def test_account_changes_are_logged_once_and_credentials_never_exported(self):
        response = Response(monitor.BACKEND_URL, {"accounts": [{"id": "account", "balance": 10.25,
            "status": "active", "encrypted_payload": {"ciphertext": "SECRET"}, "agent_token": "SECRET"}],
            "agentToken": "SECRET"})
        await self.monitor.response(response)
        await self.monitor.response(response)
        snapshots = [r for r in self.events.rows if r["event"] == "ACCOUNT_STATUS"]
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(snapshots[0]["balance"], 10.25)
        self.assertNotIn("SECRET", json.dumps(self.events.rows))

    async def test_error_bodies_over_limit_are_not_read(self):
        response = Response("https://example.test/api", {"data": "SECRET"}, 500, "250001")
        await self.monitor.response(response)
        self.assertEqual(response.reads, 0)
        self.assertEqual(self.events.rows[0]["status"], 500)

    async def test_empty_connector_preflight_is_not_reported_as_a_json_error(self):
        response = Response(monitor.BACKEND_URL, None, 204)
        await self.monitor.response(response)
        self.assertEqual(response.reads, 0)
        self.assertEqual([r["event"] for r in self.events.rows], ["HTTP"])

    async def test_network_failure_records_method_identity_and_safe_route(self):
        request = Request()
        self.monitor.request(request)
        self.monitor.failed(request)
        row = self.events.rows[0]
        self.assertEqual(row["event"], "NETWORK_FAILURE")
        self.assertEqual(row["method"], "POST")
        self.assertEqual(row["url"], "https://example.test/path")
        self.assertEqual(row["error"], "net::ERR_CONNECTION_RESET")
        self.assertEqual(len(self.monitor.pending), 0)

    async def test_websocket_messages_are_never_observed(self):
        socket = mock.Mock(url="https://example.test/realtime?apikey=SECRET")
        self.monitor.attach_websocket(socket)
        self.assertEqual([c.args[0] for c in socket.on.call_args_list], ["socketerror", "close"])
        self.assertNotIn("SECRET", json.dumps(self.events.rows))

    async def test_session_exit_distinguishes_a_recent_logout_click(self):
        page = mock.Mock()
        page.evaluate = mock.AsyncMock(side_effect=[
            {"portal": True, "login": False}, {"portal": False, "login": True}])
        await self.monitor.screen(page)
        self.monitor.browser_event({"page": page}, "LOGOUT_CLICK")
        await self.monitor.screen(page)
        row = self.events.rows[-1]
        self.assertEqual(row["event"], "SESSION_LEFT_PORTAL")
        self.assertTrue(row["logout_clicked_last_10s"])
        code = page.evaluate.call_args.args[0]
        self.assertNotRegex(code, r"localStorage|sessionStorage|currentUser|\.value\b|cookie")

    async def test_oversized_or_unknown_page_events_cannot_log_arbitrary_data(self):
        self.monitor.browser_event({"page": None}, "password=SECRET")
        self.assertFalse(self.events.rows)


if __name__ == "__main__":
    unittest.main()
