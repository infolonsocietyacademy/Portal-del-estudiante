"""Build a manual-download ZIP and optionally publish only to the downloads branch."""
import argparse
import base64
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parent
NAME="OLFX_PANEL_ORDENES_DEMO_Windows_2.0.1-rc1_instalador2_con_carpeta.zip"
PACKAGE_FOLDER="OLFX_PANEL_ORDENES/"
FILES=["AGREGAR_PANEL.cmd","PANEL_ORDENES.cmd","install_panel.py","panel_client.py","panel_local.py","LEEME_PRIMERO.txt",
       "runtime/resident_core.py","runtime/resident_worker.py","runtime/legacy/bridge_agent.py","runtime/legacy/gold_settings.py",
       "tests/test_panel.py","tests/test_resident.py","tests/test_installer.py"]

def build(output):
    content={name:(ROOT/name).read_bytes() for name in FILES}
    manifest={"schema":1,"version":"2.0.1-rc1","installer_revision":2,"files":{name:hashlib.sha256(data).hexdigest() for name,data in content.items()}}
    content["manifest.json"]=(json.dumps(manifest,indent=2)+"\n").encode()
    path=Path(output)/NAME
    path.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(path,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        directory=zipfile.ZipInfo(PACKAGE_FOLDER,date_time=(2026,11,16,0,0,0))
        directory.external_attr=(0o40755 << 16) | 0x10
        archive.writestr(directory,b"")
        for name,data in sorted(content.items()):
            info=zipfile.ZipInfo(PACKAGE_FOLDER+name,date_time=(2026,11,16,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644 << 16
            archive.writestr(info,data)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        assert PACKAGE_FOLDER in archive.namelist()
        assert all(name.startswith(PACKAGE_FOLDER) for name in archive.namelist())
        assert json.loads(archive.read(PACKAGE_FOLDER+"manifest.json"))==manifest
        for name,expected in manifest["files"].items():
            assert hashlib.sha256(archive.read(PACKAGE_FOLDER+name)).hexdigest()==expected,name
    return path

def publish(path):
    repo=os.environ["GITHUB_REPOSITORY"]
    token=os.environ["GITHUB_TOKEN"]
    branch="olfx-bridge-resident-download"
    base="https://api.github.com/repos/"+repo
    def request(method,endpoint,payload=None):
        req=urllib.request.Request(base+endpoint,data=json.dumps(payload).encode() if payload is not None else None,
            method=method,headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json","User-Agent":"OLFX-Panel-Packager"})
        try:
            with urllib.request.urlopen(req,timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code==404:
                return None
            raise RuntimeError("GitHub publish HTTP "+str(exc.code)) from None
    def put(name,data):
        endpoint="/contents/"+urllib.parse.quote(name,safe="/")
        old=request("GET",endpoint+"?ref="+urllib.parse.quote(branch,safe=""))
        payload={"branch":branch,"message":"Package local DEMO panel: "+name,"content":base64.b64encode(data).decode()}
        if old:
            if base64.b64decode(old["content"])==data:
                return
            payload["sha"]=old["sha"]
        if request("PUT",endpoint,payload) is None:
            raise RuntimeError("Package publication not confirmed")
    data=path.read_bytes()
    checksum=hashlib.sha256(data).hexdigest()
    put(path.name,data)
    put(path.name+".sha256",(checksum+"  "+path.name+"\n").encode())
    info={"schema":1,"version":"2.0.1-rc1","installer_revision":2,"package_folder":PACKAGE_FOLDER.rstrip("/"),"zip_path":path.name,"zip_sha256":checksum,"size":len(data),
          "source_commit":os.environ.get("GITHUB_SHA"),"ci_run_url":"https://github.com/"+repo+"/actions/runs/"+os.environ.get("GITHUB_RUN_ID",""),
          "validation":"Linux and Windows offline tests passed; VPS integration pending installation",
          "download_url":"https://github.com/"+repo+"/raw/"+branch+"/"+path.name}
    put("panel-install-latest.json",(json.dumps(info,indent=2)+"\n").encode())
    print(json.dumps({"package":path.name,"sha256":checksum,"bytes":len(data)}))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",default="dist")
    parser.add_argument("--publish",action="store_true")
    args=parser.parse_args()
    archive=build(args.output)
    if args.publish:
        publish(archive)
    else:
        print(archive)
