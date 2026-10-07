#!/usr/bin/env python3
"""Create a fresh, portable source deliverable without credentials or business data."""
from pathlib import Path
import argparse, shutil, zipfile
ROOT=Path(__file__).resolve().parents[1]
BLOCK={'vendor','node_modules','.npm-cache','.cache','.venv','.venv-validate','data','uploads','dist','generated','preview','offline-preview','source-pages','workbook-previews','__pycache__','.git','.agents','.codex','.aws','.pytest_cache','.preview-build','.page-test-build','.frontend-test-build','test-evidence'}
def main():
 p=argparse.ArgumentParser(description='创建新的独立模板交付目录，排除秘密和业务数据。');p.add_argument('--destination',type=Path,required=True);p.add_argument('--zip',type=Path);a=p.parse_args();d=a.destination.absolute()
 if d.is_symlink() or (d.exists() and (not d.is_dir() or any(d.iterdir()))):p.error('交付目录必须不存在或为空，不覆盖已有目录')
 d=d.resolve()
 if ROOT==d or ROOT in d.parents:p.error('交付目录不得位于本模板源目录内')
 d.mkdir(parents=True,exist_ok=True)
 for name in ['.gitignore','.gitattributes','SKILL.md','README.md','requirements.txt','docs','scripts','input','tests','template']:
  source=ROOT/name
  paths=[source] if source.is_file() else source.rglob('*')
  for f in paths:
   if not f.is_file() or f.is_symlink():continue
   r=f.relative_to(ROOT)
   if any(x in BLOCK for x in r.parts) or (f.name.startswith('.env') and f.name!='.env.example') or f.suffix in {'.log','.zip'}:continue
   if f.name=='FIRST_LOOK.md' or f.name=='package_firstlook.py':continue
   target=d/r;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target);target.chmod(0o644)
 if a.zip:
  a.zip.parent.mkdir(parents=True,exist_ok=True)
  with zipfile.ZipFile(a.zip,'w',zipfile.ZIP_DEFLATED) as z:
   for f in sorted(d.rglob('*')):
    if f.is_file() and f.resolve()!=a.zip.resolve():z.write(f,f.relative_to(d).as_posix())
 print(f'已创建独立交付：{d}')
 return 0
if __name__=='__main__':raise SystemExit(main())
