"""OLFX CONNECT — agente privado MT5 para Windows. No usa MetaApi."""
from __future__ import annotations
import argparse
import base64
import getpass
import json
import os
import sys
import time
import shutil
import hashlib
from contextlib import contextmanager
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HOME = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "OLFXConnect"
KEY_FILE = HOME / "private_key.pem"
SETTINGS = HOME / "settings.json"
SERVER_URL = "https://xanhhfashgkyrvphprts.supabase.co/functions/v1/olon-own-connect"
POLL_SECONDS = 15  # Detecta nuevas conexiones rápidamente, sin sincronizar todo cada 15 s.
DAILY_SECONDS = 86400  # Refrescar cuentas ya sincronizadas una vez al día.
ERROR_RETRY_SECONDS = 1800  # Los errores no se reintentan automáticamente sin control.
AGENT_VERSION = "20261119-history-v2"
HISTORY_START = datetime(1970, 1, 1, tzinfo=timezone.utc)
HISTORY_RETRY_DELAYS = (2, 4, 8, 8)
MAX_DEALS_PER_BATCH = 150
AUTOUPDATE_SECONDS = 300  # Comprueba GitHub cada 5 min, sin interrumpir lotes MT5.
AUTOUPDATE_RESTART_CODE = 75
AUTOUPDATE_MAX_BYTES = 250_000
AUTOUPDATE_URL = "https://raw.githubusercontent.com/infolonsocietyacademy/Portal-del-estudiante/main/olfx-connector/olfx_agent.py"

def config():
    if not SETTINGS.exists():
        raise RuntimeError("Ejecuta primero: python olfx_agent.py configure")
    cfg = json.loads(SETTINGS.read_text(encoding="utf-8"))
    if not cfg.get("agent_token") or not cfg.get("mt5_path"):
        raise RuntimeError("Configuración incompleta. Ejecuta configure.")
    return cfg

def api(action: str, data: dict | None = None, token: str = "", timeout: int = 90):
    headers = {"Content-Type": "application/json", "User-Agent": "OLFXConnect/" + AGENT_VERSION}
    if token:
        headers["x-olfx-agent-token"] = token
    with httpx.Client(timeout=timeout) as client:
        response = client.post(SERVER_URL, headers=headers, json={"action": action, **(data or {})})
    try:
        output = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Respuesta no válida del portal (HTTP {response.status_code})") from exc
    if response.status_code >= 400 or output.get("error"):
        raise RuntimeError(f"OLFX: {output.get('error', 'HTTP '+str(response.status_code))}")
    return output

def init():
    HOME.mkdir(parents=True, exist_ok=True)
    if KEY_FILE.exists():
        print("La clave privada ya existe. No se reemplaza para no perder las conexiones anteriores.")
        private = serialization.load_pem_private_key(KEY_FILE.read_bytes(), password=None)
    else:
        from cryptography.hazmat.primitives.asymmetric import rsa
        private = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        # Esta clave NO se sube a GitHub, Supabase ni al portal.
        KEY_FILE.write_bytes(private.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption()))
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    print("\nCOPIA SOLO ESTA CLAVE PUBLICA EN EL PANEL ADMINISTRATIVO OLFX CONNECT:\n")
    print(public_pem)
    print(f"Clave privada guardada localmente en {KEY_FILE}")
    print("Protege el inicio de sesión de Windows: el archivo de clave privada permite descifrar credenciales de inversor.")

def configure():
    if not KEY_FILE.exists():
        raise RuntimeError("Ejecuta primero: python olfx_agent.py init")
    print("Introduce el token que aparece UNA SOLA VEZ en el panel administrativo del portal.")
    token = getpass.getpass("Token OLFX: ").strip()
    if not token.startswith("olfx_") or len(token) < 50:
        raise RuntimeError("Token inválido")
    path = input(r"Ruta terminal64.exe de MetaTrader 5 (ej: C:\Program Files\MetaTrader 5\terminal64.exe): ").strip().strip('"')
    if not Path(path).is_file() or Path(path).name.lower() != "terminal64.exe":
        raise RuntimeError("No se encontró terminal64.exe en esa ruta")
    data = {"agent_token": token, "mt5_path": path}
    SETTINGS.write_text(json.dumps(data, indent=2), encoding="utf-8")
    print("Configuración guardada en el perfil local de Windows.")
    print("IMPORTANTE: no compartas la carpeta OLFXConnect ni el token. Tu usuario Windows debe tener contraseña.")
    print("Ejecuta: python olfx_agent.py once")

