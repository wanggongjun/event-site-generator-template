"""Small derived-asset binding. No second editable fact source or expression engine."""
from pathlib import Path
import hashlib,json

def digest(data):return hashlib.sha256(data).hexdigest()
def hero_facts(config,assets):
 e=config['event'];b=config.get('branding',{})
 image_hash=lambda url:digest(assets[url.lstrip('/')]) if url and url.lstrip('/') in assets else None
 return {'title':e['title'],'shortTitle':e['shortTitle'],'dates':[e['startDate'],e['endDate']],'location':e['location'],'address':config['travel']['address'],'organizers':config['home'].get('organizers',[]),'seriesText':b.get('seriesText',''),'bannerTitle':b.get('bannerTitle',''),'logoSha256':image_hash(b.get('logo')),'brandmarks':[{'label':m['label'],'imageSha256':image_hash(m['asset'])} for m in config.get('brandmarks',[])]}
def binding_payload(config,assets):
 source=config['branding'].get('heroSourceImage') or config['branding'].get('heroImage')
 data=assets.get((source or '').lstrip('/'))
 if not data:raise ValueError('工作簿没有提供现成PNG/JPG/WebP横幅；可直接使用可编辑生成版。')
 facts=json.dumps(hero_facts(config,assets),ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
 return {'version':1,'imageSha256':digest(data),'factsSha256':digest(facts)}
def binding_path(workbook,source):
 return Path(workbook).resolve().parent/((source.removeprefix('/assets/'))+'.facts.json')
def apply_hero_binding(config,assets,workbook):
 b=config['branding'];source=b.get('heroImage','/assets/hero.svg')
 if source.lstrip('/') not in assets:
  b['heroBinding']={'mode':'editable'};return
 b['heroSourceImage']=source;expected=binding_payload(config,assets);path=binding_path(workbook,source)
 try:
  if path.is_symlink():raise ValueError('不可读取符号链接绑定文件')
  supplied=json.loads(path.read_text(encoding='utf8'))
  if supplied!=expected:raise ValueError('静态图片或规范活动事实已变化')
 except (OSError,ValueError,TypeError):
  b['heroImage']='/assets/hero.svg';b['heroBinding']={'mode':'fallback',**expected}
  b['heroWarning']='原静态横幅未绑定当前事实或绑定已变化，已改用当前信息的可编辑横幅。若确认原图片仍准确，请逐字检查后执行文档中的显式素材确认命令。'
 else:
  b['heroBinding']={'mode':'bound',**expected}
