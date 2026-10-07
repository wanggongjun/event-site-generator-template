"""Editable branded hero layout; supplied same-event imagery remains unchanged.

This scaffold preserves reference regions, not a claim of pixel-identical artwork.
A cleaned reusable background asset is optional and text/logos are independent.
"""
from pathlib import Path
import base64, html, mimetypes
ROOT=Path(__file__).resolve().parents[1]
def _data(data,suffix):
    mime=mimetypes.guess_type('asset'+suffix)[0] or 'image/png'
    return 'data:'+mime+';base64,'+base64.b64encode(data).decode('ascii')
def _text(value):return html.escape(str(value),quote=True)
def _date_label(e):
    from datetime import date
    a=e.get('startDate') or (e.get('startAt') or '')[:10];b=e.get('endDate') or (e.get('endAt') or '')[:10]
    if not a:return '日期待确认'
    x=date.fromisoformat(a);y=date.fromisoformat(b or a)
    if x==y:return f'{x.year}年{x.month}月{x.day}日'
    if x.year==y.year and x.month==y.month:return f'{x.year}年{x.month}月{x.day}日—{y.day}日'
    return f'{x.year}年{x.month}月{x.day}日—{y.year}年{y.month}月{y.day}日'
def hero_svg(config,assets=None):
    e=config['event'];brand=config.get('branding',{});assets=assets or {}
    bg=next((p for p in (ROOT/'template/frontend/public/brand').glob('banner-background.*') if p.suffix.lower() in {'.png','.webp','.jpg'}),None) if (ROOT/'template/frontend/public/brand').exists() else None
    background=f'<image href="{_data(bg.read_bytes(),bg.suffix)}" width="2048" height="512" preserveAspectRatio="none"/>' if bg else '<rect width="2048" height="512" fill="url(#blue)"/>'
    marks=[]
    brandmarks=config.get('brandmarks',[])
    if not brandmarks and brand.get('logo'):brandmarks=[{'label':e.get('shortTitle') or e['title'],'asset':brand['logo']}]
    for i,m in enumerate(brandmarks[:5]):
        key=m.get('asset','').lstrip('/');data=assets.get(key);x=48+i*203
        if data:marks.append(f'<image x="{x}" y="28" width="185" height="42" preserveAspectRatio="xMinYMid meet" href="{_data(data,Path(key).suffix)}"/><title>{_text(m.get("label",""))}</title>')
        else:marks.append(f'<text x="{x}" y="55" fill="white" font-size="21" font-weight="700">{_text(m.get("label",""))}</text>')
    title=brand.get('bannerTitle') or e.get('shortTitle') or e['title'];units=sum(1 if ord(c)>255 else .56 for c in title);font=min(112,max(44,1720/max(units,1)))
    series=brand.get('seriesText','');dates=_date_label(e);venue=e.get('location') or '地点待确认'
    date_size=min(32,max(12,465/max(len(dates)+3,1)));venue_size=min(32,max(12,865/max(len(venue)+3,1)))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="512" viewBox="0 0 2048 512" data-start-date="{_text(e.get('startDate') or (e.get('startAt') or '')[:10])}" data-end-date="{_text(e.get('endDate') or (e.get('endAt') or '')[:10])}">
<title>{_text(e['title'])}</title><desc>可编辑品牌横幅框架；标识、系列标题、展示标题、日期与地点分别独立。复用原横幅的同活动实例以原图为准。</desc>
<defs><linearGradient id="blue"><stop stop-color="#041364"/><stop offset=".5" stop-color="#0752d5"/><stop offset="1" stop-color="#021061"/></linearGradient></defs>
{background}<g font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif">{''.join(marks)}
<text x="1998" y="55" text-anchor="end" fill="white" font-size="22" font-weight="700">{_text(series)}</text>
<text id="editable-event-title" x="1024" y="264" text-anchor="middle" fill="white" font-size="{font:.2f}" font-weight="900">{_text(title)}</text>
<text id="editable-event-dates" x="590" y="350" fill="white" font-size="{date_size:.2f}" font-weight="800">时间：{_text(dates)}</text>
<text id="editable-event-venue" x="1088" y="350" fill="white" font-size="{venue_size:.2f}" font-weight="800">地点：{_text(venue)}</text></g></svg>'''
