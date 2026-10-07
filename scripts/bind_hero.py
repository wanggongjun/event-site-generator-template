#!/usr/bin/env python3
"""Record reviewed supplied hero applicability as hashes; never alters its bytes."""
from pathlib import Path
import argparse,json,sys
from generate import load_config,ConfigError
from hero_binding import binding_payload,binding_path

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('workbook',type=Path);p.add_argument('--confirm-current-facts',action='store_true',required=True,help='确认已查看原横幅，图中名称、日期、地点、品牌与当前规范字段相符');a=p.parse_args()
 try:
  config,assets=load_config(a.workbook);source=config['branding'].get('heroSourceImage') or config['branding']['heroImage'];payload=binding_payload(config,assets);target=binding_path(a.workbook,source)
  if target.is_symlink():raise ValueError('不能写符号链接绑定文件')
  target.write_text(json.dumps(payload,sort_keys=True,indent=2)+'\n',encoding='utf8')
  print(f'已记录审核后的横幅适用哈希：{target}（不修改原图，不复制会务事实，不自动确认图片内容）')
 except (ConfigError,ValueError,OSError) as exc:
  print(f'素材确认失败：{exc}',file=sys.stderr);return 2
 return 0
if __name__=='__main__':raise SystemExit(main())