def decrypt(payload: dict):
    private = serialization.load_pem_private_key(KEY_FILE.read_bytes(), password=None)
    key = private.decrypt(base64.b64decode(payload["wrappedKey"]),
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()),
        algorithm=hashes.SHA256(), label=None))
    plain = AESGCM(key).decrypt(base64.b64decode(payload["iv"]),
        base64.b64decode(payload["ciphertext"]), None)
    return json.loads(plain.decode("utf-8"))

def deals_payload(deals):
    out=[]
    # MetaTrader deals may include multiple entries per position.
    for d in deals:
        values = d._asdict() if hasattr(d, "_asdict") else dict(d)
        typemap = {
            0: "DEAL_TYPE_BUY", 1: "DEAL_TYPE_SELL", 2:"DEAL_TYPE_BALANCE",
            3:"DEAL_TYPE_CREDIT",4:"DEAL_TYPE_CHARGE",5:"DEAL_TYPE_CORRECTION",
            6:"DEAL_TYPE_BONUS",7:"DEAL_TYPE_COMMISSION",8:"DEAL_TYPE_COMMISSION_DAILY",
            9:"DEAL_TYPE_COMMISSION_MONTHLY",10:"DEAL_TYPE_INTEREST",11:"DEAL_TYPE_BUY_CANCELED",
            12:"DEAL_TYPE_SELL_CANCELED",13:"DEAL_TYPE_DIVIDEND",14:"DEAL_TYPE_DIVIDEND_FRANKED",15:"DEAL_TYPE_TAX"}
        entrymap={0:"DEAL_ENTRY_IN",1:"DEAL_ENTRY_OUT",2:"DEAL_ENTRY_INOUT",3:"DEAL_ENTRY_OUT_BY"}
        dtype=typemap.get(int(values.get("type",-1)))
        if dtype is None or dtype in ("DEAL_TYPE_BUY_CANCELED","DEAL_TYPE_SELL_CANCELED"):
            continue
        entry=entrymap.get(int(values.get("entry",-1)),"")
        stamp=datetime.fromtimestamp(int(values["time"]), timezone.utc).isoformat()
        out.append({
            "deal_id":str(values["ticket"]), "occurred_at":stamp,
            "position_id":str(values.get("position_id") or "") or None,
            "order_id":str(values.get("order") or "") or None,
            "deal_type":dtype, "entry_type":entry,
            "symbol":values.get("symbol") or None,
            "volume":float(values.get("volume",0)),
            "profit":float(values.get("profit",0)),
            "commission":float(values.get("commission",0)),
            "swap":float(values.get("swap",0)),
            "fee":float(values.get("fee",0)),
            "comment":(values.get("comment") or "")[:180]
        })
    return out

@contextmanager
def terminal_session(mt5_path: str):
    """Serialize readers sharing one terminal; never store account credentials."""
    HOME.mkdir(parents=True, exist_ok=True)
    terminal_id = hashlib.sha256(os.path.normcase(os.path.abspath(mt5_path)).encode()).hexdigest()[:24]
    lock = open(HOME / ("terminal-" + terminal_id + ".lock"), "a+b")
    locked = False
    try:
        if lock.seek(0, 2) == 0:
            lock.write(b"0")
            lock.flush()
        deadline = time.monotonic() + 90
        while not locked:
            lock.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Otra lectura está usando este terminal MT5. Reintenta al terminar.")
                time.sleep(1)
        yield
    finally:
        if locked:
            lock.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()


def verified_account(mt5, login: str, server: str):
    account = mt5.account_info()
    if account is None or str(account.login) != login or str(account.server).casefold() != server.casefold():
        raise RuntimeError("MT5 devolvió otra cuenta o un servidor diferente; datos rechazados.")
    return account


def read_complete_history(mt5, login: str, server: str):
    """Wait for two stable full-history reads after switching broker accounts."""
    previous = None
    for attempt in range(len(HISTORY_RETRY_DELAYS) + 1):
        verified_account(mt5, login, server)
        history = mt5.history_deals_get(HISTORY_START, datetime.now(timezone.utc))
        account = verified_account(mt5, login, server)
        if history is not None:
            raw = deals_payload(history)
            signature = frozenset((d["deal_id"], d["occurred_at"], d["profit"], d["commission"], d["swap"], d["fee"]) for d in raw)
            if raw and signature == previous:
                return raw, account
            previous = signature
            # Empty reads are retried through the entire warm-up window. A funded
            # account with no broker deals cannot certify a complete accounting history.
            if attempt == len(HISTORY_RETRY_DELAYS) and not raw and not history:
                if float(account.balance) == 0 and float(account.equity) == 0:
                    return [], account
                raise RuntimeError("MT5 devolvió historial vacío con balance disponible. La importación no se confirmó; abre Todo el historial en el MT5 del VPS y reintenta.")
        else:
            previous = None
        if attempt < len(HISTORY_RETRY_DELAYS):
            time.sleep(HISTORY_RETRY_DELAYS[attempt])
    raise RuntimeError("MT5 no terminó de cargar un historial estable. La importación no se confirmó; reintenta la sincronización.")


