#!/usr/bin/env python3
"""Deterministic canonical XLSX -> portable event app and editable materials.

Only workbook cells and referenced local public assets are event-specific inputs.
The runtime template is copied unchanged; existing business state is never deleted.
"""
from __future__ import annotations
import argparse
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
from datetime import date, datetime, time, timezone
from urllib.parse import urlsplit, quote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from zipfile import ZipFile, ZIP_DEFLATED
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.0.0'
MAX_WORKBOOK_BYTES = 10 * 1024 * 1024
MAX_ASSET_BYTES = 20 * 1024 * 1024
SAFE_ASSET_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx', '.pptx'}
FORBIDDEN_SEGMENTS = {'.git', 'node_modules', 'vendor', 'data', 'uploads', '__pycache__', '.aws', '.codex', '.agents'}
SECRET_KEY = re.compile(r'(password|passwd|secret|token|credential|api.?key|private.?key|authorization|database.?url|smtp|webhook|feishu|oauth)', re.I)
EVENT_FIELDS = {
 'event.slug': ('str', True), 'event.title': ('str', True), 'event.shortTitle': ('str', True),
 'event.subtitle': ('str', False), 'event.startAt': ('datetime', True), 'event.endAt': ('datetime', True),
 'event.timezone': ('str', True), 'event.location': ('str', True), 'event.capacity': ('positive-int', True),
 'event.language': ('str', False), 'event.siteUrl': ('url', False), 'event.recordingsEnabled': ('bool', False),
 'attendance.openAt': ('datetime', True), 'attendance.closeAt': ('datetime', True),
 'submission.openAt': ('datetime', True), 'submission.closeAt': ('datetime', True), 'submission.supplementCloseAt': ('datetime', False),
 'branding.primaryColor': ('color', False), 'branding.heroImage': ('asset', False), 'branding.logo': ('asset', False),
 'home.target': ('str', True), 'travel.address': ('str', True), 'travel.mapUrl': ('url', False),
}
COLLECTIONS = {
 'intro': (['text'], ['text']),
 'features': (['title', 'description'], ['title', 'description']),
 'organizers': (['role', 'name'], ['role', 'name']),
 'agenda': (['date', 'time', 'title', 'speaker', 'location'], ['date', 'time', 'title', 'location']),
 'directions': (['title', 'body'], ['title', 'body']),
 'hotels': (['name', 'address', 'description', 'url'], ['name', 'address', 'description']),
 'contacts': (['name', 'responsibility', 'email', 'phone', 'note'], ['name', 'responsibility']),
 'faqs': (['question', 'answer'], ['question', 'answer']),
 'resources': (['title', 'description', 'url', 'asset', 'type'], ['title', 'description']),
 'recordings': (['title', 'description', 'url'], ['title', 'description', 'url']),
}
DEFAULT_FIELDS = {'profileOptionalFields', 'files.maxFileBytes', 'files.maxAttachments', 'files.allowedExtensions', 'sync.pollSeconds'}
DEFAULTS = {'profileOptionalFields': ['department', 'job', 'personalIntroduction'], 'files.maxFileBytes': 20971520,
            'files.maxAttachments': 3, 'files.allowedExtensions': ['pdf', 'docx', 'pptx'], 'sync.pollSeconds': 60}

class ConfigError(ValueError):
    pass

def fail(message):
    raise ConfigError(message)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def plain(value, label, allow_empty=False):
    if value is None or value == '':
        if allow_empty:
            return ''
        fail(f'{label}: 必填内容为空')
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if not isinstance(value, (str, int, float)):
        fail(f'{label}: 需要文本、数字或日期')
    text = str(value).strip()
    if len(text) > 10000 or any(ord(ch) < 32 and ch not in '\n\t' for ch in text):
        fail(f'{label}: 文本过长或包含控制字符')
    if not text and not allow_empty:
        fail(f'{label}: 必填内容为空')
    return text

def parse_bool(value, label):
    if isinstance(value, bool):
        return value
    v = plain(value, label).lower()
    if v not in ('true', 'false', '1', '0', '是', '否'):
        fail(f'{label}: 布尔值必须为 true/false、1/0 或 是/否')
    return v in ('true', '1', '是')

def positive_int(value, label):
    if isinstance(value, bool):
        fail(f'{label}: 需要正整数')
    v = plain(value, label)
    if not re.fullmatch(r'\d+(?:\.0+)?', v):
        fail(f'{label}: 需要正整数')
    number = int(float(v))
    if number <= 0 or number > 2147483647:
        fail(f'{label}: 正整数超出范围')
    return number

