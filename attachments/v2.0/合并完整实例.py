from pathlib import Path
import hashlib

base = Path(__file__).resolve().parent
name = "磐石手册生成实例-v2.0.zip"
parts = [base / (name + f".part{i:02d}") for i in range(1, 5)]
data = b"".join(p.read_bytes() for p in parts)
expected = "ab0af59b56925a33e1704b03f741d9c8ab3bc2849b399222477fe7494ae5bbc0"
if hashlib.sha256(data).hexdigest() != expected:
    raise SystemExit("校验失败，请确认四个分卷下载完整。")
output = base / name
output.write_bytes(data)
print("已合并并通过 SHA256 校验：", output)
