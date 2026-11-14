"""OLFX CONNECT — agente privado MT5 para Windows. No usa MetaApi."""
from __future__ import annotations
import argparse
import base64
import getpass
import json
import hashlib
import os
import sys
import time
import shutil
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
    headers = {"Content-Type": "application/json"}
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

def _stamp(values):
    milliseconds = int(values.get("time_msc") or int(values["time"]) * 1000)
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc)


def _axi_offset(moment):
    """Axi's recorded server clock follows New York DST plus seven hours."""
    year = moment.year
    march = datetime(year, 3, 1, 7, tzinfo=timezone.utc)
    start = march + timedelta(days=(6 - march.weekday()) % 7 + 7)
    november = datetime(year, 11, 1, 6, tzinfo=timezone.utc)
    end = november + timedelta(days=(6 - november.weekday()) % 7)
    return timedelta(hours=3 if start <= moment < end else 2)


def source_clock(deals, references, server, previous_mode=None):
    """Calibrate against saved MT5 UTC/server pairs instead of the PC timezone."""
    by_ticket = {str(d["ticket"]): d for d in deals}
    modes = set()
    axi_rule = bool(references) and str(server).casefold().startswith("axi-")
    for reference in references:
        original = by_ticket.get(str(reference.get("deal_id")))
        utc = datetime.fromisoformat(str(reference["occurred_at"]).replace("Z", "+00:00"))
        wall = datetime.fromisoformat(str(reference["broker_time"])).replace(tzinfo=timezone.utc)
        axi_rule = axi_rule and abs((wall - utc - _axi_offset(utc)).total_seconds()) < 1
        if original is None:
            continue
        raw = _stamp(original)
        if abs((raw - wall).total_seconds()) < 1:
            modes.add("server")
        elif abs((raw - utc).total_seconds()) < 1:
            modes.add("utc")
        else:
            raise RuntimeError("La hora del historial MT5 no coincide con sus referencias verificadas.")
    if len(modes) > 1:
        raise RuntimeError("El historial MT5 mezcla bases horarias diferentes; no se publica.")
    mode = next(iter(modes), previous_mode if previous_mode in ("server", "utc") else "server")
    if mode == "utc" and not axi_rule:
        raise RuntimeError("No se pudo verificar el reloj del servidor MT5.")
    return mode, axi_rule


def deals_payload(deals, references=(), server="", clock_mode=None):
    values_list = [d._asdict() if hasattr(d, "_asdict") else dict(d) for d in deals]
    mode, axi_rule = source_clock(values_list, references, server, clock_mode)
    out=[]
    # MetaTrader deals may include multiple entries per position.
    for values in values_list:
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
        raw = _stamp(values)
        if mode == "utc":
            occurred = raw
            wall = raw + _axi_offset(raw)
        else:
            wall = raw
            occurred = wall - _axi_offset(wall) if axi_rule else raw
        out.append({
            "deal_id":str(values["ticket"]), "occurred_at":occurred.isoformat(),
            "broker_time":wall.replace(tzinfo=None).isoformat(timespec="milliseconds"),
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
    unique = {}
    for deal in out:
        ticket = deal["deal_id"]
        if ticket in unique and unique[ticket] != deal:
            raise RuntimeError("MT5 devolvió dos valores distintos para el mismo ticket.")
        unique[ticket] = deal
    return sorted(unique.values(), key=lambda d:(d["broker_time"], int(d["deal_id"])))

def sync_account(mt5, item: dict, cfg: dict):
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
        terminal = mt5.terminal_info()
        if terminal is None or not terminal.connected:
            raise RuntimeError("MT5 no está conectado al bróker; no se publica un balance en caché.")
        account = mt5.account_info()
        if account is None or str(account.login) != login or str(account.server).casefold()!=server.casefold():
            raise RuntimeError("MT5 devolvió otra cuenta o un servidor diferente; datos rechazados.")
        now = datetime.now(timezone.utc)
        # First v2 reconciliation reads the source's complete available history.
        # Later requests overlap the last successful checkpoint, even after outages.
        full_history = int(item.get("source_version") or 1) < 2
        checkpoint = item.get("last_success_at") or item.get("last_sync_at")
        since = datetime(1970, 1, 1, tzinfo=timezone.utc)
        if not full_history and checkpoint:
            since = datetime.fromisoformat(str(checkpoint).replace("Z", "+00:00")) - timedelta(days=7)
        # Some terminals expose their server clock as epoch seconds. Include the
        # entire current server day instead of silently excluding the last hours.
        history = mt5.history_deals_get(since, now + timedelta(days=1))
        if history is None:
            raise RuntimeError("MT5 no pudo consultar el historial de operaciones.")
        history_values=[d._asdict() if hasattr(d,"_asdict") else dict(d) for d in history]
        clock_mode,_=source_clock(history_values,item.get("clock_references") or (),server,item.get("source_clock_mode"))
        raw=deals_payload(history_values,item.get("clock_references") or (),server,clock_mode)
        revision=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
        print(f"  Cuenta ****{login[-4:]} · {len(raw)} movimientos disponibles")
        for offset in range(0,max(len(raw),1),MAX_DEALS_PER_BATCH):
            batch=raw[offset:offset+MAX_DEALS_PER_BATCH]
            result=api("agent-push",{
                "accountId":item["id"], "login":login,"server":server,
                "balance":float(account.balance),"equity":float(account.equity),
                "currency":str(account.currency or "USD").upper()[:3],
                "deals":batch, "finished":offset+MAX_DEALS_PER_BATCH>=len(raw),
                "sourceVersion":2,"expectedTotal":len(raw) if full_history else None,
                "clockMode":clock_mode,"historyRevision":revision
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