def safe_url(value, label):
    v = plain(value, label)
    try:
        u = urlsplit(v)
        _ = u.port
    except ValueError:
        fail(f'{label}: URL 格式无效')
    if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password or '\\' in v or any(ch.isspace() for ch in v):
        fail(f'{label}: 只允许无凭据的完整 http/https URL')
    return v

def parse_datetime(value, label, zone):
    v = plain(value, label)
    try:
        dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
    except ValueError:
        fail(f'{label}: 需要 ISO 日期时间，例如 2027-03-18T09:00:00')
    if 'T' not in v and ' ' not in v:
        fail(f'{label}: 必须包含日期及时间')
    if dt.tzinfo is None:
        candidate = dt.replace(tzinfo=zone)
        if candidate.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != dt:
            fail(f'{label}: 该本地时间因夏令时不存在')
        if dt.replace(tzinfo=zone, fold=0).utcoffset() != dt.replace(tzinfo=zone, fold=1).utcoffset():
            fail(f'{label}: 该本地时间有夏令时歧义，请提供明确 UTC 偏移')
        dt = candidate
    else:
        if dt.utcoffset() != dt.astimezone(zone).utcoffset():
            fail(f'{label}: UTC 偏移与 event.timezone 不一致')
        dt = dt.astimezone(zone)
    return dt.isoformat(timespec='seconds')

def safe_asset(workbook_dir, value, label):
    v = plain(value, label)
    p = PurePosixPath(v)
    if '\\' in v or p.is_absolute() or any(part in ('..', '.', '') or part.startswith('.') for part in p.parts) or ':' in v:
        fail(f'{label}: 素材必须是工作簿目录内的安全相对路径')
    if not p.parts or any(part in FORBIDDEN_SEGMENTS for part in p.parts) or p.suffix.lower() not in SAFE_ASSET_EXTENSIONS:
        fail(f'{label}: 只允许 png/jpg/jpeg/webp/pdf/docx/pptx 公共素材')
    src = workbook_dir.joinpath(*p.parts)
    base = workbook_dir.resolve()
    if any(piece.is_symlink() for piece in [src, *list(src.parents)[:len(p.parts) - 1]]):
        fail(f'{label}: 禁止链接素材')
    try:
        src.resolve().relative_to(base)
    except ValueError:
        fail(f'{label}: 素材越出工作簿目录')
    if not src.is_file() or src.stat().st_size > MAX_ASSET_BYTES:
        fail(f'{label}: 素材不存在或超过 20MB')
    data = src.read_bytes()
    if p.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp'):
        from PIL import Image
        try:
            with Image.open(io.BytesIO(data)) as im:
                if im.width * im.height > 40000000:
                    fail(f'{label}: 图片像素过多')
                im.verify()
        except ConfigError:
            raise
        except Exception:
            fail(f'{label}: 图片文件无效')
    elif p.suffix.lower() == '.pdf':
        if not data.startswith(b'%PDF-'):
            fail(f'{label}: PDF 文件头无效')
    else:
        try:
            with ZipFile(io.BytesIO(data)) as z:
                if any('vba' in f.filename.lower() or f.filename.startswith('/') or '..' in PurePosixPath(f.filename).parts for f in z.infolist()):
                    fail(f'{label}: 禁止宏或不安全文档内容')
                if '[Content_Types].xml' not in z.namelist():
                    fail(f'{label}: Office 文件无效')
        except ConfigError:
            raise
        except Exception:
            fail(f'{label}: Office 文件无效')
    return '/assets/' + p.as_posix(), data

def read_rows(sheet, expected):
    if sheet.max_row > 2000 or sheet.max_column > 30:
        fail(f'{sheet.title}: 工作表过大')
    rows = list(sheet.iter_rows(values_only=False))
    if not rows:
        fail(f'{sheet.title}: 缺少表头')
    header = [plain(c.value, f'{sheet.title}!{c.coordinate}', True) for c in rows[0]]
    while header and not header[-1]:
        header.pop()
    if header != expected:
        fail(f'{sheet.title}: 第 1 行表头必须精确为 {",".join(expected)}')
    output = []
    for row in rows[1:]:
        if not any(c.value not in (None, '') for c in row):
            continue
        if any(c.data_type == 'f' or c.data_type == 'e' for c in row):
            fail(f'{sheet.title}!{row[0].row}: 配置不允许公式或错误单元格，请写入最终值')
        if any(c.value not in (None, '') for c in row[len(expected):]):
            fail(f'{sheet.title}!{row[0].row}: 存在未定义列的数据')
        output.append((row[0].row, {name: row[i].value if i < len(row) else None for i, name in enumerate(expected)}))
    return output

