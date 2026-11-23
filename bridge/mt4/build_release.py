"""Build a launcher-compatible release using the configured private signing key.

Never accepts a replacement trust root or changes the installed launcher/channel.
Run locally: python build_release.py --key /private/path/key.pem --output release.json
Requires cryptography in the build environment only; runtime is stdlib-only.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile

ROOT=Path(__file__).resolve().parent

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()

def pack_runtime():
    files={};archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted((ROOT/'runtime').rglob('*')):
            if not p.is_file() or p.suffix not in ('.py','.mq5') or '__pycache__' in p.parts:continue
            name=p.relative_to(ROOT/'runtime').as_posix();raw=p.read_bytes()
            files[name]={'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
            info=zipfile.ZipInfo(name,date_time=(2026,11,17,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            z.writestr(info,raw)
    return archive.getvalue(), files

def build(key_path,public_key_path):
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import padding,rsa
    key=serialization.load_pem_private_key(Path(key_path).read_bytes(),password=None)
    if not isinstance(key,rsa.RSAPrivateKey):raise ValueError('RSA_KEY_REQUIRED')
    expected=json.loads(Path(public_key_path).read_text())
    pub=key.public_key().public_numbers()
    if pub.n!=int(expected['n'],16) or pub.e!=expected['e']:
        raise ValueError('KEY_DOES_NOT_MATCH_SELECTED_PUBLIC_KEY')
    raw, files = pack_runtime()
    payload=dict(schema=1,sequence=40,version='1.0.40',launcher=1,session_schema=1,
                 archive=base64.b64encode(raw).decode(),archive_sha256=hashlib.sha256(raw).hexdigest(),files=files)
    signature=key.sign(canonical(payload),padding.PKCS1v15(),hashes.SHA256())
    return canonical(dict(payload=payload,signature=base64.b64encode(signature).decode()))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--key',required=True);p.add_argument('--output',required=True)
    p.add_argument('--public-key',default=str(ROOT.parents[0]/'original'/'update_public_key.json'))
    args=p.parse_args()
    result=build(args.key,args.public_key)
    Path(args.output).write_bytes(result)
    print('Signed release built; channel has not been changed.')


