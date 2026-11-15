"""OLFX: local live diagnostics for one supervised portal browser and VPS agent."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
import uuid

VERSION = "2026-11-15.1"
PORTAL_URL = "https://infolonsocietyacademy.github.io/Portal-del-estudiante/?diagnostico=1"
BACKEND_URL = "https://xanhhfashgkyrvphprts.supabase.co/functions/v1/olon-own-connect"
SECRET_KEYS = {"password", "investorpassword", "accesstoken", "refreshtoken", "agenttoken",
               "authorization", "apikey", "token", "secret", "privatekey", "wrappedkey",
               "ciphertext", "cookie", "setcookie", "clientsecret", "privatekeypem", "servicerolekey"}
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")


def safe_url(value):
    """Queries/fragments can contain signed URLs, access tokens and auth codes."""
    try:
        p = urlsplit(str(value))
        host = p.hostname or ""
        if ":" in host:
            host = "[" + host + "]"
        if p.port:
            host += ":" + str(p.port)
        return urlunsplit((p.scheme, host, p.path, "", ""))
    except ValueError:
        return "[URL invalida]"


def redact(value, depth=0):
    if depth > 8:
        return "[limite de profundidad]"
    if isinstance(value, dict):
        return {str(k): "[OCULTO]" if re.sub(r"[^a-z0-9]", "", str(k).lower()) in SECRET_KEYS
                else redact(v, depth + 1) for k, v in list(value.items())[:100]}
    if isinstance(value, (list, tuple)):
        return [redact(v, depth + 1) for v in value[:100]]
    if not isinstance(value, str):
        return value
    # Structured console messages are filtered before being converted back to text.
    if value.lstrip().startswith(("{", "[")):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, (dict, list)):
                return json.dumps(redact(parsed, depth + 1), ensure_ascii=False)
        except (ValueError, TypeError):
            pass
    value = re.sub(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
                   "[CLAVE PRIVADA OCULTA]", value, flags=re.S)
    def stack_url(match):
        raw = match.group()
        position = re.search(r"(:\d+:\d+)([),.;]?)$", raw)
        if position:
            return safe_url(raw[:position.start()]) + position.group()
        return safe_url(raw)
    value = URL_PATTERN.sub(stack_url, value)
    value = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[JWT OCULTO]", value)
    value = re.sub(r"(?i)\bBearer\s+[^\s\"',;]+", "Bearer [OCULTO]", value)
    value = re.sub(r"\bolfx_[A-Za-z0-9_-]{8,}", "[TOKEN OLFX OCULTO]", value)
    value = re.sub(r'''(?ix)(\b(?:password|investorPassword|access[_-]?token|refresh[_-]?token|agent[_-]?token|authorization|api[_-]?key|client[_-]?secret|token|secret)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)''',
                   lambda m: m.group(1) + "[OCULTO]", value)
    return value if len(value) <= 12000 else value[:12000] + " [texto truncado]"


class Reporter:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.session = uuid.uuid4().hex[:12]
        self.sequence = 0
        self.logger = logging.getLogger("olfx.diagnostics." + self.session)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        self.handler = RotatingFileHandler(self.directory / "portal-live.jsonl", maxBytes=5_000_000,
                                           backupCount=4, encoding="utf-8")
        self.logger.addHandler(self.handler)

    def emit(self, level, event, **data):
        self.sequence += 1
        row = {"utc": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
               "local": datetime.now().astimezone().isoformat(timespec="milliseconds"),
               "session": self.session, "seq": self.sequence, "level": level,
               "event": event, **redact(data)}
        self.logger.info(json.dumps(row, ensure_ascii=False, allow_nan=False))
        detail = " ".join(f"{k}={json.dumps(v, ensure_ascii=False)}" for k, v in redact(data).items())
        print(f"{row['local']} [{level}] {event} {detail}", flush=True)

    def close(self):
        self.handler.close()
        self.logger.removeHandler(self.handler)


class SingleInstance:
    def __init__(self, directory):
        self.path = Path(directory) / "monitor.lock"
        self.file = None

    def acquire(self):
        self.file = self.path.open("a+b")
        self.file.seek(0)
        if not self.file.read(1):
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.file.close()
            self.file = None
            return False

    def close(self):
        if self.file:
            self.file.close()
            self.file = None


def account_snapshot(row):
    # This allowlist deliberately excludes names, email, tokens and encrypted credentials.
    fields = ("id", "login_masked", "broker_server", "platform", "status", "is_primary",
              "balance", "equity", "currency", "deposits", "withdrawals", "transfer_in",
              "transfer_out", "balance_adjustments", "net_profit", "today_net", "week_net",
              "month_net", "total_deals", "closed_trades", "fees", "last_sync_at", "last_error",
              "backfill_done")
    return {k: v for k in fields if k in row and (v := row[k]) is not None
            and isinstance(v, (str, int, float, bool))}


def error_payload(value):
    if not isinstance(value, dict):
        return {}
    return {k: v for k in ("code", "message", "error", "error_description", "hint", "details")
            if isinstance(v := value.get(k), (str, int, float, bool))}


def probe(url, method="GET"):
    started = time.monotonic()
    try:
        request = Request(url, method=method, headers={"User-Agent": "OLFX-Diagnostics/" + VERSION,
                                                      "Cache-Control": "no-cache"})
        with urlopen(request, timeout=12) as response:
            status = response.status
        return {"url": safe_url(url), "status": status,
                "ms": round((time.monotonic() - started) * 1000)}
    except HTTPError as exc:
        return {"url": safe_url(url), "status": exc.code, "error": str(exc)}
    except Exception as exc:
        return {"url": safe_url(url), "error": str(exc), "type": type(exc).__name__}


def agent_processes():
    """Return only PIDs. Never collect or log complete process command lines."""
    if sys.platform != "win32":
        return None
    command = r"""$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" | Where-Object { $_.CommandLine -match 'olfx_agent\.py' } | Select-Object -ExpandProperty ProcessId); ConvertTo-Json -Compress -InputObject $p"""
    try:
        completed = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                                   capture_output=True, text=True, timeout=10, check=True)
        value = json.loads(completed.stdout)
        return [int(v) for v in value] if isinstance(value, list) else None
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return None