def load_config(workbook_path):
    """Validate everything without touching an output directory. Return config/assets."""
    path = Path(workbook_path).resolve()
    if path.suffix.lower() != '.xlsx' or not path.is_file() or path.stat().st_size > MAX_WORKBOOK_BYTES:
        fail('请输入存在且不超过 10MB 的 .xlsx 工作簿')
    raw = path.read_bytes()
    try:
        with ZipFile(io.BytesIO(raw)) as z:
            if sum(i.file_size for i in z.infolist()) > 50 * 1024 * 1024 or any('vbaProject' in i.filename for i in z.infolist()):
                fail('工作簿包含宏或解压体积超过 50MB')
        wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=False, data_only=False, keep_links=False)
    except ConfigError:
        raise
    except Exception as exc:
        fail(f'无法读取 XLSX: {type(exc).__name__}')
    allowed = {'event', 'defaults', *COLLECTIONS}
    if set(wb.sheetnames) - allowed:
        fail('未知工作表: ' + ', '.join(sorted(set(wb.sheetnames) - allowed)))
    if 'event' not in wb.sheetnames:
        fail('缺少 event 工作表')
    values = {}
    for row, record in read_rows(wb['event'], ['key', 'value', 'description']):
        key = plain(record['key'], f'event!A{row}')
        if SECRET_KEY.search(key):
            fail(f'event!A{row}: 禁止在配置内存储凭据或集成密钥')
        if key not in EVENT_FIELDS:
            fail(f'event!A{row}: 未定义配置项 {key}')
        if key in values:
            fail(f'event!A{row}: 重复配置项 {key}')
        values[key] = record['value']
    for key, (_, required) in EVENT_FIELDS.items():
        if required and values.get(key) in (None, ''):
            fail(f'event: 缺少必填配置 {key}')
    timezone_name = plain(values['event.timezone'], 'event.timezone')
    try:
        zone = ZoneInfo(timezone_name)
    except (ZoneInfoNotFoundError, ValueError):
        fail('event.timezone: 无效 IANA 时区（例如 Asia/Shanghai）')
    config = {'event': {}, 'attendance': {}, 'submission': {}, 'branding': {}, 'home': {}, 'travel': {}}
    assets = {}
    for key, (kind, _) in EVENT_FIELDS.items():
        val = values.get(key)
        if val in (None, ''):
            continue
        if kind == 'datetime':
            val = parse_datetime(val, key, zone)
        elif kind == 'positive-int':
            val = positive_int(val, key)
        elif kind == 'bool':
            val = parse_bool(val, key)
        elif kind == 'url':
            val = safe_url(val, key)
        elif kind == 'asset':
            val, data = safe_asset(path.parent, val, key)
            assets[val.removeprefix('/')] = data
        else:
            val = plain(val, key)
            if kind == 'color' and not re.fullmatch(r'#[0-9a-fA-F]{6}', val):
                fail(f'{key}: 必须为 #RRGGBB 颜色')
        group, name = key.split('.')
        config[group][name] = val
    e = config['event']
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', e['slug']) or len(e['slug']) > 64:
        fail('event.slug: 需要不超过 64 字符的小写字母、数字和单连字符')
    e.setdefault('subtitle', '')
    e.setdefault('language', 'zh-CN')
    if e['language'] != 'zh-CN':
        fail('event.language: v1 仅支持 zh-CN 中文界面')
    e.setdefault('siteUrl', '')
    e.setdefault('recordingsEnabled', False)
    config['branding'].setdefault('primaryColor', '#5b9bd5')
    config['branding'].setdefault('heroImage', '/assets/hero.svg')
    start, end = (datetime.fromisoformat(e[k]) for k in ('startAt', 'endAt'))
    if start >= end:
        fail('event: startAt 必须早于 endAt')
    for group in ('attendance', 'submission'):
        opened, closed = (datetime.fromisoformat(config[group][k]) for k in ('openAt', 'closeAt'))
        if opened >= closed:
            fail(f'{group}: 需要 openAt < closeAt')
    config['submission'].setdefault('supplementCloseAt', config['submission']['closeAt'])
    supplement = datetime.fromisoformat(config['submission']['supplementCloseAt'])
    if supplement < datetime.fromisoformat(config['submission']['closeAt']):
        fail('submission: 需要 closeAt <= supplementCloseAt')
    defaults = dict(DEFAULTS)
    if 'defaults' in wb.sheetnames:
        seen = set()
        for row, record in read_rows(wb['defaults'], ['key', 'value', 'description']):
            key = plain(record['key'], f'defaults!A{row}')
            if SECRET_KEY.search(key):
                fail('defaults: 禁止凭据配置')
            if key not in DEFAULT_FIELDS or key in seen:
                fail(f'defaults!A{row}: 未定义或重复配置项 {key}')
            seen.add(key)
            value = record['value']
            if value in (None, ''):
                continue
            if key in ('profileOptionalFields', 'files.allowedExtensions'):
                items = [item.strip() for item in plain(value, key).split(',') if item.strip()]
                allowed_items = set(DEFAULTS[key])
                if len(items) != len(set(items)) or set(items) - allowed_items:
                    fail(f'{key}: 重复或不支持的选项')
                if key == 'files.allowedExtensions' and not items:
                    fail(f'{key}: 不可为空')
                defaults[key] = items
            else:
                defaults[key] = positive_int(value, key)
    if defaults['files.maxFileBytes'] > 20971520 or defaults['files.maxAttachments'] > 3 or not 5 <= defaults['sync.pollSeconds'] <= 3600:
        fail('defaults: 附件上限不可超过 20MB/3 个；轮询间隔必须为 5–3600 秒')
    config['files'] = {key.split('.')[1]: defaults[key] for key in DEFAULT_FIELDS if key.startswith('files.')}
    config['sync'] = {'pollSeconds': defaults['sync.pollSeconds']}
    config['forms'] = {'profileOptionalFields': defaults['profileOptionalFields']}
    for name, (columns, required_columns) in COLLECTIONS.items():
        result, identities = [], set()
        if name in wb.sheetnames:
            for row, record in read_rows(wb[name], columns):
                item = {}
                for field in columns:
                    v = plain(record[field], f'{name}!{field}{row}', field not in required_columns)
                    if not v:
                        continue
                    if field == 'url':
                        v = safe_url(v, f'{name}!{field}{row}')
                    elif field == 'asset':
                        v, data = safe_asset(path.parent, v, f'{name}!{field}{row}')
                        if v in ('/assets/hero.svg',):
                            fail('素材路径与生成文件冲突')
                        assets[v.removeprefix('/')] = data
                    item[field] = v
                if name == 'resources' and bool(item.get('url')) == bool(item.get('asset')):
                    fail(f'resources!{row}: url 和 asset 必须且只能填写一项')
                if name == 'contacts':
                    if not item.get('email') and not item.get('phone'):
                        fail(f'contacts!{row}: email 或 phone 至少填写一项')
                    if item.get('email') and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', item['email']):
                        fail(f'contacts!{row}: email 格式无效')
                if name == 'agenda':
                    try:
                        item['date'] = date.fromisoformat(item['date']).isoformat()
                        if not re.fullmatch(r'\d{2}:\d{2}(?:-\d{2}:\d{2})?', item['time']):
                            raise ValueError()
                        times = item['time'].split('-')
                        for t in times:
                            time.fromisoformat(t)
                        if len(times) == 2 and times[0] >= times[1]:
                            raise ValueError()
                    except ValueError:
                        fail(f'agenda!{row}: date 需要 YYYY-MM-DD，time 需要 HH:MM 或 HH:MM-HH:MM 且有序')
                    if not start.date() <= date.fromisoformat(item['date']) <= end.date():
                        fail(f'agenda!{row}: 日程日期超出活动日期')
                    identity = (item['date'], item['time'], item['location'])
                elif name == 'organizers':
                    identity = (item['role'], item['name'])
                elif name == 'contacts':
                    identity = (item['name'], item['responsibility'])
                else:
                    identity = item[columns[0]]
                if identity in identities:
                    fail(f'{name}!{row}: 重复或冲突记录')
                identities.add(identity)
                result.append(item)
        if name == 'intro':
            config['home']['intro'] = [item['text'] for item in result]
        elif name in ('features', 'organizers'):
            config['home'][name] = result
        elif name == 'directions':
            config['travel']['directions'] = result
        else:
            config[name] = result
    if not e['recordingsEnabled']:
        config['recordings'] = []
    if not config['home']['intro'] or not config['agenda'] or not config['contacts'] or not config['faqs']:
        fail('intro、agenda、contacts、faqs 各至少需要一条记录')
    config['source'] = {'schemaVersion': VERSION, 'workbookSha256': digest(raw)}
    wb.close()
    return config, assets

