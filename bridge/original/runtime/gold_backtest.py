"""Launch/read a market-data-only backtest from the original Bridge console."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def status(root):
    folder=Path(root)/'backtests'
    try:
        manifest=json.loads((folder/'current.json').read_text())
        jid=manifest['job_id']
        if not isinstance(jid,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',jid):return None
        value=json.loads((folder/jid/'progress.json').read_text())
        value['snapshot_fresh']=0<=time.time()-value['updated_at']<=30
        return value
    except (OSError,ValueError,KeyError,TypeError):return None


def start(job,root,api,days=30):
    from gold_scalp import worker_locked
    api.require(type(days) is int and days in (14,30,60,90),'INVALID_BACKTEST_DAYS')
    root=Path(root);folder=root/'backtests';folder.mkdir(parents=True,exist_ok=True)
    if worker_locked(folder):return {'code':'BACKTEST_ALREADY_RUNNING',**(status(root) or {})}
    candidates=[Path(sys.executable),root/'resident-v2'/'venv'/'Scripts'/'python.exe']
    python=None
    for candidate in candidates:
        if candidate.is_file() and subprocess.run([str(candidate),'-c','import MetaTrader5'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15).returncode==0:
            python=candidate;break
    api.require(python is not None,'MT5_PYTHON_PACKAGE_NOT_AVAILABLE')
    api.atomic_json(folder/'current.json',{'job_id':job['id']})
    script=Path(__file__).resolve().with_name('gold_backtest_worker.py')
    flags=getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0)|getattr(subprocess,'BELOW_NORMAL_PRIORITY_CLASS',0)
    subprocess.Popen([str(python),str(script),job['id'],'--days',str(days)],cwd=script.parent,creationflags=flags)
    return {'code':f'BACKTEST_{days}D_STARTED','job_id':job['id'],'days':days,'symbol':'LOCAL_CONFIG','mode':'READ_ONLY_MARKET_DATA'}