def sync_account(mt5, item: dict, cfg: dict):
    with terminal_session(cfg["mt5_path"]):
        _sync_account_locked(mt5, item, cfg)


def _sync_account_locked(mt5, item: dict, cfg: dict):
    info = decrypt(item["encrypted_payload"])
    login = str(info["login"])
    server = str(info["brokerServer"])
    password = str(info["investorPassword"])
    if server.casefold() != item["broker_server"].casefold():
        raise RuntimeError("El servidor descifrado no coincide con la conexión registrada.")
    if not mt5.initialize(cfg["mt5_path"], login=int(login), password=password,
                         server=server, timeout=60000, portable=False):
        mt5.shutdown()
        raise RuntimeError("MT5 no pudo iniciar sesión. Verifica servidor y contraseña de inversor.")
    try:
        # Every explicit refresh reconciles all broker history. An earlier empty
        # import must never narrow the recovery window to seven days.
        raw, account = read_complete_history(mt5, login, server)
        print(f"  Cuenta ****{login[-4:]} · {len(raw)} movimientos disponibles")
        for offset in range(0,max(len(raw),1),MAX_DEALS_PER_BATCH):
            account = verified_account(mt5, login, server)
            batch=raw[offset:offset+MAX_DEALS_PER_BATCH]
            result=api("agent-push",{
                "accountId":item["id"], "login":login,"server":server,
                "balance":float(account.balance),"equity":float(account.equity),
                "currency":str(account.currency or "USD").upper()[:3],
                "deals":batch, "finished":offset+MAX_DEALS_PER_BATCH>=len(raw)
            },cfg["agent_token"])
            print("  Lote sincronizado:",result.get("synced",0),"operaciones; almacenadas:",result.get("stored",0))
    finally:
        mt5.shutdown()

def _due_for_sync(item: dict, automatic: bool = False) -> bool:
    """Solo procesa solicitudes explicitas del estudiante, no por calendario."""
    return item.get("platform") == "mt5" and item.get("status") == "waiting"


def one(automatic: bool = False) -> int:
    if not KEY_FILE.exists():
        raise RuntimeError("Ejecuta python olfx_agent.py init primero")
    cfg = config()
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise RuntimeError("Instala MetaTrader5 para Python 3.12 x64") from exc
    response = api("agent-queue", token=cfg["agent_token"])
    accounts = response.get("accounts", [])
    pending = [account for account in accounts if _due_for_sync(account, automatic=automatic)]
    if not automatic or pending:
        print(f"OLFX CONNECT - {len(accounts)} cuenta(s) en el servidor, "
              f"{len(pending)} lista(s) para sincronizar.", flush=True)
    for account in pending:
        attempt_started_at = datetime.now(timezone.utc).isoformat()
        try:
            sync_account(mt5, account, cfg)
        except Exception as exc:
            print("  ERROR en cuenta", str(account.get("id", ""))[:8],
                  str(exc)[:180], flush=True)
            try:
                api("agent-error", {"accountId":account["id"],
                                    "message":str(exc)[:160],
                                    "attemptStartedAt":attempt_started_at}, cfg["agent_token"])
            except Exception as report:
                print("  No se pudo informar el error:", report, flush=True)
    return len(pending)