def event_facts(config):
    e = config['event']
    start, end = (datetime.fromisoformat(e[k]) for k in ('startAt', 'endAt'))
    date_text = f'{start:%Y年%m月%d日}' if start.date() == end.date() else f'{start:%Y年%m月%d日}至{end:%Y年%m月%d日}'
    return {'title': e['title'], 'subtitle': e['subtitle'], 'dates': date_text,
            'location': e['location'], 'capacity': str(e['capacity']), 'siteUrl': e['siteUrl'],
            'attendanceClose': datetime.fromisoformat(config['attendance']['closeAt']).strftime('%Y年%m月%d日 %H:%M'),
            'submissionClose': datetime.fromisoformat(config['submission']['closeAt']).strftime('%Y年%m月%d日 %H:%M')}

def svg_text(value):
    return html.escape(str(value), quote=True)

def text_width(text):
    return sum(1.0 if ord(c) > 255 else 0.57 for c in text)

def hero_svg(config):
    f = event_facts(config)
    size = min(116, 1740 / max(1, text_width(f['title'])))
    subtitle_size = min(28, 1740 / max(1, text_width(f['subtitle'])))
    footer = f['dates']+'  ·  '+f['location']
    footer_size = min(29, 1740 / max(1, text_width(footer)))
    arcs = ''.join(f'<path d="M {1024-r} 550 Q 1024 {-r*0.40} {1024+r} 550" fill="none" stroke="#41a6ff" stroke-opacity="0.12"/>' for r in range(400, 1500, 80))
    dots = ''.join(f'<circle cx="{x}" cy="{y}" r="1.5" fill="#49b2ff" opacity="{0.08 + ((x+y)%7)*0.013:.3f}"/>' for x in range(450, 1610, 18) for y in range(30, 220, 18))
    waves = ''.join(f'<path d="M -20 {420+i*2} C 340 {250+i*3}, 700 {620-i*2}, 1024 450 S 1650 {250+i*3}, 2070 {420+i*2}" fill="none" stroke="#33c4ff" stroke-opacity="{0.08 + i*0.007:.3f}" stroke-width="1"/>' for i in range(24))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="512" viewBox="0 0 2048 512" role="img" aria-labelledby="title desc">
