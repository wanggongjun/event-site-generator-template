#!/usr/bin/env python3
"""Verify exported DOM/link contracts. Does not constitute browser visual QA."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import argparse, json, re
class PreviewParser(HTMLParser):
 def __init__(self):
  super().__init__();self.tables=[];self.table=None;self.links=[];self.texts=[];self.classes=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs);self.classes.extend(a.get('class','').split())
  if tag=='table' and 'schedule-overview-table' in a.get('class','').split():
   self.table={'headers':0,'venue':0};self.tables.append(self.table)
  if self.table and tag=='th':
   self.table['headers']+=int(a.get('scope')=='col')
   self.table['venue']+=int(a.get('colspan')=='3')
  if tag in ('a','img'):
   value=a.get('href' if tag=='a' else 'src','')
   if value:self.links.append(value)
 def handle_endtag(self,tag):
  if tag=='table':self.table=None
 def handle_data(self,data):self.texts.append(data)
def validate(app):
 app=Path(app);config=json.loads((app/'config.json').read_text());preview=app/'offline-preview';results=[]
 for name in ['home','travel','contact','resources','faq','account']:
  p=preview/(name+'.html');parser=PreviewParser();html=p.read_text();parser.feed(html)
  for value in parser.links:
   u=urlsplit(value)
   if u.scheme or u.netloc or not u.path:continue
   target=(p.parent/unquote(u.path)).resolve()
   if not target.is_relative_to(preview.resolve()) or not target.is_file():raise ValueError(f'{name}: unavailable local target {value}')
  if name=='home':
   if len(parser.tables)!=len(set(row['date'] for row in config['agenda'])):raise ValueError('Agenda day grouping differs from canonical input')
   if any(t['headers']!=4 or t['venue']<1 for t in parser.tables):raise ValueError('Each agenda day requires four headers and spanning venue')
   if 'mobile-service-dock' not in parser.classes:raise ValueError('Original floating mobile control missing')
   chapters=re.findall(r'([一二三四五六七八九十])、', ''.join(parser.texts))
   if chapters!=list('一二三四五六七八九十')[:len(chapters)]:raise ValueError(f'Non-consecutive section numbering: {chapters}')
   if config.get('readiness',{}).get('mode')=='preview' and '资料预览' not in ''.join(parser.texts):raise ValueError('Unknown operational facts require visible preview label')
  results.append(name)
 print(json.dumps({'passed':results,'scope':'SSR DOM structure, links, semantic preview only; NOT browser visual/interaction acceptance'},ensure_ascii=False))
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('instance',type=Path);a=p.parse_args();validate(a.instance)
if __name__=='__main__':main()
