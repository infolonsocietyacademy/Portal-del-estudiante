import base64
import hashlib
import io
import json
from pathlib import Path
import zipfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).resolve().parent
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def build(runtime, key_path, public_path):
    key = serialization.load_pem_private_key(Path(key_path).read_bytes(), password=None)
    expected = json.loads(Path(public_path).read_text())
    pub = key.public_key().public_numbers()
    if pub.n != int(expected['n'], 16) or pub.e != expected['e']:
        raise ValueError('KEY_DOES_NOT_MATCH_TRUSTED_PUBLIC_KEY')
    files = {}; archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(Path(runtime).rglob('*')):
            if not path.is_file() or path.suffix not in ('.py', '.mq5') or '__pycache__' in path.parts:
                continue
            name = path.relative_to(runtime).as_posix(); raw = path.read_bytes()
            files[name] = dict(size=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            zipped.writestr(info, raw)
    data = archive.getvalue()
    payload = dict(schema=1, sequence=31, version='1.0.31', launcher=1, session_schema=1,
                   archive=base64.b64encode(data).decode(), archive_sha256=hashlib.sha256(data).hexdigest(), files=files)
    signature = key.sign(canonical(payload), padding.PKCS1v15(), hashes.SHA256())
    key.public_key().verify(signature, canonical(payload), padding.PKCS1v15(), hashes.SHA256())
    return canonical(dict(payload=payload, signature=base64.b64encode(signature).decode()))

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--key', required=True)
    parser.add_argument('--public-key', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = build(Path(args.runtime), args.key, args.public_key)
    Path(args.output).write_bytes(raw)
    print(json.dumps(dict(version='1.0.31', sha256=hashlib.sha256(raw).hexdigest(), size=len(raw))))
