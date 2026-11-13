"""OLFX CONNECT — agente privado MT5 para Windows. No usa MetaApi."""
from __future__ import annotations
import argparse
import base64
import getpass
import json
import os
import sys
import time
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
INTERVAL_SECONDS = 3600
MAX_DEALS_PER_BATCH = 150

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
        account = mt5.account_info()
        if account is None or str(account.login) != login or str(account.server).casefold()!=server.casefold():
            raise RuntimeError("MT5 devolvió otra cuenta o un servidor diferente; datos rechazados.")
        now = datetime.now(timezone.utc)
        # Primer piloto: importar 365 días. Después, recuperar 7 días por seguridad
        # para no omitir operaciones si se apaga la computadora.
        since = now-timedelta(days=7 if item.get("last_sync_at") else 365)
        history = mt5.history_deals_get(since, now)
        if history is None:
            raise RuntimeError("MT5 no pudo consultar el historial de operaciones.")
        raw=deals_payload(history)
        print(f"  Cuenta ****{login[-4:]} · {len(raw)} movimientos disponibles")
        for offset in range(0,max(len(raw),1),MAX_DEALS_PER_BATCH):
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

def one():
    if not KEY_FILE.exists():
        raise RuntimeError("Ejecuta python olfx_agent.py init primero")
    cfg=config()
    try:
        import MetaTrader5 as mt5
    except ImportError as exc:
        raise RuntimeError("Instala la librería oficial: py -m pip install MetaTrader5") from exc
    response=api("agent-queue",token=cfg["agent_token"])
    accounts=response.get("accounts",[])
    print(f"OLFX CONNECT - {len(accounts)} cuenta(s) pendientes o activas.")
    for account in accounts:
        if account.get("platform")!="mt5":
            print("  Saltando plataforma no compatible")
            continue
        try:
            sync_account(mt5,account,cfg)
        except Exception as exc:
            print("  ERROR cuenta",str(account["id"])[:8],str(exc)[:180])
            try:
                api("agent-error",{"accountId":account["id"],"message":str(exc)[:160]},cfg["agent_token"])
            except Exception as report:
                print("  No se pudo informar el error:",report)


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
    parser.add_argument("command",choices=("init","configure","once","run","doctor"))
    args=parser.parse_args()
    if args.command=="doctor":doctor()
    elif args.command=="init":init()
    elif args.command=="configure":configure()
    elif args.command=="once":one()
    else:
        print("OLFX CONNECT - sincronización por turnos; CTRL+C para detener.")
        while True:
            try:one()
            except Exception as exc:print("Error general:",exc)
            time.sleep(INTERVAL_SECONDS)

if __name__=="__main__":
    try: main()
    except KeyboardInterrupt: print("\nOLFX detenido.")
    except Exception as err:
        print("ERROR:",err)
        sys.exit(1)
