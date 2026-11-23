"""Prepare isolated Python environment and retain readable startup errors."""
import os
from pathlib import Path
import struct
import subprocess
import sys

ROOT=Path(__file__).resolve().parent

def main():
    if os.name!='nt' or sys.version_info[:2]!=(3,12) or struct.calcsize('P')!=8:
        raise RuntimeError('Requiere Windows y Python 3.12 de 64 bits con pip/venv.')
    env=ROOT/'.venv'
    py=env/'Scripts'/'python.exe'
    if not py.exists():
        subprocess.run([sys.executable,'-m','venv',str(env)],check=True)
    probe=subprocess.run([str(py),'-c',"import MetaTrader5,numpy,tzdata; from zoneinfo import ZoneInfo; ZoneInfo('America/New_York')"])
    if probe.returncode:
        subprocess.run([str(py),'-m','pip','install','--only-binary=:all:','--timeout','30','--retries','2','-r',str(ROOT/'requirements.txt')],check=True)
    return subprocess.call([str(py),'-u',str(ROOT/'simple_ui.py'),*sys.argv[1:]],cwd=ROOT)

if __name__=='__main__':
    try: sys.exit(main())
    except Exception as e:
        print('\nERROR:',e)
        sys.exit(1)
