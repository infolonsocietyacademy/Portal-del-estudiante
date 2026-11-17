"""Interactive CMD menu for the installed resident DEMO receiver."""
from datetime import datetime
import importlib
import json
import os
from pathlib import Path
import sys
import time
from panel_client import Mailbox, PanelError, iso, load_states, make_close, make_trade, need, valid_id
from menu_scope import selected_states, request_in_mode, mode_actions, allowed_direction

MODE="manual"

ROOT=Path(os.environ.get("LOCALAPPDATA",str(Path.home()))) / "OLFX_MT5_BRIDGE"
DATA=ROOT / "resident-v2"
LABELS={"waiting":"ESPERANDO","submitted":"ENVIADA","open":"ABIERTA","closing":"CERRANDO","uncertain":"POR VERIFICAR","done":"TERMINADA","failed":"RECHAZADA"}
CODES={"WAIT_FRESH_QUOTE":"Sin cotizacion reciente","WAIT_SPREAD":"Esperando spread permitido",
       "WAIT_NEW_CANDLE":"Esperando cierre de vela","WAIT_STRUCTURE":"Esperando ruptura de estructura",
       "NO_SIGNAL_EXPIRED":"Vencio sin entrada","POSITION_OPEN":"Posicion abierta","POSITION_CLOSED":"Cierre confirmado",
       "PYTHON_TRADING_DISABLED":"Trading Python deshabilitado","MT5_DISCONNECTED":"MT5 desconectado",
       "CLOSE_STATUS_UNCERTAIN":"Cierre pendiente de verificar","OPEN_STATUS_UNCERTAIN":"Apertura pendiente de verificar"}

def runtime_path():
    managed=os.environ.get("OLFX_RUNTIME_DIR")
    if managed:
        target=Path(managed).resolve()
        expected=ROOT/"managed"/"versions"
        need(target.parent==expected.resolve() and not target.is_symlink(),"Ruta de runtime no valida.")
        return target
    candidates=[]
    for path in (DATA / "app").glob("*/resident_worker.py"):
        folder=path.parent
        if (folder/"resident_core.py").is_file() and (folder/"legacy"/"bridge_agent.py").is_file():
            candidates.append(folder)
    need(bool(candidates),"Primero instala OLFX Bridge Residente.")
    # Current installed launcher determines the runtime; no guessed inactive/staged version.
    launcher=DATA/"INICIAR_RESIDENTE.cmd"
    if launcher.is_file():
        text=launcher.read_text(encoding="utf-8-sig")
        selected=[p for p in candidates if ("\\"+p.name+"\\resident_worker.py") in text or ("/"+p.name+"/resident_worker.py") in text]
        if len(selected)==1:
            return selected[0]
    need(len(candidates)==1,"No se puede identificar la version activa del receptor.")
    return candidates[0]

def connect_mailbox():
    app=runtime_path()
    sys.path.insert(0,str(app))
    sys.path.insert(0,str(app/"legacy"))
    core=importlib.import_module("resident_core")
    bridge=importlib.import_module("bridge_agent")
    settings=importlib.import_module("gold_settings")
    config=settings.load_gold_settings(ROOT)
    need(core.VERSION in {"2.0.1-rc1","2.1.0"},"Instala AGREGAR_PANEL.cmd para habilitar el modo manual independiente.")
    need((DATA/"account-pin.json").is_file(),"Ejecuta DIAGNOSTICAR_RESIDENTE.cmd antes de usar el panel.")
    github=bridge.GitHub(bridge.dpapi((ROOT/"token.dpapi").read_bytes(),False).decode())
    mailbox=Mailbox(github,bridge.BRANCH,bridge.DEVICE+"-resident",DATA/"panel"/"requests",core.validate,config["symbol"])
    return mailbox,config

def clear():
    os.system("cls" if os.name=="nt" else "clear")

def pause():
    input("\nEnter para volver al menu...")

def integer(prompt,default,low,high):
    while True:
        text=input(prompt+" ["+str(default)+"]: ").strip()
        try:
            value=int(text) if text else default
            if low<=value<=high:
                return value
        except ValueError:
            pass
        print("Usa un numero entero entre",low,"y",high)

def number(prompt,default,low,high):
    import math
    while True:
        text=input(prompt+" ["+str(default)+"]: ").strip().replace(",",".")
        try:
            value=float(text) if text else float(default)
            if math.isfinite(value) and low<=value<=high:
                return value
        except ValueError:
            pass
        print("Usa un numero entre",low,"y",high)

def settings_summary(config):
    return ("Lote fijo "+str(config["fixed_lots"]) if config["size_mode"]=="fixed" else "Riesgo "+str(config["risk_percent"])+"%")

def show_states():
    states=selected_states(load_states(DATA/"state"),MODE)
    if not states:
        print("\nTodavia no hay solicitudes de operaciones.")
        return states
    print("\nID | ACTIVO | DIRECCION | ESTADO | LOTE | P/L")
    for s in states[:25]:
        job=s["job"]
        pnl=s.get("profit",s.get("floating_profit","-"))
        side=s.get("side",job.get("direction","-"))
        print(s["id"],"|",job.get("symbol","-"),"|",side,"|",LABELS.get(s["phase"],s["phase"]),"|",s.get("volume","-"),"|",pnl)
        code=s.get("code","")
        print("  "+CODES.get(code,code))
    return states

