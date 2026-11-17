"""Pure menu routing and ownership filters. No terminal, credentials or network access."""
def mode_actions(mode):
    if mode=="manual":
        return {"1":("Comprar oro","buy"),"2":("Vender oro","sell"),
                "3":("Ver mis operaciones manuales","states"),"4":("Cerrar una manual por ID","close"),
                "5":("Cerrar todas las manuales","close_all"),"6":("Diagnostico","diagnose"),
                "7":("Logs manuales","logs"),"8":("Verificar envios manuales inciertos","retry")}
    if mode=="strategy":
        return {"1":("Iniciar estructura M1/M5","structure"),"2":("Ver solicitudes de estrategia","states"),
                "3":("Cerrar/cancelar una de estrategia","close"),"4":("Cerrar/cancelar todas las de estrategia","close_all"),
                "5":("Diagnostico","diagnose"),"6":("Logs de estrategia","logs"),"7":("Verificar envios de estrategia inciertos","retry")}
    raise ValueError("INVALID_MENU_MODE")

def allowed_direction(mode,direction):
    return (mode=="manual" and direction in {"buy","sell"}) or (mode=="strategy" and direction=="structure")

def request_in_mode(job,mode,states=()):
    if not isinstance(job,dict) or mode not in {"manual","strategy"}:
        return False
    if job.get("action")=="trade":
        return allowed_direction(mode,job.get("direction"))
    if job.get("action")=="close":
        target=next((s for s in states if s.get("id")==job.get("target_id")),None)
        return target is not None and target.get("job",{}).get("action")=="trade" and request_in_mode(target["job"],mode)
    return False

def selected_states(states,mode,active_only=False):
    mode_actions(mode)
    return [s for s in states if request_in_mode(s.get("job"),mode) and
            (not active_only or s.get("phase") not in {"done","failed"})]
