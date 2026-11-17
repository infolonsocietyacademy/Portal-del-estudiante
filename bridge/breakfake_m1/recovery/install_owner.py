"""Owner-executed, hash-pinned Windows recovery. Never remotely auto-executed.

Restores a lost release-signing identity with a new owner-approved public key.
The private signing key is NOT included. Existing account/configuration survive.
Original signed runtime and trust key are retained for a paused rollback.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

REPO='infolonsocietyacademy/Portal-del-estudiante'
ROOT=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'OLFX_MT5_BRIDGE'
RECOVERY=ROOT/'owner-recovery-v1'
NEW_KEY={'e': 65537, 'n': 'c5672f22ffa86548ceb699f35d9f77feb6b76f1a20234d2b04599c8f0f5994582e6010083fe9dc054c228c51c6e770bdfd8643a8b38a37a90ff5a46f5ae7dd47c984d1b250d3de6e30d6e178b09a9f9bc3b0129b11efdd40e47dcd0425b4c2511e7e021b0da79a46a9620e1aa4aaaa1374c620db056abfc0de7d5528b21b71d294ef36e4934b51f3deed1e3299e3589e51b403fb43d4c0632ff39a7d5a09a52cd939c04a94378c3979e432047d969b0f79964eacfacca30ac3e070119c0c6b0a7afac7c336b0c1fd6d682a4f79a4ef5ffb6f54e939d1c85ad5c31a1c680902a50c2afdb779ebf38303dbaaf26f7e1e7738f208410c3714bbeab7d1872a6511ea36a01b82383ff5af7e55b1fd283bdc0bd6ca54c48de18cf32d221bd575438aab423e78fdeaa54bdf7da5ef821a6dea3d2cf0d8dc3df6dad790e754c8a93bc199fb1edf424826860d5880eeaf063db1f8621aec1b26dc4f078f2000e277aefae9506f782c39efbba1bde4591cd06e9416288d017d775f2b0fad7b3f5853b96844588ec079e9403513b781e466eaaac12f823d9a65c1442b6751f224490fe216a9b8b9d1eea1a7b346d024e9b5c7c5197bff1acd944fc08761277ae4d8815d4b4dd5901e4411e5df2785c7b24a2965e19409b1d3c6d950359659ad2d035bd029a446676f3122e0ae0a6cb9aa6abf53e50f2abab77759844a640b0417967b2fdc09'}
OLD_KEY={'n': '8f5b86d065e91d96f88e7bbaf5ba6a1ed3dde8729e09813c9b92cd53a7af9f0ae920a37123c34c1c034506f0fd940ab6d98fa172b63304aa0b08892a070d3c395a7db485efce5fb4b892dc6da9937dae7a9fd85bfc0c3dd51170edc2af1461b15f71a5313d13f886c64549b9f8ee6f74cfd4b1331137c7eec9062d8c72209e0083a4ddbe3f3c714b31ee723acf09e006df056fffa992e48ef95cd78896a29639d0e1580cab3b47d223b25cf840a4ecaad6f0b47fe6605cfb2d19d11d662fb33bc448b5fe0c0662391be8d850d1c6d8fde774c539a302e03ca02b1129ef4be7dc6ee79c61a75d50df80c7185e8895e5baa70a0d01ebd7d74285434658b42166ffa32e870a8900c6f24d38bd0a6a9c4e9b213be262488fbdd7a04ed71ef23ebf1cf739193a0d102647ae7a7a8501e0df19aaeac9e0e89f2083f0bf165be100952cfc7dc35b56ec71cf2616602869999d55e875365ffe5107744bd01b33db4820a61b786e0b9c19474109eade7e448a4075e1d27c888ca39aff0e557d36f6e1b8d7', 'e': 65537}
BOOTSTRAP_SHA='5ce19d70698bc35bcc89dc58f400a8742419c1aa92ee4c34acb4f780540bd526'
RELEASE_SHA='8705d47026b8d32cc17a7a6a19f9927146740f35b3b598b44fbcf02600f5c791'
VERSION='1.0.16'
SLUG='000016-1.0.16'
SOURCE_BASE='bridge/breakfake_m1/recovery/'
CRITICAL=('settings.json','mailbox.json','token.dpapi','gold_settings.json','gold-scalp-m1/account-pin.json')


def require(ok,code):
    if not ok:raise RuntimeError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()


def atomic(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.tmp')
    with temp.open('w',encoding='utf-8') as f:
        json.dump(value,f,sort_keys=True,indent=2);f.flush();os.fsync(f.fileno())
    temp.replace(path)


def module(path):
    spec=importlib.util.spec_from_file_location('_olfx_owner_bootstrap',path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value


def critical_hashes(root):
    values={}
    for name in CRITICAL:
        p=Path(root)/name
        require(p.is_file() and not p.is_symlink(),'RECOVERY_EXISTING_CONFIGURATION_REQUIRED')
        values[name]=sha(p.read_bytes())
    return values


def locked(folder):
    import msvcrt
    p=Path(folder)/'agent.lock'
    if not p.is_file():return False
    with p.open('r+b') as f:
        f.seek(0)
        try:msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
        except OSError:return True
        f.seek(0);msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
        return False


def wait_stopped(timeout=120):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if not locked(ROOT) and not locked(ROOT/'gold-scalp-m1'):
            time.sleep(2)
            if not locked(ROOT) and not locked(ROOT/'gold-scalp-m1'):return
        time.sleep(1)
    raise RuntimeError('RECOVERY_WAIT_FOR_OLD_BRIDGE_TO_EXIT')


def original_launchers():
    """Find existing wrapper key files without revealing or changing tokens."""
    if os.name!='nt':return []
    command="Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^python(w)?\\.exe$' -and $_.CommandLine -match 'bridge_bootstrap\\.py'} | Select-Object -ExpandProperty CommandLine | ConvertTo-Json -Compress"
    r=subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,text=True,timeout=20)
    if r.returncode or not r.stdout.strip():return []
    raw=json.loads(r.stdout);lines=[raw] if isinstance(raw,str) else raw
    import ctypes
    from ctypes import wintypes
    fn=ctypes.windll.shell32.CommandLineToArgvW;fn.argtypes=[wintypes.LPCWSTR,ctypes.POINTER(ctypes.c_int)];fn.restype=ctypes.POINTER(wintypes.LPWSTR)
    result=[]
    for line in lines:
        count=ctypes.c_int();args=fn(line,ctypes.byref(count))
        if not args:continue
        try:values=[args[i] for i in range(count.value)]
        finally:
            ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p]
            ctypes.windll.kernel32.LocalFree(ctypes.cast(args,ctypes.c_void_p))
        for arg in values:
            p=Path(arg)
            if p.name.lower()!='bridge_bootstrap.py' or not p.is_absolute() or not p.is_file() or p.is_symlink():continue
            if sha(p.read_bytes())!=BOOTSTRAP_SHA:continue
            key=p.with_name('update_public_key.json')
            if key.is_file() and not key.is_symlink():
                try:old=json.loads(key.read_text())
                except (ValueError,OSError):continue
                if old in (OLD_KEY,NEW_KEY):result.append(key)
    return list(dict.fromkeys(result))


def stage_bootstrap():
    # The PowerShell handoff downloads and verifies both these files first.
    p=RECOVERY/'bridge_bootstrap.py'
    require(p.is_file() and sha(p.read_bytes())==BOOTSTRAP_SHA,'RECOVERY_BOOTSTRAP_HASH_MISMATCH')
    return module(p)


def start_supervisor(script):
    return subprocess.Popen([sys.executable,str(script),'run'],cwd=script.parent,
                            creationflags=getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0))


def main(ref):
    require(os.name=='nt','WINDOWS_REQUIRED')
    require(re.fullmatch(r'[0-9a-f]{40}',ref) is not None,'RECOVERY_IMMUTABLE_COMMIT_REQUIRED')
    before=critical_hashes(ROOT)
    require(not locked(ROOT/'backtests'),'RECOVERY_BACKTEST_RUNNING_WAIT_UNTIL_FINISHED')
    boot=stage_bootstrap()
    mailbox=boot.configure_mailbox(ROOT,RECOVERY)
    require(mailbox['repository']==REPO and mailbox['branch']=='olfx-mt5-bridge','RECOVERY_WRONG_BRIDGE')
    fetch=boot.GitHubReleases(ROOT,mailbox)
    raw=fetch.get(SOURCE_BASE+'release_1.0.16.json',ref)
    require(raw is not None and sha(raw)==RELEASE_SHA,'RECOVERY_RELEASE_HASH_MISMATCH')
    doc,_=boot.parse_release(raw,NEW_KEY)
    require(doc['payload']['version']==VERSION and doc['payload']['sequence']==16,'RECOVERY_WRONG_RELEASE')
    new_store=boot.ReleaseStore(ROOT,NEW_KEY)
    new_store.install(raw)
    folder,_=new_store.load(SLUG)
    sys.path.insert(0,str(folder))
    try:
        current=json.loads((ROOT/'current_runtime.json').read_text())
        snapshot=json.loads((ROOT/'gold-scalp-m1'/'health.json').read_text())
    except (OSError,ValueError):current={};snapshot={}
    if current.get('dir')==SLUG and snapshot.get('strategy')=='BREAKOUT_FAKEBREAKOUT_M1_TP1' and snapshot.get('target_r')==1.0 and snapshot.get('ready') and not snapshot.get('paused') and 0<=time.time()-snapshot.get('updated_at',0)<=10 and locked(ROOT) and locked(ROOT/'gold-scalp-m1'):
        print('YA INSTALADO: Breakout + Fake 1m | RR 1:1 | TP1.',flush=True)
        return 0
    import MetaTrader5 as mt5
    import gold_scalp_runner as runner
    import bridge_agent as api
    # Read-only broker preflight. Never switch accounts, send trades or close positions.
    try:
        engine=runner.connect(mt5,ROOT)
        positions=mt5.positions_get();orders=mt5.orders_get()
        require(positions is not None and orders is not None,'RECOVERY_MT5_STATE_UNAVAILABLE')
        require(not positions and not orders,'RECOVERY_WAIT_FOR_OPEN_TRADES_SL_TP')
    finally:mt5.shutdown()
    pointer=json.loads((ROOT/'current_runtime.json').read_text())
    old_slug=pointer.get('dir')
    old_store=boot.ReleaseStore(ROOT,OLD_KEY)
    if old_slug!=SLUG:old_folder,old_payload=old_store.load(old_slug)
    keys=original_launchers()
    backup=RECOVERY/'backups';backup.mkdir(parents=True,exist_ok=True)
    manifest=backup/'original.json'
    if not manifest.is_file():
        require(old_slug!=SLUG,'RECOVERY_ORIGINAL_BACKUP_REQUIRED')
        atomic(manifest,{'pointer':pointer,'configuration_hashes':before,'launch_keys':[str(p) for p in keys]})
        old_launcher=RECOVERY/'rollback';old_launcher.mkdir(exist_ok=True)
        (old_launcher/'bridge_bootstrap.py').write_bytes((RECOVERY/'bridge_bootstrap.py').read_bytes())
        atomic(old_launcher/'update_public_key.json',OLD_KEY)
        (old_launcher/'bundled_release.json').write_bytes((old_folder/'signed_release.json').read_bytes())
    saved=json.loads(manifest.read_text())
    print('OLFX: paquete firmado verificado. Deteniendo entradas anteriores sin cerrar operaciones.',flush=True)
    (ROOT/'gold-scalp-m1'/'STOP').touch();(ROOT/'STOP').touch()
    wait_stopped()
    original_keys={str(p):json.loads(p.read_text()) for p in keys}
    new_process=None
    try:
        atomic(RECOVERY/'update_public_key.json',NEW_KEY)
        (RECOVERY/'bundled_release.json').write_bytes(raw)
        new_store.activate(SLUG)
        for p in keys:
            b=backup/(sha(str(p).encode())+'.public-key.json')
            if not b.exists():atomic(b,original_keys[str(p)])
            atomic(p,NEW_KEY)
        cmd='@echo off\r\nchcp 65001>nul\r\n"'+sys.executable+'" "'+str(RECOVERY/'bridge_bootstrap.py')+'" run\r\npause\r\n'
        (ROOT/'INICIAR_BRIDGE_ACTUAL.cmd').write_text(cmd,encoding='utf-8')
        (ROOT/'STOP').unlink(missing_ok=True)
        new_process=start_supervisor(RECOVERY/'bridge_bootstrap.py')
        end=time.monotonic()+45
        while time.monotonic()<end:
            p=ROOT/'update_status.json'
            try:health=json.loads(p.read_text())
            except (OSError,ValueError):health={}
            if health.get('state')=='running' and health.get('version')==VERSION and locked(ROOT):break
            require(new_process.poll() is None,'RECOVERY_NEW_BRIDGE_START_FAILED')
            time.sleep(.5)
        else:raise RuntimeError('RECOVERY_NEW_BRIDGE_HEALTH_TIMEOUT')
        from gold_scalp import start
        job={'id':'owner-recovery-'+uuid.uuid4().hex[:16]}
        status=start(job,ROOT,api)
        require(status.get('strategy')=='BREAKOUT_FAKEBREAKOUT_M1_TP1' and status.get('period')=='M1'
                and status.get('target_r')==1.0 and status.get('ready') and not status.get('paused'), 'RECOVERY_NEW_STRATEGY_NOT_CONFIRMED')
        require(critical_hashes(ROOT)==before,'RECOVERY_CONFIGURATION_CHANGED_ABORT')
        api.GitHub(boot.decrypt_token(ROOT/'token.dpapi')).put('bridge/status/'+mailbox['device']+'.json',api.status_snapshot(ROOT,'online'))
        atomic(RECOVERY/'installed.json',{'version':VERSION,'strategy':status['strategy'],'period':'M1','rr':1.0,'installed_at':time.time(),'source_ref':ref})
        print('INSTALADO: BREAKOUT + FAKE BREAKOUT 1m | RR 1:1 | cierre completo en TP1.',flush=True)
        print('Configuracion, cuenta, lotaje y token conservados. Deja esta ventana abierta.',flush=True)
        print('Para un proximo reinicio usa: '+str(ROOT/'INICIAR_BRIDGE_ACTUAL.cmd'),flush=True)
        return new_process.wait()
    except Exception:
        (ROOT/'gold-scalp-m1'/'STOP').touch();(ROOT/'STOP').touch()
        try:wait_stopped()
        except RuntimeError:
            # Never force-kill an active trading worker or alter open positions.
            print('RECUPERACION PAUSADA: deja MT5 abierto para SL/TP y revisa el bridge.',flush=True)
            raise
        atomic(ROOT/'current_runtime.json',saved['pointer'])
        for text in original_keys:atomic(Path(text),OLD_KEY)
        (ROOT/'STOP').unlink(missing_ok=True)
        rollback_script=RECOVERY/'rollback'/'bridge_bootstrap.py'
        rollback_cmd='@echo off\r\nchcp 65001>nul\r\n"'+sys.executable+'" "'+str(rollback_script)+'" run\r\npause\r\n'
        (ROOT/'INICIAR_BRIDGE_ACTUAL.cmd').write_text(rollback_cmd,encoding='utf-8')
        start_supervisor(rollback_script)
        print('Restaurado el bridge anterior; estrategia anterior permanece pausada.',flush=True)
        raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--ref',required=True);args=parser.parse_args()
    try:sys.exit(main(args.ref) or 0)
    except KeyboardInterrupt:
        if ROOT.is_dir():(ROOT/'STOP').touch()
        if (ROOT/'gold-scalp-m1').is_dir():(ROOT/'gold-scalp-m1'/'STOP').touch()
        print('Parada solicitada sin cierres forzosos. Deja MT5 abierto para SL/TP.',flush=True);sys.exit(130)
    except Exception as error:
        print('RECOVERY ERROR: '+(str(error) if isinstance(error,RuntimeError) else type(error).__name__),flush=True)
        sys.exit(1)
