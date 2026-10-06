#!/usr/bin/env python3
"""Copy the editable bundled fictional workbook/assets to a fresh input folder.

No app state is copied. XLSX authoring is intentionally left to Excel or a
spreadsheet-aware agent; this script never creates another configuration source.
"""
import argparse
from pathlib import Path
import shutil
import sys
ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser(description='复制虚构示例工作簿与公共素材，作为新会议输入。')
    parser.add_argument('destination',type=Path)
    args=parser.parse_args()
    dest=args.destination
    if dest.is_symlink() or (dest.exists() and (not dest.is_dir() or any(dest.iterdir()))):
        print('拒绝覆盖非空目录；请使用新的空输入目录。',file=sys.stderr);return 2
    dest.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'input/fictional-conference.xlsx',dest/'event.xlsx')
    shutil.copytree(ROOT/'input/assets',dest/'assets',dirs_exist_ok=True)
    print(f'已复制 {dest}/event.xlsx；请更改 event.slug，并填写新会议事实。')
    return 0
if __name__=='__main__':
    raise SystemExit(main())
