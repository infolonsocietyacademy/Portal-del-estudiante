"""Local DEMO-only XAUUSD settings. No account credentials or trade execution."""
import json
import math
from pathlib import Path
import re

DEFAULTS = dict(schema=1, symbol="XAUUSD", size_mode="fixed", fixed_lots=0.01,
                risk_percent=0.5, max_spread_price=0.60, max_stop_price=20.0)


def validate_gold_settings(data):
    if not isinstance(data, dict) or set(data) != set(DEFAULTS) or type(data.get("schema")) is not int or data["schema"] != 1:
        raise ValueError("CONFIG_XAUUSD_INVALIDA")
    if not isinstance(data["symbol"],str) or not re.fullmatch(r"XAUUSD(?:[._-]?[A-Za-z0-9]{1,8})?",data["symbol"]):
        raise ValueError("SIMBOLO_XAUUSD_INVALIDO")
    if data["size_mode"] not in ("fixed","percent"):
        raise ValueError("MODO_LOTE_INVALIDO")
    for name, low, high in (("fixed_lots",0.001,1.0),("risk_percent",0.05,2.0),
                            ("max_spread_price",0.01,5.0),("max_stop_price",0.10,50.0)):
        val=data[name]
        if type(val) not in (int,float) or not math.isfinite(val) or not low<=val<=high:
            raise ValueError("CONFIG_FUERA_DE_LIMITE_"+name.upper())
    return dict(data)


def load_gold_settings(root):
    path=Path(root)/"gold_settings.json"
    if not path.is_file():
        raise ValueError("EJECUTA_CONFIGURAR_XAUUSD_PRIMERO")
    if path.stat().st_size>8192:
        raise ValueError("CONFIG_XAUUSD_INVALIDA")
    return validate_gold_settings(json.loads(path.read_text(encoding="utf-8")))


def save_gold_settings(root,data):
    data=validate_gold_settings(data)
    root=Path(root); root.mkdir(parents=True,exist_ok=True)
    path=root/"gold_settings.json"
    tmp=path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data,indent=2),encoding="utf-8"); tmp.replace(path)
    return data


def configure_gold(root):
    import tkinter as tk
    from tkinter import ttk,messagebox
    try:
        data=load_gold_settings(root)
    except (OSError,ValueError):
        data=dict(DEFAULTS)
    window=tk.Tk();window.title("OLFX - XAUUSD M1 | SOLO DEMO")
    window.geometry("680x640");window.minsize(620,600)
    box=ttk.Frame(window,padding=22);box.pack(fill="both",expand=True)
    ttk.Label(box,text="Configurar XAUUSD M1",font=("Segoe UI",18,"bold")).grid(row=0,column=0,columnspan=2,sticky="w",pady=(0,8))
    ttk.Label(box,text="Solo DEMO. Guardar no abre operaciones.",font=("Segoe UI",11)).grid(row=1,column=0,columnspan=2,sticky="w",pady=(0,16))
    fields={};widgets={}
    labels=[("symbol","Simbolo exacto en MT5"),("size_mode","Tamano de la entrada"),
        ("fixed_lots","Lote fijo (maximo 1.00)"),("risk_percent","Riesgo % de equidad (0.05 a 2.00)"),
        ("max_spread_price","Spread en precio (0.01 a 5.00)"),("max_stop_price","Distancia SL en precio (0.10 a 50.00)")]
    mode_labels={"fixed":"Lote fijo","percent":"Riesgo porcentual"}
    for row,(key,label) in enumerate(labels,2):
        ttk.Label(box,text=label).grid(row=row,column=0,sticky="w",pady=9,padx=(0,14))
        var=tk.StringVar(value=mode_labels[data[key]] if key=="size_mode" else str(data[key]));fields[key]=var
        if key=="size_mode":
            entry=ttk.Combobox(box,textvariable=var,values=list(mode_labels.values()),state="readonly",width=24)
        else:
            entry=ttk.Entry(box,textvariable=var,width=27)
        entry.grid(row=row,column=1,sticky="ew",pady=9)
        widgets[key]=entry
    def toggle_mode(*unused):
        percent=fields["size_mode"].get()==mode_labels["percent"]
        widgets["fixed_lots"].configure(state="disabled" if percent else "normal")
        widgets["risk_percent"].configure(state="normal" if percent else "disabled")
    fields["size_mode"].trace_add("write",toggle_mode)
    toggle_mode()
    box.columnconfigure(1,weight=1)
    ttk.Label(box,text="En modo porcentual el lote se calcula al entrar, segun SL y datos del broker.\nSe redondea hacia abajo. Gastos y deslizamiento pueden aumentar la perdida.\nSi el lote minimo excede el presupuesto, se omite la entrada.\nCambios: solo proxima sesion. Sesion fija: hasta 3 intentos / 30 minutos.",wraplength=575,justify="left").grid(row=8,column=0,columnspan=2,sticky="w",pady=18)
    def save():
        try:
            new=dict(DEFAULTS)
            new["symbol"]=fields["symbol"].get().strip()
            new["size_mode"]={v:k for k,v in mode_labels.items()}[fields["size_mode"].get()]
            for key in ("fixed_lots","risk_percent","max_spread_price","max_stop_price"):
                new[key]=float(fields[key].get().strip().replace(",","."))
            save_gold_settings(root,new)
        except (ValueError,KeyError,OSError):
            messagebox.showerror("Revisa los datos","Usa un simbolo XAUUSD valido y valores dentro de los limites mostrados.",parent=window)
            return
        messagebox.showinfo("Guardado","Configuracion guardada para la PROXIMA sesion demo.\nNo se abrieron operaciones ni se modifico la sesion activa.",parent=window)
        window.destroy()
    buttons=ttk.Frame(box);buttons.grid(row=9,column=0,columnspan=2,sticky="e")
    ttk.Button(buttons,text="Cancelar",command=window.destroy).pack(side="left",padx=8)
    ttk.Button(buttons,text="Guardar para proxima sesion",command=save).pack(side="left")
    window.mainloop()