def agent_start_decision(pids, installed):
    if not installed:
        return False, "No hay agente instalado; el navegador sigue supervisado."
    if pids is None:
        return False, "No se pudo comprobar si hay otro agente; no se inicia una segunda copia."
    if pids:
        return False, "Ya hay un conector activo. Su consola anterior no se puede capturar desde este monitor."
    return True, "Se captura la consola de la version instalada del conector."


class Monitor:
    def __init__(self, reporter):
        self.reporter = reporter
        self.pending = {}
        self.tasks = set()
        self.previous_states = {}
        self.previous_accounts = {}
        self.logout_clicks = {}

    def emit(self, level, event, **data):
        self.reporter.emit(level, event, **data)

    def schedule(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return task

    def request(self, request):
        ref = uuid.uuid4().hex[:10]
        self.pending[id(request)] = (ref, time.monotonic())

    def request_info(self, request, finish=False):
        ref, start = (self.pending.pop(id(request), ("-", time.monotonic())) if finish
                      else self.pending.get(id(request), ("-", time.monotonic())))
        return {"request_id": ref, "method": request.method, "url": safe_url(request.url),
                "resource": request.resource_type, "ms": round((time.monotonic() - start) * 1000)}

    def failed(self, request):
        self.emit("ERROR", "NETWORK_FAILURE", **self.request_info(request, True), error=request.failure)

    def response_event(self, response):
        # Capture identity/timing synchronously, before requestfinished removes it.
        self.schedule(self.response(response, self.request_info(response.request)))

    async def response(self, response, info=None):
        try:
            info = info or self.request_info(response.request)
            self.emit("ERROR" if response.status >= 400 else "INFO", "HTTP", **info, status=response.status)
            if response.status in (204, 205, 304) or response.request.method in ("HEAD", "OPTIONS"):
                return
            # Read only small JSON error objects or allowlisted connector status fields.
            # Request bodies/headers, successful auth responses, cookies and storage are never read.
            connector = safe_url(response.url) == BACKEND_URL
            if response.status < 400 and not connector:
                return
            content_type = await response.header_value("content-type") or ""
            if "json" not in content_type.lower():
                return
            length = await response.header_value("content-length")
            if length and int(length) > 250_000:
                return
            body = await response.body()
            if len(body) > 250_000:
                return
            data = json.loads(body)
            if response.status >= 400:
                if details := error_payload(data):
                    self.emit("ERROR", "API_ERROR", **info, status=response.status, **details)
            elif isinstance(data, dict):
                for row in data.get("accounts", []) if isinstance(data.get("accounts"), list) else []:
                    if not isinstance(row, dict):
                        continue
                    clean = account_snapshot(row)
                    if not clean:
                        continue
                    key = clean.get("id", clean.get("login_masked", "unknown"))
                    if self.previous_accounts.get(key) != clean:
                        self.previous_accounts[key] = clean
                        self.emit("WARN" if clean.get("last_error") else "INFO", "ACCOUNT_STATUS", **clean)
                agents = data.get("agents")
                if isinstance(agents, list):
                    for agent in agents[:10]:
                        if not isinstance(agent, dict):
                            continue
                        clean = {k: agent[k] for k in ("id", "status", "last_seen_at") if k in agent}
                        self.emit("INFO", "VPS_AGENT_STATUS", **clean)
        except Exception as exc:
            self.emit("WARN", "RESPONSE_DIAGNOSTIC", url=safe_url(response.url), error=str(exc))

    def attach_page(self, page):
        page.on("console", lambda message: self.emit("ERROR" if message.type == "error" else "WARN"
                if message.type == "warning" else "INFO", "BROWSER_CONSOLE", kind=message.type,
                text=message.text, location={**message.location, "url": safe_url(message.location.get("url", ""))}))
        page.on("pageerror", lambda error: self.emit("ERROR", "JAVASCRIPT_ERROR", name=error.name,
                                                    message=error.message, stack=error.stack))
        page.on("crash", lambda: self.emit("ERROR", "BROWSER_CRASH", url=safe_url(page.url)))
        page.on("framenavigated", lambda frame: self.emit("INFO", "NAVIGATION", url=safe_url(frame.url))
                if frame == page.main_frame else None)
        page.on("websocket", self.attach_websocket)
        page.on("close", lambda: self.emit("INFO", "BROWSER_TAB_CLOSED"))

    def attach_websocket(self, socket):
        url = safe_url(socket.url)
        self.emit("INFO", "WEBSOCKET_OPEN", url=url)
        socket.on("socketerror", lambda error: self.emit("ERROR", "WEBSOCKET_ERROR", url=url, error=error))
        socket.on("close", lambda: self.emit("INFO", "WEBSOCKET_CLOSED", url=url))
        # Frames may contain private messages or tokens. Do not subscribe to frame events.

    def browser_event(self, source, event):
        if event not in ("LOGOUT_CLICK", "ONLINE", "OFFLINE"):
            return
        if event == "LOGOUT_CLICK":
            self.logout_clicks[id(source["page"])] = time.monotonic()
        self.emit("WARN" if event == "OFFLINE" else "INFO", event)

    async def screen(self, page):
        try:
            # UI state only: no form values, global user object, tokens or browser storage.
            state = await page.evaluate("""() => {
              const visible = id => { const n=document.getElementById(id); return !!(n &&
                !n.hidden && !n.classList.contains('hidden') && n.getClientRects().length); };
              return {portal:visible('portal'),login:visible('auth'),online:navigator.onLine,
                visibility:document.visibilityState,
                page:document.querySelector('#portal .page:not(.hidden)')?.id || '-',
                maintenance:!!document.body?.classList.contains('olonMaintenanceBlocked')};
            }""")
            key = id(page)
            if self.previous_states.get(key) != state:
                old = self.previous_states.get(key, {})
                event = "SESSION_LEFT_PORTAL" if old.get("portal") and state.get("login") else "SCREEN_STATE"
                self.previous_states[key] = state
                if event == "SESSION_LEFT_PORTAL":
                    state = {**state, "logout_clicked_last_10s": time.monotonic() - self.logout_clicks.get(key, -100) < 10}
                self.emit("WARN" if event == "SESSION_LEFT_PORTAL" else "INFO", event, **state)
        except Exception:
            # Navigation destroys execution contexts; the next sample retries naturally.
            pass


async def capture_agent(reporter, agent_path):
    pids = await asyncio.to_thread(agent_processes)
    start, reason = agent_start_decision(pids, agent_path.is_file())
    reporter.emit("INFO" if start else "WARN", "AGENT_CAPTURE", message=reason, existing_pids=pids)
    if not start:
        return
    env = os.environ.copy()
    env.pop("OLFX_AUTOUPDATE_SUPERVISED", None)
    env["PYTHONIOENCODING"] = "utf-8"
    process = None
    try:
        # Run existing code only; do not update it, read settings or touch the private key.
        process = await asyncio.create_subprocess_exec("py", "-3.12", "-u", str(agent_path), "watch",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        reporter.emit("INFO", "AGENT_STARTED", pid=process.pid,
                      code_sha256=hashlib.sha256(agent_path.read_bytes()).hexdigest())
        while line := await process.stdout.readline():
            message = line.decode("utf-8", errors="replace").rstrip()
            level = "ERROR" if re.search(r"\b(error|exception|traceback|fallo)\b", message, re.I) else "INFO"
            reporter.emit(level, "AGENT_OUTPUT", text=message)
        code = await process.wait()
        reporter.emit("ERROR" if code else "INFO", "AGENT_EXIT", exit_code=code)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        reporter.emit("ERROR", "AGENT_MONITOR_ERROR", error=str(exc), type=type(exc).__name__)
    finally:
        if process and process.returncode is None:
            # Only a child started by this monitor is stopped. An existing agent is never touched.
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), 5)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
            reporter.emit("INFO", "AGENT_CHILD_STOPPED", pid=process.pid)