def check_auto_update() -> bool:
    """Actualiza solo este agente desde main. Nunca modifica claves, token ni ajustes."""
    # Solo el lanzador supervisado puede reiniciar el proceso tras una actualizacion.
    if os.environ.get("OLFX_AUTOUPDATE_SUPERVISED") != "1" or os.environ.get("OLFX_DISABLE_AUTOUPDATE") == "1":
        return False
    agent_file = Path(__file__).resolve()
    if agent_file.name != "olfx_agent.py":
        raise RuntimeError("El archivo del agente tiene un nombre inesperado")
    request = urllib.request.Request(
        AUTOUPDATE_URL,
        headers={"User-Agent": "OLFXConnect-Windows-Agent/1", "Cache-Control": "no-cache"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise RuntimeError("GitHub devolvio HTTP " + str(response.status))
        remote = response.read(AUTOUPDATE_MAX_BYTES + 1)
    if not (4_000 <= len(remote) <= AUTOUPDATE_MAX_BYTES):
        raise RuntimeError("Descarga rechazada: tamano del agente no valido")
    existing = agent_file.read_bytes()
    if remote == existing:
        return False
    source = remote.decode("utf-8")
    compile(source, str(agent_file), "exec")  # Nunca instala un archivo con errores de sintaxis.
    required = (
        "OLFX CONNECT", "def sync_account(", "def one(", "def main():",
        "olon-own-connect", 'private_key.pem', 'settings.json',
    )
    if not all(marker in source for marker in required):
        raise RuntimeError("Descarga rechazada: faltan componentes obligatorios de OLFX")
    backup = agent_file.with_name("olfx_agent.py.previous")
    temporary = agent_file.with_name("olfx_agent.py." + str(os.getpid()) + ".download")
    try:
        temporary.write_bytes(remote)
        shutil.copy2(agent_file, backup)  # Respaldo del codigo, NO de las credenciales.
        os.replace(temporary, agent_file)  # Cambio atomico, sin tocar la configuracion.
    finally:
        if temporary.exists():
            temporary.unlink()
    print("OLFX AUTOUPDATE: nueva version verificada y guardada; reiniciando lector...", flush=True)
    return True

def doctor():
    """Diagnóstico local de MT5; no usa credenciales del portal ni ejecuta operaciones."""
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise RuntimeError("Falta MetaTrader5. Instala Python 3.12 (64 bits) y requirements.txt.") from exc
    connected = False
    try:
        connected = bool(mt5.initialize())
        if not connected:
            raise RuntimeError("No se pudo conectar a MT5 abierto. Revisa instalación y cuenta. "
                               + str(mt5.last_error()))
        account = mt5.account_info()
        if account is None:
            raise RuntimeError("MT5 está abierto, pero no tiene una cuenta conectada.")
        now = datetime.now(timezone.utc)
        history = mt5.history_deals_get(now - timedelta(days=7), now)
        if history is None:
            raise RuntimeError("MT5 no pudo leer el historial: " + str(mt5.last_error()))
        login = str(account.login)
        print("=== OLFX CONNECT · PRUEBA LOCAL SIN VPS ===")
        print("Cuenta: ****" + login[-4:])
        print("Servidor: " + str(account.server))
        print("Balance y equity: disponibles")
        print("Movimientos de los últimos 7 días:", len(history))
        print("Resultado: lectura MT5 OK. No se han enviado datos a Supabase.")
        print("No se ejecutan operaciones ni se guarda la contraseña.")
    finally:
        if connected:
            mt5.shutdown()

def main():
    parser=argparse.ArgumentParser(description="OLFX CONNECT - conector privado MT5, sin MetaApi")
    parser.add_argument("command",choices=("init","configure","once","run","watch","doctor"))
    args=parser.parse_args()
    if args.command=="doctor":doctor()
    elif args.command=="init":init()
    elif args.command=="configure":configure()
    elif args.command=="once":
        one(automatic=False)
    else:
        print("OLFX CONNECT - Sincronizacion automatica activa.", flush=True)
        print("Revisa cada 15 segundos las solicitudes de los estudiantes.", flush=True)
        print("No refresca automaticamente por tiempo; solo cuando pulsan Actualizar.", flush=True)
        print("No cierres esta ventana. CTRL+C para detener.", flush=True)
        print("Autoactualizacion: " + ("GitHub main cada 5 minutos" if os.environ.get("OLFX_AUTOUPDATE_SUPERVISED") == "1" else "usa OLFX_VPS_AUTOACTUALIZABLE.cmd para activarla"), flush=True)
        next_update_check = 0.0
        while True:
            try:
                one(automatic=True)
            except Exception as exc:
                print("Error de comunicacion; reintentando:", str(exc)[:180], flush=True)
                time.sleep(60)
            # Comprobar actualizaciones DESPUES de sincronizar las cuentas pendientes.
            if time.monotonic() >= next_update_check:
                next_update_check = time.monotonic() + AUTOUPDATE_SECONDS
                try:
                    if check_auto_update():
                        # El lanzador OLFX_VPS_AUTOMATICO.cmd reinicia en la misma ventana.
                        sys.exit(AUTOUPDATE_RESTART_CODE)
                except Exception as exc:
                    print("OLFX AUTOUPDATE: comprobacion fallida; el agente actual sigue funcionando:",
                          str(exc)[:180], flush=True)
            time.sleep(POLL_SECONDS)

if __name__=="__main__":
    try: main()
    except KeyboardInterrupt: print("\nOLFX detenido.")
    except Exception as err:
        print("ERROR:",err)
        sys.exit(1)
