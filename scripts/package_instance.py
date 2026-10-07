#!/usr/bin/env python3
"""Package one generated application; never include business data or runtime secrets."""
from pathlib import Path, PurePosixPath
import argparse, json, shutil, zipfile, hashlib
BLOCK={'data','uploads','node_modules','.npm-cache','.cache','.venv','test-evidence','.preview-build','.frontend-test-build','.git','__pycache__'}
def main():
 p=argparse.ArgumentParser(description='打包生成实例、物料和可选只读输入快照，排除业务数据。')
 p.add_argument('--instance',type=Path,required=True);p.add_argument('--destination',type=Path,required=True);p.add_argument('--input',type=Path);p.add_argument('--zip',type=Path);a=p.parse_args();app=a.instance.resolve();dest=a.destination.absolute()
 if dest.is_symlink() or (dest.exists() and (not dest.is_dir() or any(dest.iterdir()))):p.error('交付目录必须不存在或为空')
 if dest==app or app in dest.parents:p.error('交付目录不得位于实例内')
 try:m=json.loads((app/'manifest.json').read_text(encoding='utf-8'))
 except (OSError,ValueError):p.error('需要有效生成器manifest.json')
 if m.get('generator')!='canonical-xlsx-event-template':p.error('目录不是本生成器的实例')
 entries=set(m.get('artifacts',[]))|{'manifest.json'}
 for folder in ['dist','offline-preview']:
  if (app/folder).is_dir():entries.update(f.relative_to(app).as_posix() for f in (app/folder).rglob('*') if f.is_file())
 selected=[]
 for n in sorted(entries):
  r=PurePosixPath(n)
  if r.is_absolute() or '..' in r.parts:p.error('manifest含不安全路径')
  if any(x in BLOCK for x in r.parts) or (r.name.startswith('.env') and r.name!='.env.example') or r.suffix in {'.log','.zip'}:continue
  f=app/Path(*r.parts)
  if f.is_symlink() or not f.is_file():p.error(f'实例产物缺失或不允许符号链接: {n}')
  selected.append((f,Path(*r.parts)))
 snapshot=[]
 if a.input:
  import generate
  cfg,assets=generate.load_config(a.input)
  if cfg['event']['slug']!=m['eventSlug']:p.error('输入工作簿不是此实例活动')
  if cfg['source']['workbookSha256']!=m['workbookSha256']:p.error('输入已改变，请先重新生成后再打包')
  derived=(json.dumps(cfg,ensure_ascii=False,indent=2,sort_keys=True)+'\n').encode('utf8')
  if hashlib.sha256(derived).hexdigest()!=m.get('configSha256'):p.error('派生配置或横幅绑定已改变，请先重新生成后再打包')
  for url,data in assets.items():
   if hashlib.sha256(data).hexdigest()!=m.get('sha256',{}).get('frontend/public/'+url):p.error('公共素材已改变，请先重新生成后再打包')
  snapshot=[(Path('source-input/event.xlsx'),a.input.read_bytes())]
  from hero_binding import binding_path
  hero_source=cfg['branding'].get('heroSourceImage')
  if hero_source:
   metadata=binding_path(a.input,hero_source)
   if metadata.is_file() and not metadata.is_symlink():snapshot.append((Path('source-input')/(hero_source.removeprefix('/assets/')+'.facts.json'),metadata.read_bytes()))
  for url in assets:
   # Include only assets named in the canonical workbook; preserve original relative paths.
   relative=url.removeprefix('assets/');snapshot.append((Path('source-input')/relative,assets[url]))
 dest.mkdir(parents=True,exist_ok=True)
 for f,r in selected:
  d=dest/r;d.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,d);d.chmod(0o644)
 for r,data in snapshot:
  d=dest/r;d.parent.mkdir(parents=True,exist_ok=True);d.write_bytes(data);d.chmod(0o644)
 if snapshot:(dest/'source-input/README.md').write_text('这是当前实例生成时的只读事实快照，用于追溯。后续编辑仍以负责人指定的唯一原XLSX为准；重新生成必须使用模板包的脚本，不能让两份XLSX同时成为活动内容源。\n',encoding='utf-8')
 if a.zip:
  a.zip.parent.mkdir(parents=True,exist_ok=True)
  with zipfile.ZipFile(a.zip,'w',zipfile.ZIP_DEFLATED) as z:
   for f in sorted(dest.rglob('*')):
    if f.is_file() and f.resolve()!=a.zip.resolve():z.write(f,f.relative_to(dest).as_posix())
 print(f'已打包实例：{dest}（无数据库、用户附件或运行时.env）');return 0
if __name__=='__main__':raise SystemExit(main())