<title id="title">{svg_text(f['title'])}</title><desc id="desc">{svg_text(f['dates']+'，'+f['location'])}</desc>
<defs><radialGradient id="bg"><stop stop-color="#0843b9"/><stop offset="1" stop-color="#07156e"/></radialGradient><radialGradient id="flare"><stop stop-color="#a7edff"/><stop offset="1" stop-color="#3cbcff" stop-opacity="0"/></radialGradient></defs>
<rect width="2048" height="512" fill="url(#bg)"/>{arcs}{dots}{waves}
<path d="M 1024 453 C 670 245 252 342 462 441 C 650 546 880 500 1024 453 C 1378 245 1796 342 1586 441 C 1398 546 1168 500 1024 453" fill="none" stroke="#56d5ff" stroke-opacity="0.6" stroke-width="4"/>
<ellipse cx="1024" cy="453" rx="96" ry="44" fill="url(#flare)"/>
<g fill="white" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" text-anchor="middle"><text x="1024" y="240" font-size="{size:.1f}" font-weight="700">{svg_text(f['title'])}</text><text x="1024" y="305" font-size="{subtitle_size:.1f}" opacity="0.9">{svg_text(f['subtitle'])}</text><text x="1024" y="361" font-size="{footer_size:.1f}" font-weight="600">{svg_text(footer)}</text></g></svg>'''

def poster_svg(config):
    f = event_facts(config)
    title_size = min(78, 900/max(1,text_width(f['title'])))
    lines = [f['dates'], f['location'], '参会报名截止：'+f['attendanceClose'], '学术投稿截止：'+f['submissionClose'], '参会规模：'+f['capacity']+' 人', f['siteUrl'] or '请通过会议网站完成报名与投稿']
    body = ''.join(f'<text x="90" y="{520+i*70}" font-size="{min(31,900/max(1,text_width(line))):.1f}">{svg_text(line)}</text>' for i,line in enumerate(lines))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440"><title>{svg_text(f['title'])}</title><defs><linearGradient id="p" x2="1" y2="1"><stop stop-color="#071b72"/><stop offset="1" stop-color="#095ddd"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#p)"/><g fill="none" stroke="#58c9ff" stroke-opacity="0.2">{''.join(f'<circle cx="1050" cy="180" r="{r}"/>' for r in range(160,1000,65))}</g><rect x="70" y="400" width="940" height="620" rx="30" fill="#031a66" fill-opacity="0.45"/><g fill="white" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif"><text x="90" y="190" font-size="22" letter-spacing="3">CONFERENCE · 会议邀请</text><text x="90" y="300" font-size="{title_size:.1f}" font-weight="700">{svg_text(f['title'])}</text><text x="90" y="360" font-size="{min(30,900/max(1,text_width(f['subtitle']))):.1f}">{svg_text(f['subtitle'])}</text>{body}<text x="90" y="1140" font-size="32" font-weight="700">共同探索 · 开放交流</text><text x="90" y="1200" font-size="25">{svg_text(config['home']['target'][:34])}</text><text x="90" y="1320" font-size="22" opacity="0.75">时间均以 {svg_text(config['event']['timezone'])} 为准</text></g></svg>'''