async def health_loop(reporter, portal):
    while True:
        for url, method in ((portal, "GET"), (BACKEND_URL, "OPTIONS")):
            result = await asyncio.to_thread(probe, url, method)
            reporter.emit("ERROR" if result.get("error") or result.get("status", 0) >= 400 else "INFO",
                          "HEALTH", **result)
        await asyncio.sleep(30)


async def agent_watch_loop(reporter):
    previous = object()
    await asyncio.sleep(2)
    while True:
        pids = await asyncio.to_thread(agent_processes)
        if pids != previous:
            reporter.emit("INFO" if pids else "WARN", "AGENT_PROCESSES", pids=pids,
                          message="No se pudo consultar Windows" if pids is None else
                          "Conector activo" if pids else "No hay proceso del conector activo")
            previous = pids
        await asyncio.sleep(15)


async def launch_browser(playwright, args, reporter):
    if args.browser_executable:
        return await playwright.chromium.launch(executable_path=args.browser_executable, headless=args.headless)
    for channel in ("msedge", "chrome", None):
        try:
            return await playwright.chromium.launch(channel=channel, headless=args.headless)
        except Exception as exc:
            reporter.emit("WARN", "BROWSER_CANDIDATE", browser=channel or "chromium", error=str(exc))
            continue
    reporter.emit("INFO", "BROWSER_INSTALL", message="Instalando Chromium solo para el diagnostico.")
    process = await asyncio.create_subprocess_exec(sys.executable, "-m", "playwright", "install", "chromium")
    if await process.wait():
        raise RuntimeError("No se pudo instalar Chromium. Comprueba Internet o instala Microsoft Edge.")
    return await playwright.chromium.launch(headless=args.headless)