def assert_receiver(mailbox,trade=False):
    if trade:
        need(not (DATA/"STOP").exists(),"El receptor esta en parada. Inicia INICIAR_RESIDENTE.cmd.")
    status=mailbox.github.json("bridge/resident-v2/status/"+mailbox.device+".json")
    need(isinstance(status,dict),"No hay estado del receptor. Abre INICIAR_RESIDENTE.cmd.")
    stamp=datetime.fromisoformat(status["updated_at"].replace("Z","+00:00")).timestamp()
    need(0<=time.time()-stamp<=150,"El receptor no tiene un estado reciente. Comprueba que sigue encendido.")
    if trade:
        health=status.get("health",{})
        if health and not health.get("trade_ready"):
            print("Cotizacion/permisos:",health.get("code"),"| Antiguedad del precio:",health.get("quote_age_seconds"),"segundos")
        need(status.get("code")=="RESIDENT_ONLINE","Receptor: "+str(status.get("code")))
    return status

def preview_trade(job,config):
    side={"buy":"COMPRA","sell":"VENTA","structure":"ESTRUCTURA"}[job["direction"]]
    size=("Lote fijo "+str(job["lots"]) if "lots" in job else "Riesgo "+str(job["risk_percent"])+"%" if "risk_percent" in job else settings_summary(config))
    print("\n--- SOLICITUD DEMO ---")
    print("Activo:",job["symbol"],"|",side,"|",job.get("timeframe","MANUAL DIRECTA"))
    print(size)
    if "sl_distance" in job:
        print("SL a distancia:",job["sl_distance"],"| TP a distancia:",job.get("tp_distance","por RR"),"en unidades de precio del oro.")
    else:
        print("RR 1:"+str(job["rr"]))
    print("Sin cierre por tiempo; cierras tu o SL/TP." if job["hold_seconds"]==0 else "Duracion maxima abierta: "+str(job["hold_seconds"]//60)+" minutos; SL/TP pueden cerrar antes.")
    if job["direction"]=="structure":
        print("Espera una ruptura confirmada a favor de la estructura. Puede vencer sin entrada.")
    else:
        print("Entrada directa por tu instruccion. No evalua direccion de la tendencia.")
        print("La solicitud caduca en dos minutos si no logra entrar.")
    if "sl_distance" not in job:
        print("En modo estructura, SL/TP usan volatilidad/estructura y filtros del receptor.")
    print("ID:",job["id"])
    return input("Escribe ENVIAR para confirmar, o Enter para cancelar: ").strip().upper()=="ENVIAR"

def submit_and_watch(mailbox,job):
    outcome=mailbox.submit(job)
    print("\nSolicitud registrada:",job["id"],"("+outcome+")")
    print("Esto confirma el envio al receptor; la apertura/cierre se confirma por separado.")
    path=DATA/"state"/(job["id"]+".json")
    for _ in range(15):
        if path.is_file():
            state=json.loads(path.read_text(encoding="utf-8"))
            print("Receptor:",LABELS.get(state["phase"],state["phase"]),"-",CODES.get(state.get("code"),state.get("code")))
            if job["action"]=="close":
                print("Consulta el ID de la operacion para confirmar el cierre:",job["target_id"])
            return
        time.sleep(1)
    print("Aun no hay respuesta local. Consulta el estado; no crees otra solicitud para repetirla.")

def trade_menu(mailbox,config,direction):
    need(allowed_direction(MODE,direction),"Esta entrada pertenece al otro menu.")
    assert_receiver(mailbox,trade=True)
    print("\n",{"buy":"COMPRAR","sell":"VENDER","structure":"ENTRADA POR ESTRUCTURA"}[direction],config["symbol"],"- DEMO")
    manual=direction in {"buy","sell"}
    sl,tp=None,None
    if manual:
        tf=None
        print("Entrada manual: no espera senales ni consulta velas de tu estrategia.")
        print("Distancias SL/TP en PRECIO, no en ganancia/perdida monetaria.")
        sl=number("Distancia de SL",min(5.0,config["max_stop_price"]),0.1,config["max_stop_price"])
        tp=number("Distancia de TP",min(sl*2,250.0),0.1,250.0)
        hold=integer("Minutos maximos abierta (0=sin cierre por tiempo)",0,0,60)
        rr=2.0
    else:
        tf=integer("Velas en minutos (1 o 5)",5,1,5)
        need(tf in (1,5),"Solo M1 o M5.")
        hold=integer("Minutos maximos abierta",5,1,60)
        rr=number("Relacion beneficio/riesgo",2,1,5)
    print("\nTamano: 1=Configuracion actual ("+settings_summary(config)+"), 2=Lote fijo, 3=Riesgo %")
    mode=integer("Seleccion",1,1,3)
    size_mode="configured"
    size=None
    if mode==2:
        size_mode="fixed"
        size=number("Lotes",config["fixed_lots"],0.001,1.0)
    elif mode==3:
        size_mode="risk"
        size=number("Riesgo %",config["risk_percent"],0.05,2.0)
    wait=integer("Minutos para encontrar la senal",30,1,60) if direction=="structure" else 2
    job=make_trade(config,direction,None if manual else "M"+str(tf),hold,size_mode,size,rr,wait,sl_distance=sl,tp_distance=tp)
    mailbox.validator(job,config["symbol"])
    if preview_trade(job,config):
        submit_and_watch(mailbox,job)
    else:
        print("Cancelado; no se envio ninguna solicitud.")

def close_menu(mailbox,all_active=False):
    states=show_states()
    active={s["id"]:s for s in states if s["phase"] not in {"done","failed"}}
    need(bool(active),"No hay solicitudes activas de este menu.")
    if all_active:
        ids=list(active)
        print("\nSe cancelaran/cerraran SOLO las solicitudes de este menu:",", ".join(ids))
        need(input("Escribe CERRAR para confirmar: ").strip().upper()=="CERRAR","Cancelado.")
    else:
        target=input("\nID a cerrar o cancelar: ").strip()
        need(target in active,"El ID no corresponde a una solicitud activa de este menu.")
        need(input("Escribe CERRAR para confirmar "+target+": ").strip().upper()=="CERRAR","Cancelado.")
        ids=[target]
    for target in ids:
        submit_and_watch(mailbox,make_close(target))

def retry_menu(mailbox):
    states=load_states(DATA/"state")
    records=[row for row in mailbox.unresolved() if request_in_mode(row.get("job",{}),MODE,states)]
    need(bool(records),"No hay envios locales por verificar.")
    for i,row in enumerate(records,1):
        print(i,row["job"]["id"],row["outcome"])
    choice=integer("Solicitud para verificar/reintentar con el MISMO ID",1,1,len(records))
    job=records[choice-1]["job"]
    need(input("Escribe REINTENTAR para continuar: ").strip().upper()=="REINTENTAR","Cancelado.")
    submit_and_watch(mailbox,job)

def view_logs():
    path=DATA/"operaciones.jsonl"
    if not path.is_file():
        print("Todavia no hay operaciones registradas.")
        return
    ids={s["id"] for s in selected_states(load_states(DATA/"state"),MODE)}
    entries=[]
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row=json.loads(line)
            if row.get("id") in ids:
                entries.append(line)
        except ValueError:
            continue
    for line in entries[-30:]:
        try:
            row=json.loads(line)
            print(row.get("time_utc",""),"|",row.get("event",""),"|",row.get("id",""),
                  "| Lote:",row.get("volume","-"),"| Precio:",row.get("price","-"),"| Neto:",row.get("profit","-"))
        except ValueError:
            continue

def main():
    global MODE
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",nargs="?",choices=["manual","strategy"],default="manual")
    MODE=parser.parse_args().mode
    need(os.name=="nt","Este panel es para Windows.")
    mailbox,config=connect_mailbox()
    actions=mode_actions(MODE)
    while True:
        clear()
        print("OLFX - "+("ORDENES MANUALES" if MODE=="manual" else "ESTRATEGIA POR ESTRUCTURA")+" - DEMO")
        print("Activo:",config["symbol"],"| Configuracion actual:",settings_summary(config))
        print("Deja encendidos MT5 y el receptor residente.")
        print("Las solicitudes y los cierres de esta ventana corresponden solo a este menu.")
        print()
        for key,(label,action) in actions.items():
            print(key+". "+label)
        print("0. Salir")
        choice=input("\nElige una opcion: ").strip()
        if choice=="0":
            return
        selected=actions.get(choice)
        if selected is None:
            print("Opcion no valida.")
            pause()
            continue
        action=selected[1]
        try:
            if action in {"buy","sell","structure"}:
                trade_menu(mailbox,config,action)
            elif action=="states":
                show_states()
            elif action in {"close","close_all"}:
                close_menu(mailbox,action=="close_all")
            elif action=="diagnose":
                status=assert_receiver(mailbox)
                count=sum(s["phase"] not in {"done","failed"} for s in selected_states(load_states(DATA/"state"),MODE))
                print("\nReceptor:",status.get("code"),"| Version:",status.get("version"),"| Activas de este menu:",count)
                print("Este diagnostico consulta el ultimo estado publicado.")
            elif action=="logs":
                view_logs()
            elif action=="retry":
                retry_menu(mailbox)
        except Exception as exc:
            if isinstance(exc,PanelError) or type(exc).__name__ in {"Fault","BridgeError"}:
                print("\nNo completado:",str(exc))
            else:
                print("\nNo completado. Revisa conexion, receptor y configuracion; no se muestran datos privados.")
        pause()

if __name__=="__main__":
    try:
        main()
    except (KeyboardInterrupt,EOFError):
        print("\nPanel cerrado. El receptor sigue gestionando las operaciones.")
    except Exception as exc:
        print(str(exc) if isinstance(exc,PanelError) else "No se pudo abrir el panel. Revisa que el receptor este instalado bajo este usuario.")
        input("Enter para salir...")