def poster_png(config, path):
    from PIL import Image, ImageDraw, ImageFont
    fonts = [Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'), Path('/System/Library/Fonts/PingFang.ttc'), Path('C:/Windows/Fonts/msyh.ttc')]
    font_path = next((str(p) for p in fonts if p.is_file()), None)
    if not font_path:
        # SVG and DOCX remain fully editable; PNG creation needs a Unicode font.
        return False
    im = Image.new('RGB', (1080,1440)); draw = ImageDraw.Draw(im)
    for y in range(1440):
        p=y/1439
        draw.line((0,y,1080,y),fill=(int(7+2*p),int(27+66*p),int(114+107*p)))
    for r in range(160,1000,65):
        draw.ellipse((1050-r,180-r,1050+r,180+r),outline=(28,94,177),width=1)
    draw.rounded_rectangle((70,400,1010,1020),radius=30,fill=(5,37,119))
    f=event_facts(config)
    def write(text,y,size):
        font=ImageFont.truetype(font_path,size)
        while draw.textbbox((0,0),text,font=font)[2]>900 and size>10:
            size-=1; font=ImageFont.truetype(font_path,size)
        draw.text((90,y),text,font=font,fill='white',anchor='lt')
    write('CONFERENCE · 会议邀请',155,22);write(f['title'],240,78);write(f['subtitle'],325,30)
    for i,line in enumerate([f['dates'],f['location'],'参会报名截止：'+f['attendanceClose'],'学术投稿截止：'+f['submissionClose'],'参会规模：'+f['capacity']+' 人',f['siteUrl'] or '请通过会议网站完成报名与投稿']):
        write(line,485+i*70,31)
    write('共同探索 · 开放交流',1100,32);write(config['home']['target'][:34],1160,25);write('时间均以 '+config['event']['timezone']+' 为准',1280,22)
    im.save(path,compress_level=9)
    return True

def resource_destination(config, item):
    """Standalone material links derive from the canonical website + public path."""
    if item.get('url'):
        return item['url']
    asset = item.get('asset', '')
    site_url = config['event'].get('siteUrl', '')
    if site_url:
        return site_url.rstrip('/') + quote(asset, safe='/')
    return asset + '（本地演示路径；需先启动网站，不能作为独立公开链接）'

def guide_sections(config):
    f=event_facts(config)
    return [
     ('会议概览',[f['dates']+' · '+f['location'],config['travel']['address'],'参会规模：'+f['capacity']+' 人','时区：'+config['event']['timezone'],*config['home']['intro'],'适合参加：'+config['home']['target']]),
     ('报名与投稿',['参会报名截止：'+f['attendanceClose'],'学术投稿截止：'+f['submissionClose'],'补充材料截止：'+datetime.fromisoformat(config['submission']['supplementCloseAt']).strftime('%Y年%m月%d日 %H:%M'),'报名与投稿是两项独立流程；先完成个人信息后，可以分别提交。','每人一份投稿；最多 '+str(config['files']['maxAttachments'])+' 个附件，单个不超过 '+str(config['files']['maxFileBytes']//1048576)+'MB，支持 '+'/'.join(config['files']['allowedExtensions']).upper()+'。',f['siteUrl'] or '会议网站地址待主办方发布']),
     ('会议日程',[item['date']+' '+item['time']+' | '+item['title']+' | '+item.get('speaker','')+' | '+item['location'] for item in config['agenda']]),
     ('交通与住宿',[config['travel']['address'],*[item['title']+'：'+item['body'] for item in config['travel']['directions']],*[item['name']+'：'+item['address']+'。'+item['description']+((' '+item['url']) if item.get('url') else '') for item in config['hotels']]]),
     ('联系与常见问题',[*[item['name']+'（'+item['responsibility']+'）：'+' / '.join(item.get(k,'') for k in ('email','phone') if item.get(k))+(('。'+item['note']) if item.get('note') else '') for item in config['contacts']],*[item['question']+'\n'+item['answer'] for item in config['faqs']]]),
     ('资料下载',[item['title']+'：'+item['description']+' '+resource_destination(config,item) for item in config['resources']]),
    ] + ([('会议回放',[item['title']+'：'+item['description']+' '+item['url'] for item in config['recordings']])] if config['event']['recordingsEnabled'] else [])

def deterministic_docx(path, config):
    from docx import Document
    from docx.shared import Inches, Pt, RGBColor
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    doc=Document(); section=doc.sections[0]
    section.page_width=Inches(8.27);section.page_height=Inches(11.69)
    section.top_margin=section.bottom_margin=Inches(.7);section.left_margin=section.right_margin=Inches(.8)
    for name in ('Normal','Title','Heading 1'):
        style=doc.styles[name]
        for border in list(style._element.iter(qn('w:pBdr'))):
            border.getparent().remove(border)
        style.font.name='Noto Sans CJK SC';style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Noto Sans CJK SC')
    doc.styles['Normal'].font.size=Pt(10.5)
    doc.styles['Normal'].paragraph_format.space_after=Pt(7)
    doc.styles['Normal'].paragraph_format.line_spacing=1.2
    doc.styles['Title'].font.size=Pt(26);doc.styles['Title'].font.color.rgb=RGBColor.from_string('1459D9')
    doc.styles['Heading 1'].font.size=Pt(15);doc.styles['Heading 1'].font.color.rgb=RGBColor.from_string('1459D9')
    doc.add_heading(config['event']['title'],0);doc.add_paragraph(config['event']['subtitle']);doc.add_paragraph('会议指南')
    for title,lines in guide_sections(config):
        if lines:
            if title in ('会议日程', '联系与常见问题'):
                doc.add_page_break()
            doc.add_heading(title,1)
            for line in lines:
                doc.add_paragraph(line)
    props=doc.core_properties;props.title=config['event']['title']+'会议指南';props.author='';props.last_modified_by='';props.created=props.modified=datetime(2000,1,1)
    stream=io.BytesIO();doc.save(stream)
    with ZipFile(stream) as src, ZipFile(path,'w',ZIP_DEFLATED,compresslevel=9) as out:
        for name in sorted(src.namelist()):
            from zipfile import ZipInfo
            info=ZipInfo(name,date_time=(2000,1,1,0,0,0));info.compress_type=ZIP_DEFLATED;info.external_attr=0o600<<16
            out.writestr(info,src.read(name))

def write_materials(stage,config):
    folder=stage/'materials';folder.mkdir(parents=True,exist_ok=True)
    (folder/'poster.svg').write_text(poster_svg(config),encoding='utf-8')
    png=poster_png(config,folder/'poster.png')
    deterministic_docx(folder/'conference-guide.docx',config)
    sections=''.join('<section><h2>'+html.escape(title)+'</h2>'+''.join('<p>'+html.escape(line).replace('\n','<br>')+'</p>' for line in lines)+'</section>' for title,lines in guide_sections(config) if lines)
    body='<!doctype html><html lang="'+config['event']['language']+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+html.escape(config['event']['title'])+'会议指南</title><style>body{max-width:800px;margin:48px auto;padding:0 24px;color:#193254;font:16px/1.8 system-ui,sans-serif}h1,h2{color:#1459d9}h1{line-height:1.3}section{break-inside:avoid}p{overflow-wrap:anywhere}@media print{body{margin:0}} </style><h1>'+html.escape(config['event']['title'])+'</h1><p>'+html.escape(config['event']['subtitle'])+'</p>'+sections+'</html>'
    (folder/'conference-guide.html').write_text(body,encoding='utf-8')
    f=event_facts(config)
    posts=f"""长版邀请\n{f['title']}\n{f['subtitle']}\n时间：{f['dates']}\n地点：{f['location']}\n{config['home']['intro'][0]}\n适合参加：{config['home']['target']}\n参会报名截止：{f['attendanceClose']}\n学术投稿截止：{f['submissionClose']}\n报名与投稿分别进行。参会规模：{f['capacity']} 人。\n会议网站：{f['siteUrl'] or '待发布'}\n所有时间以 {config['event']['timezone']} 为准。\n\n简版邀请\n{f['title']}将于{f['dates']}在{f['location']}举行。报名截止{f['attendanceClose']}；投稿截止{f['submissionClose']}。详情：{f['siteUrl'] or '待发布'}\n"""
    (folder/'social-posts.txt').write_text(posts,encoding='utf-8')
    return png

def template_files(template):
    if not template.is_dir():
        fail('缺少运行时 template/ 目录')
    result=[]
    for p in sorted(template.rglob('*')):
        rel=p.relative_to(template)
        if any(part in FORBIDDEN_SEGMENTS or part == 'dist' or (part.startswith('.') and part not in ('.env.example','.gitignore','.npmrc')) for part in rel.parts):
            continue
        if p.is_symlink():
            fail(f'template: 禁止符号链接 {rel}')
        if p.is_file():
            result.append((rel,p.read_bytes()))
    if not result:
        fail('template/ 为空')
    return result

def existing_output(output,slug):
    if output.is_symlink():
        fail('输出目录不可为符号链接')
    if not output.exists():
        return None
    if not output.is_dir():
        fail('输出路径已存在且不是目录')
    if not any(output.iterdir()):
        return None
    manifest_path=output/'manifest.json'
    if not manifest_path.is_file() or manifest_path.is_symlink():
        fail('拒绝写入非空未知目录；请使用新的空目录或本生成器已有输出')
    try:
        manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    except (ValueError,OSError):
        fail('已有 manifest.json 无效')
    if manifest.get('generator') != 'canonical-xlsx-event-template' or manifest.get('eventSlug') != slug:
        fail('已有输出不属于本生成器，或 event.slug 已改变；不同会议必须使用独立输出目录')
    return manifest

def generate(workbook_path, output=None, template=None):
    config, assets=load_config(workbook_path)
    slug=config['event']['slug']; target=Path(output) if output else ROOT/'generated'/slug
    target=target.absolute();template=Path(template) if template else ROOT/'template'
    for parent in [target,*target.parents]:
        if parent.is_symlink():
            fail('输出目录的父路径不可为符号链接')
    try:
        target.resolve().relative_to(template.resolve())
        fail('输出目录不可位于 template/ 内')
    except ValueError:
        pass
    old=existing_output(target,slug)
    files=template_files(template)
    for rel,_ in files:
        if any(part in ('data','uploads') for part in rel.parts) or rel.name == '.env':
            fail('运行时模板包含业务状态或凭据')
    # All input/config/template validation has finished before output is touched.
    with tempfile.TemporaryDirectory(prefix='event-stage-') as tmp:
        stage=Path(tmp)
        for rel,data in files:
            p=stage/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        config_bytes=(json.dumps(config,ensure_ascii=False,indent=2,sort_keys=True)+'\n').encode('utf-8')
        for rel in ('config.json','frontend/public/config.json','frontend/src/config.generated.json'):
            p=stage/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(config_bytes)
        assets['assets/hero.svg']=hero_svg(config).encode('utf-8')
        for rel,data in assets.items():
            p=stage/'frontend/public'/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
        png=write_materials(stage,config)
        artifact_paths=[p.relative_to(stage).as_posix() for p in sorted(stage.rglob('*')) if p.is_file()]
        # Existing arbitrary user files must not be overwritten accidentally.
        previous_artifacts=set(old.get('artifacts',[])) if old else set()
        for rel in artifact_paths + ['manifest.json']:
            dest=target/rel
            if any(p.is_symlink() for p in [dest,*list(dest.parents)[:len(PurePosixPath(rel).parts)]]):
                fail(f'拒绝写入符号链接: {rel}')
            if dest.exists() and not dest.is_file():
                fail(f'输出文件路径被目录占用: {rel}')
            if old and dest.exists() and rel not in previous_artifacts and rel != 'manifest.json':
                fail(f'拒绝覆盖非生成文件: {rel}')
        manifest={'generator':'canonical-xlsx-event-template','generatorVersion':VERSION,'eventSlug':slug,
                  'workbookSha256':config['source']['workbookSha256'],
                  'configSha256':digest(config_bytes),'templateSha256':digest(b''.join(str(r).encode()+b'\0'+d for r,d in files)),
                  'artifacts':artifact_paths,'sha256':{rel:digest((stage/rel).read_bytes()) for rel in artifact_paths},
                  'warnings':[] if png else ['PNG 未生成：系统缺少中文字体；可编辑 SVG 已生成。']}
        (stage/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        target.mkdir(parents=True,exist_ok=True)
        # Overlay only generator-owned files. No delete/rmtree occurs in target.
        for rel in artifact_paths + ['manifest.json']:
            src=stage/rel;dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True)
            fd,tmp_name=tempfile.mkstemp(prefix='.event-write-',dir=dest.parent)
            try:
                with os.fdopen(fd,'wb') as stream:
                    stream.write(src.read_bytes())
                os.chmod(tmp_name, 0o644)
                os.replace(tmp_name,dest)
            finally:
                if os.path.exists(tmp_name):
                    os.unlink(tmp_name)
    return target,manifest

def main(argv=None):
    parser=argparse.ArgumentParser(description='Validate canonical event XLSX and generate independent app/materials.')
    parser.add_argument('workbook',type=Path)
    parser.add_argument('--output',type=Path,help='Default: generated/<event.slug>; never use one directory for multiple events.')
    parser.add_argument('--template',type=Path,help='Optional runtime template directory.')
    parser.add_argument('--validate-only',action='store_true')
    args=parser.parse_args(argv)
    try:
        if args.validate_only:
            config,assets=load_config(args.workbook)
            print(f"配置有效：{config['event']['slug']}，{len(config['agenda'])} 条日程，{len(assets)} 个公共素材")
        else:
            path,manifest=generate(args.workbook,args.output,args.template)
            print(f'已生成：{path}')
            print(f"{len(manifest['artifacts'])} 个文件；配置 SHA-256 {manifest['configSha256']}")
            for warning in manifest['warnings']:
                print('提示：'+warning)
    except ConfigError as exc:
        print('配置错误：'+str(exc),file=sys.stderr)
        return 2
    return 0

if __name__=='__main__':
    raise SystemExit(main())
