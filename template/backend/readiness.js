// Factual readiness is independent of APP_MODE (simulation/real). Recalculate at
// the application boundary rather than trusting a generated readiness flag.
export const knownCapacity = config => {
  const value = config.event?.capacity;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null;
};

export function windowTime(value) {
  if (typeof value !== 'string') return NaN;
  // Generated timestamps include an explicit offset. Date-only text and invalid
  // calendar dates are not application windows.
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(part => Number(part ?? 0));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return NaN;
  return Date.parse(value);
}

export function businessReadiness(config) {
  const unresolved = [];
  if (knownCapacity(config) === null) unresolved.push({ key: 'event.capacity', reason: '参会规模待主办方确认，请补全正整数容量后重新生成配置。' });
  for (const kind of ['attendance', 'submission']) {
    const settings = config[kind] || {};
    if (settings.enabled === false) continue;
    const open = windowTime(settings.openAt), close = windowTime(settings.closeAt);
    for (const [key, value] of [['openAt', open], ['closeAt', close]]) {
      if (!Number.isFinite(value)) unresolved.push({ key: `${kind}.${key}`, reason: `${kind === 'attendance' ? '参会报名' : '学术投稿'}${key === 'openAt' ? '开放' : '截止'}时间待确认，请补全含时区的日期时间后重新生成配置。` });
    }
    if (Number.isFinite(open) && Number.isFinite(close) && open >= close) unresolved.push({ key: `${kind}.closeAt`, reason: '申请截止时间必须晚于开放时间，请更正后重新生成配置。' });
  }
  return {
    mode: unresolved.length ? 'preview' : 'ready', unresolved,
    attendanceEnabled: config.attendance?.enabled !== false && !unresolved.some(item => item.key === 'event.capacity' || item.key.startsWith('attendance.')),
    submissionEnabled: config.submission?.enabled !== false && !unresolved.some(item => item.key === 'event.capacity' || item.key.startsWith('submission.')),
  };
}
