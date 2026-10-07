"""Resolve a small, fixed set of canonical event facts in public prose.

This is a one-pass build-time substitution, not an expression/template engine.
Inputs remain raw text; the caller's HTML/XML/SVG layer escapes for its context.
"""
from __future__ import annotations
from datetime import date, datetime
import re

TOKEN = re.compile(r'\{\{([^{}]*)\}\}')
ORGANIZER_ROLES = ('主办单位', '协办单位', '支持单位')
TEXT_COLLECTION_FIELDS = {
    'agenda': ('title', 'speaker', 'chair', 'location'),
    'notices': ('title', 'body'),
    'mealGuide': ('title', 'body'),
    'sourceNotes': ('title', 'body'),
    'hotels': ('name', 'address', 'description'),
    'contacts': ('name', 'responsibility', 'note'),
    'faqs': ('question', 'answer'),
    'resources': ('title', 'description'),
    'recordings': ('title', 'description'),
    'brandmarks': ('label',),
}


def date_range(event):
    """Chinese date precision, preserving the original Handbook's prose label."""
    def read(which):
        raw = event.get(which+'Date')
        if not raw and event.get(which+'At'):
            raw = datetime.fromisoformat(event[which+'At']).date().isoformat()
        try:
            return date.fromisoformat(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f'内容引用需要有效 event.{which}Date') from exc
    first, last = read('start'), read('end')
    if first > last:
        raise ValueError('内容引用需要 event.startDate <= event.endDate')
    begin = f'{first.year}年{first.month}月{first.day}日'
    if first == last:
        return begin
    finish = f'{last.month}月{last.day}日' if first.year == last.year else f'{last.year}年{last.month}月{last.day}日'
    return begin+'至'+finish


def _walk_strings(value, path=()):
    """Validation only. Paths never become variable lookups or expressions."""
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _walk_strings(item, path+(key,))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_strings(item, path+(index,))


def resolve_content_refs(config):
    """Mutate known public prose fields atomically and return the same config.

    Run after canonical facts/date/collection validation, before contextual output
    escaping. Each regeneration starts from the raw XLSX templates. A second call
    on already resolved content is harmless, but cannot restore the source tokens.
    """
    event, home, travel = config['event'], config['home'], config['travel']
    values = {
        'event.title': event['title'],
        'event.shortTitle': event['shortTitle'],
        'event.dateRange': date_range(event),
        'event.location': event['location'],
        'travel.address': travel['address'],
    }
    for role in ORGANIZER_ROLES:
        names = [item['name'] for item in home.get('organizers', []) if item.get('role') == role]
        values['organizers.'+role] = '、'.join(names)
    for key, value in values.items():
        if not isinstance(value, str) or '{{' in value or '}}' in value:
            raise ValueError(f'内容引用的规范事实必须是普通文本：{key}')

    targets = []
    def add(container, key, path):
        present = (isinstance(key, int) and 0 <= key < len(container)) if isinstance(container, list) else key in container
        if present:
            value = container[key]
            if not isinstance(value, str):
                raise ValueError(f'内容字段需要文本：{path}')
            targets.append((container, key, path, value))
    for index, paragraph in enumerate(home.get('intro', [])):
        add(home['intro'], index, f'home.intro[{index}]')
    add(home, 'target', 'home.target')
    for index, item in enumerate(home.get('features', [])):
        for field in ('title', 'description'):
            add(item, field, f'home.features[{index}].{field}')
    for index, item in enumerate(travel.get('directions', [])):
        for field in ('title', 'body'):
            add(item, field, f'travel.directions[{index}].{field}')
    for collection, fields in TEXT_COLLECTION_FIELDS.items():
        for index, item in enumerate(config.get(collection, [])):
            for field in fields:
                add(item, field, f'{collection}[{index}].{field}')

    allowed_paths = {path for _, _, path, _ in targets}
    def label(path):
        output = ''
        for part in path:
            output += '['+str(part)+']' if isinstance(part, int) else ('.' if output else '')+str(part)
        return output
    # Tokens in URLs, assets, credentials, canonical facts, dates, IDs, or arbitrary
    # fields are rejected, not interpolated or allowed to leak into public output.
    for path, text in _walk_strings(config):
        if '{{' in text or '}}' in text:
            for match in TOKEN.finditer(text):
                if match.group(1) not in values:
                    raise ValueError('未知固定内容引用：{{'+match.group(1)+'}}')
            stripped = TOKEN.sub('', text)
            if '{{' in stripped or '}}' in stripped:
                raise ValueError('内容引用括号不完整：'+label(path))
            if label(path) not in allowed_paths:
                raise ValueError('此字段不允许内容引用：'+label(path))

    pending = []
    for container, key, path, text in targets:
        def replace(match):
            value = values[match.group(1)]
            if not value:
                raise ValueError('内容引用缺少规范事实：{{'+match.group(1)+'}}')
            return value
        expanded = TOKEN.sub(replace, text)
        if len(expanded) > 10000:
            raise ValueError('引用展开后内容超过10000字符：'+path)
        pending.append((container, key, expanded))
    for container, key, expanded in pending:
        container[key] = expanded
    return config