async def run(args, reporter):
    from playwright.async_api import async_playwright
    monitor = Monitor(reporter)
    background = []
    if not args.no_agent:
        agent = Path(os.environ.get("LOCALAPPDATA", ".")) / "OLFXConnect" / "olfx_agent.py"
        background.append(asyncio.create_task(capture_agent(reporter, agent)))
        background.append(asyncio.create_task(agent_watch_loop(reporter)))
    if not args.no_health:
        background.append(asyncio.create_task(health_loop(reporter, args.url)))
    try:
        async with async_playwright() as playwright:
            browser = await launch_browser(playwright, args, reporter)
            context = await browser.new_context(viewport={"width": 1380, "height": 900})
            await context.expose_binding("__olfx_diag_event", monitor.browser_event)
            await context.add_init_script("""(() => {
              const emit = event => { window.__olfx_diag_event(event).catch(() => {}); };
              addEventListener('click', e => { if(e.target?.closest('[data-olon-logout]')) emit('LOGOUT_CLICK'); }, {capture:true,passive:true});
              addEventListener('online', () => emit('ONLINE'));
              addEventListener('offline', () => emit('OFFLINE'));
            })();""")
            context.on("page", monitor.attach_page)
            context.on("request", monitor.request)
            context.on("response", monitor.response_event)
            context.on("requestfinished", lambda request: monitor.pending.pop(id(request), None))
            context.on("requestfailed", monitor.failed)
            # No persistent profile, HAR, video, screenshots or storage-state export.
            page = await context.new_page()
            try:
                await page.goto(args.url, wait_until="domcontentloaded", timeout=45000)
            except Exception as exc:
                reporter.emit("ERROR", "PORTAL_OPEN", error=str(exc), url=safe_url(args.url))
            reporter.emit("INFO", "READY", message="Inicia sesion y usa el portal en esta ventana. CTRL+C detiene el monitor.",
                          browser=browser.version, portal=safe_url(args.url))
            started = time.monotonic()
            try:
                while browser.is_connected() and context.pages:
                    for current in list(context.pages):
                        await monitor.screen(current)
                    if args.seconds and time.monotonic() - started >= args.seconds:
                        break
                    await asyncio.sleep(1)
            finally:
                for task in list(monitor.tasks):
                    task.cancel()
                if monitor.tasks:
                    await asyncio.gather(*list(monitor.tasks), return_exceptions=True)
                await browser.close()
    finally:
        for task in background:
            task.cancel()
        await asyncio.gather(*background, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser(description="Diagnostico local OLFX: navegador, red y conector VPS.")
    parser.add_argument("--url", default=PORTAL_URL)
    parser.add_argument("--log-dir", type=Path, default=Path(os.environ.get("LOCALAPPDATA", ".")) / "OLFXConnect" / "diagnostico" / "logs")
    parser.add_argument("--no-agent", action="store_true")
    parser.add_argument("--no-health", action="store_true")
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--browser-executable")
    parser.add_argument("--seconds", type=int, default=0)
    args = parser.parse_args()
    if args.seconds < 0:
        parser.error("--seconds debe ser cero o positivo")
    if (urlsplit(args.url).hostname or "").lower() not in ("infolonsocietyacademy.github.io", "localhost", "127.0.0.1", "::1"):
        parser.error("El monitor solo abre el portal OLON o una prueba local")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    reporter = Reporter(args.log_dir)
    lock = SingleInstance(args.log_dir.parent)
    if not lock.acquire():
        reporter.emit("ERROR", "ALREADY_RUNNING", message="Ya hay otro monitor abierto con esta carpeta.")
        reporter.close()
        return 2
    reporter.emit("INFO", "START", version=VERSION, python=sys.version.split()[0], platform=sys.platform,
                  log=str(reporter.directory / "portal-live.jsonl"))
    code = 0
    try:
        asyncio.run(run(args, reporter))
    except KeyboardInterrupt:
        reporter.emit("INFO", "STOP", message="Detenido por el usuario.")
    except Exception as exc:
        reporter.emit("ERROR", "MONITOR_FATAL", error=str(exc), type=type(exc).__name__)
        code = 1
    finally:
        reporter.emit("INFO", "FINISHED", exit_code=code)
        lock.close()
        reporter.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
