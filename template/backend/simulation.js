const $ = selector => document.querySelector(selector);
const labels = { under_review: '待审核', needs_materials: '需补材料', accepted: '通过 / 录用', rejected: '不通过', draft: '草稿' };
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '请求失败');
  return result;
}
function message(text, error = false) { $('#message').textContent = text; $('#message').className = error ? 'error' : 'success'; }
async function refresh() {
  try {
    const state = await request('/api/simulation/state');
    const stats = state.attendanceStats;
    $('#stats').textContent = `去重后 ${stats.total} 人；容量 ${stats.capacity || '未设置'} 人。${stats.capacityWarning ? '⚠ 已超容量，仅提醒，不阻止审批。' : ''} 同步间隔 ${state.pollSeconds} 秒。${state.syncError ? ` 同步错误：${state.syncError}` : ''}`;
    const fragment = document.createDocumentFragment();
    for (const user of state.users) {
      const row = document.createElement('tr');
      for (const value of [`${user.profile.name || '资料未填写'} / ${user.phone}`, `${labels[user.attendance.status] || '未报名'} ${user.attendance.feedback || ''}`, `${labels[user.submission?.status] || '未投稿'} ${user.submission?.feedback || ''}`, user.attendance.attendanceGranted ? `已获资格 (${user.attendance.grantSources.join(', ')})` : '未获资格']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      fragment.append(row);
    }
    $('#users').replaceChildren(fragment);
    $('#queue').textContent = JSON.stringify(state.pendingReviews, null, 2);
  } catch (error) { message(error.message, true); }
}
$('#review').addEventListener('submit', async event => {
  event.preventDefault();
  try { const values = Object.fromEntries(new FormData(event.target)); const result = await request('/api/simulation/reviews', values); message(result.message); await refresh(); }
  catch (error) { message(error.message, true); }
});
$('#sync').addEventListener('click', async () => { try { const result = await request('/api/simulation/sync', { force: true }); message(`已同步 ${result.applied || 0} 条模拟审核。`); await refresh(); } catch (error) { message(error.message, true); } });
$('#refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 10000);
