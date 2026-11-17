"""Stable Windows launcher: verify signed releases, stage, hand off, roll back.
No credentials or account data are included in published runtime archives.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes
import hashlib
import hmac
import io
import json
import os
from pathlib import Path,PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

ROOT=Path(os.environ.get('LOCALAPPDATA',str(Path.home())))/'OLFX_MT5_BRIDGE'
HERE=Path(__file__).resolve().parent
MAX_RELEASE=2*1024*1024
MAX_UNPACKED=4*1024*1024
DIGEST_INFO=bytes.fromhex('3031300d060960864801650304020105000420')

class UpdateError(Exception):pass

def require(ok,code):
    if not ok:raise UpdateError(code)

def atomic_json(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.tmp')
    tmp.write_text(json.dumps(data,sort_keys=True,indent=2),encoding='utf-8');os.replace(tmp,path)

def canonical(data):
    return json.dumps(data,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()

def verify_signature(payload,signature,key):
    try:
        n=int(key['n'],16);e=key['e'];width=(n.bit_length()+7)//8
        sig=base64.b64decode(signature,validate=True)
        require(n.bit_length()>=2048 and e==65537 and len(sig)==width,'UPDATE_SIGNATURE_INVALID')
        integer=int.from_bytes(sig,'big');require(0<integer<n,'UPDATE_SIGNATURE_INVALID')
        decoded=pow(integer,e,n).to_bytes(width,'big')
        digest=DIGEST_INFO+hashlib.sha256(canonical(payload)).digest()
        expected=b'\x00\x01'+b'\xff'*(width-len(digest)-3)+b'\x00'+digest
        require(hmac.compare_digest(decoded,expected),'UPDATE_SIGNATURE_INVALID')
    except (KeyError,ValueError,TypeError,OverflowError):
        raise UpdateError('UPDATE_SIGNATURE_INVALID') from None

def safe_member(name):
    require(isinstance(name,str) and 0<len(name)<=120 and '\\' not in name and ':' not in name,'UPDATE_PATH_INVALID')
    path=PurePosixPath(name)
    require(not path.is_absolute() and str(path)==name and all(p not in ('.','..') and re.fullmatch(r'[A-Za-z0-9_.-]+',p) for p in path.parts),'UPDATE_PATH_INVALID')
    require(path.suffix in ('.py','.mq5') and name not in ('bridge_bootstrap.py','settings.json','token.dpapi'),'UPDATE_PATH_INVALID')
    for part in path.parts:
        require(not re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',part) and not part.endswith(('.', ' ')),'UPDATE_PATH_INVALID')
    return name

def parse_release(raw,key):
    require(isinstance(raw,bytes) and len(raw)<=MAX_RELEASE,'UPDATE_TOO_LARGE')
    try:
        doc=json.loads(raw)
        require(isinstance(doc,dict) and set(doc)=={'payload','signature'},'UPDATE_FORMAT_INVALID')
        payload=doc['payload'];require(isinstance(payload,dict),'UPDATE_FORMAT_INVALID')
        verify_signature(payload,doc['signature'],key)
        require(set(payload)=={'schema','sequence','version','launcher','session_schema','archive','archive_sha256','files'},'UPDATE_FORMAT_INVALID')
        require(payload['schema']==1 and type(payload['schema']) is int and payload['launcher']==1 and payload['session_schema']==1,'UPDATE_NOT_COMPATIBLE')
        require(type(payload['sequence']) is int and 0<payload['sequence']<1000000,'UPDATE_SEQUENCE_INVALID')
        require(isinstance(payload['version'],str) and re.fullmatch(r'\d{1,3}\.\d{1,3}\.\d{1,3}',payload['version']),'UPDATE_VERSION_INVALID')
        files=payload['files'];require(isinstance(files,dict) and 1<=len(files)<=80 and 'bridge_agent.py' in files and 'update_handoff.py' in files,'UPDATE_FILES_INVALID')
        for name,record in files.items():
            safe_member(name)
            require(isinstance(record,dict) and set(record)=={'sha256','size'} and type(record['size']) is int and 0<=record['size']<=1024*1024 and re.fullmatch(r'[0-9a-f]{64}',str(record['sha256'])),'UPDATE_FILES_INVALID')
        require(sum(r['size'] for r in files.values())<=MAX_UNPACKED,'UPDATE_TOO_LARGE')
        archive=base64.b64decode(payload['archive'],validate=True)
        require(hashlib.sha256(archive).hexdigest()==payload['archive_sha256'],'UPDATE_HASH_INVALID')
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            members=z.infolist();names=[m.filename for m in members]
            require(len(names)==len(set(names)) and set(names)==set(files),'UPDATE_FILES_INVALID')
            for m in members:
                safe_member(m.filename)
                require(not m.is_dir() and not stat.S_ISLNK(m.external_attr>>16) and m.file_size==files[m.filename]['size'],'UPDATE_FILES_INVALID')
                require(hashlib.sha256(z.read(m)).hexdigest()==files[m.filename]['sha256'],'UPDATE_HASH_INVALID')
        return doc,archive
    except (ValueError,KeyError,TypeError,zipfile.BadZipFile,RuntimeError):
        raise UpdateError('UPDATE_FORMAT_INVALID') from None

def release_slug(payload):return '%06d-%s'%(payload['sequence'],payload['version'])

class ReleaseStore:
    def __init__(self,root,key):
        self.root=Path(root);self.key=key;self.versions=self.root/'versions';self.versions.mkdir(parents=True,exist_ok=True)
    def load(self,slug):
        require(isinstance(slug,str) and re.fullmatch(r'\d{6}-\d{1,3}\.\d{1,3}\.\d{1,3}',slug),'UPDATE_POINTER_INVALID')
        folder=self.versions/slug;require(folder.resolve().parent==self.versions.resolve() and not folder.is_symlink(),'UPDATE_PATH_INVALID')
        raw=(folder/'signed_release.json').read_bytes();doc,_=parse_release(raw,self.key)
        require(slug==release_slug(doc['payload']),'UPDATE_POINTER_INVALID')
        for name,r in doc['payload']['files'].items():
            target=folder/name
            require(target.resolve().is_relative_to(folder.resolve()) and not target.is_symlink(),'UPDATE_PATH_INVALID')
            require(target.is_file() and target.stat().st_size==r['size'] and hashlib.sha256(target.read_bytes()).hexdigest()==r['sha256'],'UPDATE_INSTALLED_HASH_INVALID')
        # New executable imports not in the signed release must not shadow modules.
        observed={str(p.relative_to(folder)).replace(os.sep,'/') for p in folder.rglob('*') if p.is_file() and p.suffix in ('.py','.mq5') and '__pycache__' not in p.parts}
        require(observed==set(doc['payload']['files']),'UPDATE_FILES_INVALID')
        return folder,doc['payload']
    def install(self,raw):
        doc,archive=parse_release(raw,self.key);slug=release_slug(doc['payload']);target=self.versions/slug
        if target.exists():self.load(slug);return slug
        staging=Path(tempfile.mkdtemp(prefix='.stage-',dir=self.versions))
        try:
            with zipfile.ZipFile(io.BytesIO(archive)) as z:
                for m in z.infolist():
                    dest=staging/m.filename;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(m))
            (staging/'signed_release.json').write_bytes(raw);staging.rename(target)
            self.load(slug);return slug
        finally:
            if staging.exists():shutil.rmtree(staging)
    def current(self):
        pointer=json.loads((self.root/'current_runtime.json').read_text(encoding='utf-8'))
        require(isinstance(pointer,dict) and set(pointer)=={'dir'},'UPDATE_POINTER_INVALID')
        self.load(pointer['dir']);return pointer['dir']
    def activate(self,slug):
        self.load(slug);atomic_json(self.root/'current_runtime.json',{'dir':slug})
    def failed(self,sequence):
        try:data=json.loads((self.root/'failed_update.json').read_text(encoding='utf-8'))
        except (OSError,ValueError):return False
        return data.get('sequence')==sequence

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):raise UpdateError('UPDATE_REDIRECT_BLOCKED')

def decrypt_token(path):
    require(os.name=='nt','WINDOWS_REQUIRED')
    class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_byte))]
    raw=Path(path).read_bytes();buf=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_byte)));target=Blob()
    fn=ctypes.windll.crypt32.CryptUnprotectData
    fn.argtypes=[ctypes.POINTER(Blob),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
    fn.restype=wintypes.BOOL
    require(fn(ctypes.byref(source),None,None,None,None,1,ctypes.byref(target)),'UPDATE_TOKEN_UNAVAILABLE')
    try:return ctypes.string_at(target.data,target.size).decode()
    finally:
        ctypes.windll.kernel32.LocalFree.argtypes=[ctypes.c_void_p];ctypes.windll.kernel32.LocalFree(ctypes.cast(target.data,ctypes.c_void_p))

class GitHubReleases:
    def __init__(self,root,mailbox):self.root=Path(root);self.mailbox=mailbox
    def get(self,path,ref):
        token=decrypt_token(self.root/'token.dpapi')
        repo=self.mailbox['repository']
        req=urllib.request.Request('https://api.github.com/repos/'+repo+'/contents/'+urllib.parse.quote(path,safe='/')+'?ref='+urllib.parse.quote(ref,safe=''),headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'OLFX-Update-Launcher/1'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req,timeout=15) as response:raw=response.read(3*MAX_RELEASE)
        except urllib.error.HTTPError as exc:
            if exc.code==404:return None
            raise UpdateError('UPDATE_NETWORK_UNAVAILABLE') from None
        except (urllib.error.URLError,OSError):raise UpdateError('UPDATE_NETWORK_UNAVAILABLE') from None
        require(len(raw)<3*MAX_RELEASE,'UPDATE_TOO_LARGE');data=json.loads(raw)
        require(isinstance(data,dict) and data.get('encoding')=='base64','UPDATE_FORMAT_INVALID')
        return base64.b64decode(data['content'])
    def latest(self):
        raw=self.get('bridge/updates/channel.json',self.mailbox['branch'])
        if raw is None:return None
        require(len(raw)<4096,'UPDATE_CHANNEL_INVALID');channel=json.loads(raw)
        require(isinstance(channel,dict) and set(channel)=={'schema','path','ref','sha256'} and channel['schema']==1,'UPDATE_CHANNEL_INVALID')
        require(isinstance(channel['path'],str) and re.fullmatch(r'bridge/updates/releases/\d{1,3}\.\d{1,3}\.\d{1,3}\.json',channel['path']) and re.fullmatch(r'[0-9a-f]{40}',str(channel['ref'])) and re.fullmatch(r'[0-9a-f]{64}',str(channel['sha256'])),'UPDATE_CHANNEL_INVALID')
        release=self.get(channel['path'],channel['ref']);require(release is not None and hashlib.sha256(release).hexdigest()==channel['sha256'],'UPDATE_HASH_INVALID')
        return release

def configure_mailbox(root,here):
    root=Path(root);root.mkdir(parents=True,exist_ok=True);path=root/'mailbox.json'
    data=json.loads((path if path.exists() else Path(here)/'bootstrap_config.json').read_text(encoding='utf-8'))
    require(isinstance(data,dict) and set(data)=={'repository','branch','device'},'UPDATE_MAILBOX_INVALID')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',str(data['repository'])) and re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',str(data['branch'])) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}',str(data['device'])),'UPDATE_MAILBOX_INVALID')
    if not path.exists():atomic_json(path,data)
    return data

def healthy(root,nonce,version):
    try:data=json.loads((Path(root)/'agent_health.json').read_text(encoding='utf-8'))
    except (OSError,ValueError):return False
    return data=={'nonce':nonce,'version':version}

class Supervisor:
    def __init__(self,store,fetch_latest,check_seconds=60,health_seconds=20):
        self.store=store;self.root=store.root;self.fetch_latest=fetch_latest;self.check_seconds=check_seconds;self.health_seconds=health_seconds
    def run(self):
        current=self.store.current();trial_previous=None;pending=None;next_check=0
        while True:
            folder,payload=self.store.load(current);nonce=uuid.uuid4().hex
            (self.root/'update_pending.json').unlink(missing_ok=True)
            env=dict(os.environ,OLFX_BRIDGE_LAUNCH_NONCE=nonce)
            process=subprocess.Popen([sys.executable,str(folder/'bridge_agent.py'),'run'],cwd=folder,env=env)
            started=time.monotonic();ready=False
            try:
                while process.poll() is None:
                    was_ready=ready
                    ready=ready or healthy(self.root,nonce,payload['version'])
                    if ready and not was_ready:
                        atomic_json(self.root/'update_status.json',{'state':'running','version':payload['version']})
                    if not ready and time.monotonic()-started>self.health_seconds:
                        process.terminate();process.wait(timeout=10);break
                    if ready and time.monotonic()>=next_check and pending is None:
                        next_check=time.monotonic()+self.check_seconds
                        try:
                            raw=self.fetch_latest()
                            if raw:
                                doc,_=parse_release(raw,self.store.key);new=doc['payload']
                                require(new['sequence']>=payload['sequence'],'UPDATE_DOWNGRADE_BLOCKED')
                                if new['sequence']==payload['sequence']:
                                    require(new==payload,'UPDATE_SEQUENCE_REUSED')
                                elif not self.store.failed(new['sequence']):
                                    pending=self.store.install(raw)
                                    atomic_json(self.root/'update_pending.json',{'nonce':nonce,'sequence':new['sequence']})
                                    print('OLFX: actualizacion verificada; esperando fin de la tarea actual.',flush=True)
                        except (UpdateError,OSError,ValueError,KeyError):
                            atomic_json(self.root/'update_status.json',{'state':'download_rejected_or_unavailable','current_version':payload['version']})
                    time.sleep(0.2)
            except KeyboardInterrupt:
                (self.root/'STOP').touch()
                try:
                    subprocess.run([sys.executable,str(folder/'bridge_agent.py'),'stop'],cwd=folder,timeout=20)
                except (OSError,subprocess.TimeoutExpired,KeyboardInterrupt):pass
                print('OLFX: parada solicitada; esperando al Bridge.',flush=True)
                while process.poll() is None:
                    try:process.wait(timeout=1)
                    except (subprocess.TimeoutExpired,KeyboardInterrupt):pass
                return 130
            code=process.returncode
            ready=ready or healthy(self.root,nonce,payload['version'])
            if not ready and trial_previous:
                atomic_json(self.root/'failed_update.json',{'sequence':payload['sequence'],'code':'ENGINE_STARTUP_FAILED'})
                self.store.activate(trial_previous);current=trial_previous;trial_previous=None;pending=None
                atomic_json(self.root/'update_status.json',{'state':'rolled_back'})
                print('OLFX: fallo el arranque; restaurada la version anterior.',flush=True)
                continue
            if code==75 and pending:
                if (self.root/'STOP').exists():
                    try:subprocess.run([sys.executable,str(folder/'bridge_agent.py'),'stop'],cwd=folder,timeout=20)
                    except (OSError,subprocess.TimeoutExpired):pass
                    return 0
                previous=current;self.store.activate(pending);current=pending;pending=None;trial_previous=previous
                atomic_json(self.root/'update_status.json',{'state':'restarting','version':self.store.load(current)[1]['version']})
                continue
            if ready:atomic_json(self.root/'update_status.json',{'state':'engine_stopped','version':payload['version']})
            return code if code is not None else 1

def main():
    parser=argparse.ArgumentParser();parser.add_argument('mode');args=parser.parse_args()
    require(os.name=='nt','WINDOWS_REQUIRED')
    mailbox=configure_mailbox(ROOT,HERE);key=json.loads((HERE/'update_public_key.json').read_text(encoding='utf-8'));store=ReleaseStore(ROOT,key)
    if not (ROOT/'current_runtime.json').is_file():
        initial=store.install((HERE/'bundled_release.json').read_bytes());store.activate(initial)
    else:store.current()
    if args.mode=='run':
        print('OLFX: actualizaciones verificadas automaticamente; conserva esta ventana abierta.',flush=True)
        return Supervisor(store,GitHubReleases(ROOT,mailbox).latest).run()
    folder,_=store.load(store.current())
    return subprocess.call([sys.executable,str(folder/'bridge_agent.py'),args.mode],cwd=folder)

if __name__=='__main__':
    try:sys.exit(main() or 0)
    except KeyboardInterrupt:
        (ROOT/'STOP').touch()
        print('OLFX: parada solicitada.',flush=True);sys.exit(130)
    except (UpdateError,OSError,ValueError,KeyError):
        print('ERROR: no se pudo verificar o iniciar el Bridge. No se aplico codigo sin verificar.',flush=True);sys.exit(1)

