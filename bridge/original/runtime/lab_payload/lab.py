"""OLFX range lab. MT5 data access only; no trading API calls."""
import argparse
import csv
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import numpy as np

ROOT = Path(__file__).resolve().parent
NY = ZoneInfo('America/New_York')
UTC = timezone.utc
ENGINE = 'OLFX_RANGE_STRUCTURE_V2.0'
DEFAULT = dict(symbol='NAS100', terminal_path='', train_days=180, validation_days=90,
    initial_balance=10000.0, risk_pct=0.5, commission_roundtrip_per_lot=None,
    slippage_points_per_side=None, max_spread_points=None,
    time_confirmed=False, excluded_holidays=[],
    frames_minutes=[1,3,5,15], pivot_lengths=[2,3], atr_buffers=[0.20,0.30],
    exit_modes=['TP1','TP2','PARCIAL'], confirmation='Cierre',
    structure_lookback=30, buffer_ticks=2,
    target_winrate=0.75, min_train_trades=60, min_validation_trades=40,
    min_demo_trades=60, min_demo_days=30, max_drawdown_pct=10.0,
    min_profit_factor=1.2, min_wilson_lower=0.60)


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, allow_nan=False).encode()).hexdigest()


def save(path, obj):
    path = Path(path)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(obj, indent=2, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    temp.replace(path)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def config():
    path = ROOT/'config.json'
    if not path.exists():
        save(path, DEFAULT)
    c = {**DEFAULT, **read(path)}
    for k in DEFAULT:
        if k not in c:
            raise ValueError('Falta campo: '+k)
    numeric = ['initial_balance','risk_pct','target_winrate','max_drawdown_pct',
        'min_profit_factor','min_wilson_lower','commission_roundtrip_per_lot',
        'slippage_points_per_side','max_spread_points']
    for k in numeric:
        if type(c[k]) not in (int,float) or not math.isfinite(c[k]):
            raise ValueError('Configura un numero finito en '+k+' (menu 1).')
    if not c['time_confirmed']:
        raise ValueError('Confirma primero el horario UTC/NY en el menu 1.')
    if not 0 < c['risk_pct'] <= 2 or c['initial_balance'] <= 0:
        raise ValueError('Balance debe ser positivo; riesgo entre 0 y 2%.')
    if min(c['commission_roundtrip_per_lot'], c['slippage_points_per_side']) < 0 or c['max_spread_points'] <= 0:
        raise ValueError('Costos no negativos; spread maximo positivo.')
    for k in ['train_days','validation_days','min_train_trades','min_validation_trades','min_demo_trades','min_demo_days']:
        if type(c[k]) is not int or c[k] <= 0:
            raise ValueError(k+' debe ser un entero positivo.')
    if c['validation_days'] < 90 or c['train_days'] < 90:
        raise ValueError('Se requieren al menos 90 dias para cada periodo.')
    if c['min_train_trades'] < 60 or c['min_validation_trades'] < 40 or c['min_demo_trades'] < 60 or c['min_demo_days'] < 30:
        raise ValueError('No reduzcas los minimos: 60 entrenamiento, 40 validacion, 60 demo, 30 dias demo.')
    if not .70 <= c['target_winrate'] <= 1 or not .60 <= c['min_wilson_lower'] < 1:
        raise ValueError('Objetivo minimo 70%; limite Wilson minimo 60%.')
    if not 0 < c['max_drawdown_pct'] <= 10 or c['min_profit_factor'] < 1.2:
        raise ValueError('DD maximo 10%; profit factor minimo 1.2.')
    total=len(c['frames_minutes'])*len(c['pivot_lengths'])*len(c['atr_buffers'])*len(c['exit_modes'])
    if not 0 < total <= 64:
        raise ValueError('Rejilla vacia o mayor de 64 configuraciones.')
    if any(type(x) is not int or x not in [1,3,5,15] for x in c['frames_minutes']):
        raise ValueError('Temporalidades validas: 1,3,5,15 minutos.')
    if not c['pivot_lengths'] or any(type(x) is not int or not 1<=x<=10 for x in c['pivot_lengths']):
        raise ValueError('Pivotes: entre 1 y 10 velas por lado.')
    if not c['atr_buffers'] or any(type(x) not in (int,float) or not math.isfinite(x) or x<0 for x in c['atr_buffers']):
        raise ValueError('Margenes ATR finitos y no negativos.')
    if not c['exit_modes'] or any(x not in ['TP1','TP2','PARCIAL'] for x in c['exit_modes']):
        raise ValueError('Salidas validas: TP1, TP2, PARCIAL.')
    if c['confirmation'] not in ['Cierre','Mecha']:
        raise ValueError('Confirmacion: Cierre o Mecha.')
    if type(c['structure_lookback']) is not int or not 5<=c['structure_lookback']<=200:
        raise ValueError('Ventana estructura: 5 a 200 velas.')
    if type(c['buffer_ticks']) is not int or c['buffer_ticks']<1:
        raise ValueError('Margen minimo de un tick.')
    for d in c['excluded_holidays']:
        datetime.strptime(d, '%Y-%m-%d')
    return c


def connect(c):
    import MetaTrader5 as mt
    ok = mt.initialize(c['terminal_path']) if c['terminal_path'] else mt.initialize()
    if not ok:
        raise ValueError('Abre MT5 e inicia sesion: '+str(mt.last_error()))
    account = mt.account_info()
    if not account or account.currency != 'USD':
        raise ValueError('Requiere cuenta con moneda USD.')
    names = [s.name for s in mt.symbols_get() or ()]
    aliases = [c['symbol']] + (['USTECH','US100'] if c['symbol'].upper() == 'NAS100' else [])
    symbol = next((n for a in aliases for n in names if n.casefold() == a.casefold()), None)
    if not symbol or not mt.symbol_select(symbol, True):
        raise ValueError('Simbolo no encontrado. Escribe el nombre exacto en configuracion.')
    s = mt.symbol_info(symbol)
    if s.chart_mode != 0 or s.currency_profit != 'USD':
        raise ValueError('Solo simbolos con velas BID y beneficio en USD en esta version.')
    fields = ['point','trade_tick_size','trade_tick_value_profit','trade_tick_value_loss',
              'volume_min','volume_max','volume_step','trade_stops_level']
    info = {k:float(getattr(s,k)) for k in fields}
    if any(not math.isfinite(v) or v <= 0 for k,v in info.items() if k != 'trade_stops_level'):
        raise ValueError('Propiedades del contrato no disponibles.')
    return mt, symbol, info, account.server


def bounds(day):
    base = datetime.combine(day, datetime.min.time(), NY)
    return tuple(int((base+timedelta(minutes=m)).timestamp()*1000) for m in (630,645,955))


def get_day(mt, symbol, day):
    start,arm,end = bounds(day)
    a = datetime.fromtimestamp(start/1000, UTC)
    b = datetime.fromtimestamp((end+60000)/1000, UTC)
    bars = mt.copy_rates_range(symbol, mt.TIMEFRAME_M1, a, b)
    ticks = mt.copy_ticks_range(symbol, a, b, mt.COPY_TICKS_ALL)
    if bars is None or ticks is None:
        raise ValueError(f'{day}: fallo MT5 {mt.last_error()}')
    q = np.column_stack((ticks['time_msc'],ticks['bid'],ticks['ask'])).astype(float)
    check_quotes(q)
    expected = np.arange(start//60000,end//60000)
    if not np.all(np.isin(expected, bars['time']//60)):
        raise ValueError(f'{day}: faltan velas de la sesion. Si fue festivo real, decláralo antes de optimizar.')
    if not np.all(np.isin(expected, q[:,0].astype('int64')//60000)):
        raise ValueError(f'{day}: faltan ticks en minutos de la sesion.')
    if not np.any((q[:,0] >= end) & (q[:,0] < end+60000)):
        raise ValueError(f'{day}: falta cotizacion de cierre de sesion.')
    # Contrasta extremos BID del rango; detecta historial de ticks truncado en el rango.
    r = bars[(bars['time']*1000 >= start) & (bars['time']*1000 < arm)]
    t = q[(q[:,0]>=start)&(q[:,0]<arm),1]
    if len(r)!=15 or not len(t) or abs(max(r['high'])-max(t))>1e-7 or abs(min(r['low'])-min(t))>1e-7:
        raise ValueError(f'{day}: extremos de ticks y velas no coinciden; no se aprueba.')
    context = load_context(mt,symbol,day)
    return q,context


def load_context(mt,symbol,day):
    start=bounds(day)[0]
    a=datetime.fromtimestamp(start/1000,UTC)-timedelta(days=7)
    b=datetime.fromtimestamp(start/1000,UTC)
    bars=mt.copy_rates_range(symbol,mt.TIMEFRAME_M1,a,b)
    if bars is None:
        raise ValueError('No se pudo leer contexto M1 para estructura.')
    context=np.column_stack((bars['time']*1000,bars['open'],bars['high'],bars['low'],bars['close'])).astype(float)
    context=context[context[:,0]<start]
    from range_structure import aggregate_context
    if any(len(aggregate_context(context, f))<100 for f in (1,3,5,15)):
        raise ValueError('Contexto insuficiente: se necesitan 100 velas completas por temporalidad para estructura/ATR.')
    if not np.all(np.isfinite(context)) or np.any(np.diff(context[:,0])<=0):
        raise ValueError('Contexto M1 invalido.')
    return context


def check_quotes(q):
    if len(q) == 0 or q.ndim != 2 or q.shape[1] != 3:
        raise ValueError('Sin cotizaciones completas.')
    if not np.all(np.isfinite(q)) or np.any(q[:,1]<=0) or np.any(q[:,2]<q[:,1]) or np.any(np.diff(q[:,0])<0):
        raise ValueError('Ticks invalidos, cruzados o fuera de orden.')


def candles(q, frame):
    bucket = q[:,0].astype('int64')//(frame*60000)
    idx = np.r_[np.flatnonzero(np.diff(bucket)),len(bucket)-1]
    return (bucket[idx]+1)*frame*60000, q[idx,1], bucket[idx]*frame*60000


from range_structure import replay


def metrics(trades,c):
    closed = [t for t in trades if t['net'] is not None]
    vals = [t['net'] for t in closed]
    n = len(vals)
    wins = sum(v>0 for v in vals)
    p = wins/n if n else 0
    z = 1.96
    lower = (p+z*z/(2*n)-z*math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n) if n else 0
    gains,losses = sum(max(v,0) for v in vals),-sum(min(v,0) for v in vals)
    balance=peak=c['initial_balance']
    dd=0.
    for t in trades:
        for local_peak,local_low in t.get('dd_pairs',[[0,t['worst']]]):
            peak=max(peak,balance+local_peak)
            dd=max(dd,100*(peak-(balance+local_low))/peak)
        if t['net'] is not None:
            balance+=t['net']
            peak=max(peak,balance)
            dd=max(dd,100*(peak-balance)/peak)
    return dict(trades=n,wins=wins,winrate=p,wilson95_lower=lower,net=sum(vals),
        profit_factor=gains/losses if losses else None, no_losses=bool(gains>0 and losses==0),
        max_drawdown_pct=dd, open_trades=len(trades)-n)


def passes(m,c,minimum):
    return (m['trades']>=minimum and m['winrate']>=c['target_winrate'] and
        m['wilson95_lower']>=c['min_wilson_lower'] and m['net']>0 and
        (m['no_losses'] or (m['profit_factor'] is not None and m['profit_factor']>=c['min_profit_factor'])) and
        m['max_drawdown_pct']<=c['max_drawdown_pct'] and not m['open_trades'])


def days(a,b,c):
    while a<b:
        if a.weekday()<5 and str(a) not in c['excluded_holidays']:
            yield a
        a+=timedelta(days=1)


def export_trades(path,trades):
    if not trades:
        path.write_text('Sin operaciones.\n',encoding='utf-8-sig')
        return
    with path.open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=list(trades[0]))
        w.writeheader(); w.writerows(trades)


def engine_hash():
    return hashlib.sha256(Path(__file__).read_bytes()+(ROOT/'range_structure.py').read_bytes()).hexdigest()


def verify(run):
    m=read(run/'manifest.json')
    h=m.pop('sha256')
    if h!=digest(m):
        raise ValueError('Manifiesto modificado. Se bloquea la ejecucion.')
    if m['engine_hash']!=engine_hash():
        raise ValueError('Motor diferente al motor congelado.')
    return m


def latest():
    items=sorted((ROOT/'experimentos').glob('*/estado.json'))
    if not items:
        raise ValueError('Primero ejecuta las fases 1 y 2.')
    return items[-1].parent


def check_remote_stop():
    if os.environ.get('OLFX_LAB_REMOTE')=='1' and (ROOT/'remote_stop').exists():
        raise KeyboardInterrupt


def experiment():
    c=config()
    mt,symbol,info,server=connect(c)
    today=datetime.now(NY).date()
    vb=today-timedelta(days=c['validation_days'])
    ta=vb-timedelta(days=c['train_days'])
    ledger_path=ROOT/'validaciones_consumidas.json'
    ledger=read(ledger_path) if ledger_path.exists() else []
    if any(str(vb)<e['end'] and str(today)>e['start'] for e in ledger):
        raise ValueError('Validacion solapada con datos ya usados. Se requieren fechas futuras sin usar; no se vuelve a buscar el 75% sobre el mismo examen.')
    run=ROOT/'experimentos'/(datetime.now(UTC).strftime('%Y%m%dT%H%M%S')+'_'+uuid4().hex[:6])
    run.mkdir(parents=True)
    save(run/'config_congelada.json',c)
    try:
        params=[dict(frame=f,pivot=p,atr_buffer=b,exit_mode=e,confirmation=c['confirmation'],
                     lookback=c['structure_lookback'],buffer_ticks=c['buffer_ticks'])
                for f,p,b,e in itertools.product(c['frames_minutes'],c['pivot_lengths'],c['atr_buffers'],c['exit_modes'])]
        training=[[] for _ in params]
        evidence=[]
        print('FASE 1. Entrenamiento',ta,'a',vb,'(fin exclusivo).',flush=True)
        for d in days(ta,vb,c):
            check_remote_stop()
            q,context=get_day(mt,symbol,d)
            evidence.append(dict(day=str(d),phase='TRAIN',sha256=hashlib.sha256(q.tobytes()+context.tobytes()).hexdigest(),ticks=len(q)))
            for p,ts in zip(params,training):
                t=replay(q,d,p,c,info,context=context)
                if t: ts.append(t)
            print(d,'OK',len(q),'ticks',flush=True)
        table=[dict(params=p,metrics=metrics(ts,c)) for p,ts in zip(params,training)]
        save(run/'optimizacion.json',table)
        eligible=[i for i,row in enumerate(table) if passes(row['metrics'],c,c['min_train_trades'])]
        if not eligible:
            save(run/'estado.json',dict(status='RECHAZADA_ENTRENAMIENTO',reason='Ninguna configuracion cumple todos los criterios. No se consulta validacion.'))
            print('RECHAZADA: ninguna configuracion paso entrenamiento. No hay que forzar 75%.')
            return
        # Ranking only on training. Exactly one candidate ever sees holdout.
        best=max(eligible,key=lambda i:(table[i]['metrics']['wilson95_lower'],table[i]['metrics']['net'],-i))
        manifest=dict(engine=ENGINE,engine_hash=engine_hash(),
            params=params[best],config=c,symbol=symbol,info=info,server=server,
            train_start=str(ta),validation_start=str(vb),validation_end=str(today),
            trials=len(params),created_utc=datetime.now(UTC).isoformat())
        save(run/'manifest.json',{**manifest,'sha256':digest(manifest)})
        # Mark BEFORE viewing holdout. Errors cannot turn this dataset into a fresh exam.
        ledger.append(dict(start=str(vb),end=str(today),run=run.name))
        save(ledger_path,ledger)
        validation=[]
        print('FASE 2. Un candidato congelado.',params[best],flush=True)
        for d in days(vb,today,c):
            check_remote_stop()
            q,context=get_day(mt,symbol,d)
            evidence.append(dict(day=str(d),phase='VALIDATION',sha256=hashlib.sha256(q.tobytes()+context.tobytes()).hexdigest(),ticks=len(q)))
            t=replay(q,d,params[best],c,info,context=context)
            if t: validation.append(t)
            print(d,'OK',flush=True)
        export_trades(run/'operaciones_validacion.csv',validation)
        m=metrics(validation,c)
        status='LISTA_PARA_DEMO' if passes(m,c,c['min_validation_trades']) else 'RECHAZADA_VALIDACION'
        windows={str(n):metrics([t for t in validation if t['day']>=str(today-timedelta(days=n))],c) for n in (14,30,60,90)}
        save(run/'estado.json',dict(status=status,validation=m,windows_14_30_60_90=windows,
            note='Ventanas descriptivas solapadas; no son cuatro validaciones independientes.'))
        print(status,json.dumps(m,indent=2),flush=True)
    except KeyboardInterrupt:
        save(run/'estado.json',dict(status='INCOMPLETO',error='Prueba detenida; fechas consumidas conservadas.'))
        raise
    except Exception as e:
        save(run/'estado.json',dict(status='INCOMPLETO',error=str(e)))
        raise
    finally:
        if 'evidence' in locals(): save(run/'datos_auditados.json',evidence)
        mt.shutdown()
        print('Resultados:',run)


def demo():
    run=latest()
    m=verify(run)
    if read(run/'estado.json')['status']!='LISTA_PARA_DEMO':
        raise ValueError('La validacion no aprobo. No se inicia demo.')
    c=m['config']
    mt,symbol,info,server=connect(c)
    if symbol!=m['symbol'] or info!=m['info'] or server!=m['server']:
        raise ValueError('Simbolo, servidor o contrato diferente al validado.')
    path=run/'demo.json'
    state=read(path) if path.exists() else dict(started_utc=datetime.now(UTC).isoformat(),sessions={},trades=[],issues=[])
    if 'campaign_start' not in state:
        first=datetime.now(NY).date()
        if int(datetime.now(UTC).timestamp()*1000)>=bounds(first)[0]: first+=timedelta(days=1)
        while first.weekday()>=5 or str(first) in c['excluded_holidays']: first+=timedelta(days=1)
        state['campaign_start']=str(first)
        save(path,state)
    print('FASE 3: simulacion local con ticks en vivo. No envia ordenes a MT5.')
    print('Deja esta ventana abierta antes de 10:30 NY hasta 15:55 NY. Ctrl+C termina.')
    current=None; q=np.empty((0,3)); cursor=None; invalid=False; last_poll=time.monotonic(); display_minute=None
    try:
        while True:
            check_remote_stop()
            now=datetime.now(UTC); day=now.astimezone(NY).date()
            start,arm,end=bounds(day)
            if day!=current:
                current=day; context=None; q=np.empty((0,3)); cursor=int(now.timestamp()*1000); invalid=False
                key=str(day)
                if day.weekday()>=5 or key in c['excluded_holidays']:
                    invalid=True
                elif key<state['campaign_start']:
                    invalid=True
                elif key in state['sessions']:
                    invalid=True # never replay/relabel an interrupted or completed day
                elif cursor>start:
                    state['sessions'][key]='INVALIDA_INICIO_TARDIO';invalid=True
                else:
                    context=load_context(mt,symbol,day)
                    state['sessions'][key]='EN_CURSO'
                save(path,state)
            if time.monotonic()-last_poll>20 and not invalid and start<=int(now.timestamp()*1000)<=end:
                state['sessions'][str(day)]='INVALIDA_INTERRUPCION';invalid=True
                state['issues'].append(str(day)+': interrupcion de mas de 20 segundos')
                save(path,state)
            last_poll=time.monotonic()
            now_ms=int(now.timestamp()*1000)
            if not invalid and start<=now_ms<=end+60000:
                ticks=mt.copy_ticks_range(symbol,datetime.fromtimestamp(cursor/1000,UTC),now,mt.COPY_TICKS_ALL)
                if ticks is None:
                    raise ValueError('Error leyendo ticks en vivo: '+str(mt.last_error()))
                new=np.column_stack((ticks['time_msc'],ticks['bid'],ticks['ask'])).astype(float)
                if len(new):
                    new=new[new[:,0]>cursor]
                if len(new):
                    check_quotes(new)
                    if now_ms-new[-1,0]>20000 or (len(q) and new[0,0]-q[-1,0]>20000):
                        raise ValueError('Flujo de ticks interrumpido durante la sesion.')
                    q=np.concatenate((q,new));cursor=int(new[-1,0])
                    t=replay(q,day,m['params'],c,info,context=context)
                    if t:
                        state['trades']=[x for x in state['trades'] if x['day']!=str(day)]+[t]
                    if now_ms>=end and q[-1,0]>=end:
                        expected=np.arange(start//60000,end//60000)
                        complete=np.all(np.isin(expected,q[:,0].astype('int64')//60000))
                        state['sessions'][str(day)]='COMPLETA' if complete else 'INVALIDA_DATOS'
                        invalid=True
                    save(path,state)
                elif now_ms-max(cursor,start)>20000:
                    raise ValueError('Sin ticks recientes. Se invalida el dia.')
            elif not invalid and now_ms>end+60000:
                state['sessions'][str(day)]='INVALIDA_SIN_CIERRE';invalid=True
                save(path,state)
            valid_days={d for d,s in state['sessions'].items() if s=='COMPLETA'}
            trades=[t for t in state['trades'] if t['day'] in valid_days]
            stats=metrics(trades,c)
            elapsed=(day-datetime.fromisoformat(state['started_utc']).astimezone(NY).date()).days
            # An interruption while a trade is open invalidates the entire campaign.
            # Do not silently exclude a potentially losing position from approval.
            bad_open=any(t['day'] not in valid_days and state['sessions'].get(t['day'])!='EN_CURSO' for t in state['trades'])
            scheduled=list(days(datetime.strptime(state['campaign_start'],'%Y-%m-%d').date(),day,c))
            missing=any(str(d) not in valid_days for d in scheduled)
            compromised=bad_open or missing or any(s.startswith('INVALIDA') for d,s in state['sessions'].items() if d>=state['campaign_start'])
            status='APROBADA_EN_SIMULACION' if elapsed>=c['min_demo_days'] and not compromised and passes(stats,c,c['min_demo_trades']) else 'PENDIENTE'
            if display_minute!=now_ms//60000:
                display_minute=now_ms//60000
                print(now.astimezone(NY).strftime('%Y-%m-%d %H:%M NY'),status,'cerradas:',stats['trades'],'campana interrumpida:',compromised,flush=True)
            save(run/'resultado_demo.json',dict(status=status,calendar_days=elapsed,complete_sessions=len(valid_days),
                compromised_campaign=compromised,metrics=stats,note='No habilita trading real. Simulacion de ejecucion, no llenados de broker.'))
            if status=='APROBADA_EN_SIMULACION':
                print(status,stats);return
            time.sleep(2)
    finally:
        if current is not None and state['sessions'].get(str(current))=='EN_CURSO':
            state['sessions'][str(current)]='INVALIDA_INTERRUPCION'
        save(path,state)
        mt.shutdown()


def setup():
    path=ROOT/'config.json'
    c={**DEFAULT,**read(path)} if path.exists() else DEFAULT.copy()
    def ask(k,label,cast=str):
        old=c[k]
        s=input(f'{label} [{old}]: ').strip()
        if s: c[k]=cast(s)
    ask('symbol','Simbolo exacto (NAS100/USTECH/US100)')
    ask('terminal_path','Ruta terminal64.exe, vacio = autodetectar')
    ask('commission_roundtrip_per_lot','Comision TOTAL entrada+salida USD por 1 lote; 0 solo si realmente es cero',float)
    ask('slippage_points_per_side','Slippage adverso por lado en POINTS MT5 (precio / point)',float)
    ask('max_spread_points','Spread maximo en POINTS MT5',float)
    ask('initial_balance','Balance simulado USD',float)
    ask('risk_pct','Riesgo fijo por trade % del balance inicial (maximo 2)',float)
    ask('train_days','Dias entrenamiento (180 recomendado)',int)
    ask('validation_days','Dias validacion (90 recomendado)',int)
    print('Rango NY 10:30-10:45; primera ruptura BUY o SELL; SL tras estructura + margen ATR/ticks; TP1=1R, TP2=2R; cierre 15:55 NY.')
    print('API MT5 utiliza UTC. Confirma con tu broker que sus timestamps representan UTC y coinciden con NY; no se aplica NY+7 automaticamente.')
    c['time_confirmed']=input('Horario verificado? Escribe UTC_VERIFICADO: ').strip()=='UTC_VERIFICADO'
    save(path,c)
    config()
    print('Configuracion guardada. Rejilla finita de hasta 64 variantes; objetivo 75%.')


def main():
    (ROOT/'experimentos').mkdir(exist_ok=True)
    if '--run' in sys.argv:
        experiment();return
    if '--demo' in sys.argv:
        demo();return
    while True:
        print('\nOLFX LAB SEGURO\n1 Configurar costos y simbolo\n2 Optimizar + validar (automatico)\n3 Demo en vivo sin ordenes\n4 Ver ultimo resultado\n5 Abrir carpeta de resultados\n0 Salir')
        choice=input('OLFX> ').strip()
        try:
            if choice=='0': return
            if choice=='1': setup()
            elif choice=='2': experiment()
            elif choice=='3': demo()
            elif choice=='4':
                r=latest()
                print((r/'estado.json').read_text(encoding='utf-8'))
                if (r/'resultado_demo.json').exists(): print((r/'resultado_demo.json').read_text(encoding='utf-8'))
            elif choice=='5': os.startfile(ROOT/'experimentos')
        except (KeyboardInterrupt,EOFError): print('\nProceso detenido. Resultados conservados.')
        except Exception:
            traceback.print_exc()
            print('No se aprobo la estrategia. Corrige el problema indicado.')


if __name__=='__main__':
    # OS lock is released automatically on exit, including process termination.
    lock=(ROOT/'instancia.lock').open('a+b')
    lock.write(b'0');lock.flush();lock.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        print('OLFX LAB ya esta abierto en esta carpeta. Cierra la otra ventana.')
        sys.exit(1)
    try:
        main()
    finally:
        lock.close()
