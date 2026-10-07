import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeishuClient, parseBitableTarget, resolveBitableTarget } from '../feishu-client.js';
import { initializeFeishu, planFeishu, writeFeishuIds } from '../feishu-init.js';
import { FEISHU_TABLES } from '../feishu-schema.js';
import { MockFeishu, feishuEnv } from './feishu-fixture.js';
const envWithoutIds = () => Object.fromEntries(Object.entries(feishuEnv).filter(([key]) => !key.endsWith('_TABLE_ID')));
const clientFor = remote => new FeishuClient(feishuEnv, { transport: remote.transport });

test('official base/wiki URL parsing is bounded and wiki resolution verifies the object type', async () => {
  assert.deepEqual(parseBitableTarget('https://tenant.feishu.cn/base/base_mock_only?table=tbl_any'), { type: 'base', token: 'base_mock_only' });
  assert.deepEqual(parseBitableTarget('base_mock_only'), { type: 'base', token: 'base_mock_only' });
  for (const input of ['', 'https://evil.feishu.cn.attacker.org/base/token', 'http://tenant.feishu.cn/base/token', 'https://user:pass@tenant.feishu.cn/base/token', 'https://tenant.feishu.cn/docx/token', 'token/escape', 'https://tenant.feishu.cn:8443/base/token']) assert.throws(() => parseBitableTarget(input));
  const remote = new MockFeishu();
  const env = { ...feishuEnv, FEISHU_BITABLE_URL: 'https://tenant.feishu.cn/wiki/wiki_mock' };
  assert.deepEqual(await resolveBitableTarget(env, clientFor(remote)), { appToken: feishuEnv.FEISHU_BITABLE_APP_TOKEN, sourceType: 'wiki' });
  assert.equal(remote.calls.some(call => call.url.pathname.endsWith('/wiki/v2/spaces/get_node') && call.url.searchParams.get('token') === 'wiki_mock'), true);
  remote.wikiType = 'docx'; await assert.rejects(resolveBitableTarget(env, clientFor(remote)), /not a Bitable/);
  await assert.rejects(resolveBitableTarget({ ...env, FEISHU_BITABLE_APP_TOKEN: 'different_base' }, clientFor(new MockFeishu())), /different resources/);
});

test('plan and dry-run are read-only and expose additive three-table operations with machine status options', async () => {
  for (const mode of ['plan', 'dry-run']) {
    const remote = new MockFeishu({ populated: false });
    const report = await initializeFeishu(envWithoutIds(), { mode, client: clientFor(remote) });
    assert.equal(report.ready, false); assert.equal(report.operations.length, 3); assert.equal(report.conflicts.length, 0);
    assert.deepEqual(report.operations.map(operation => operation.name), ['报名', '投稿', '问答']);
    assert.deepEqual(report.operations[0].fields.find(field => field.field_name === '审核状态').property.options.map(option => option.name), ['under_review', 'accepted', 'rejected', 'needs_materials']);
    assert.equal(remote.writes().length, 0); assert.equal(JSON.stringify(report).includes(feishuEnv.FEISHU_APP_SECRET), false);
    assert.match(report.permissions.appApiScopes, /write scopes not proven/);
  }
});

test('apply requires exact resolved base authorization independently of available API credentials', async () => {
  const remote = new MockFeishu({ populated: false });
  for (const authorizeBase of [undefined, 'another_base', '*']) await assert.rejects(initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase, client: clientFor(remote) }), /exact resolved app token/);
  assert.equal(remote.writes().length, 0);
});

test('applying twice creates three fixed tables once and saves only reloadable non-secret resource IDs', async () => {
  const remote = new MockFeishu({ populated: false }); const client = clientFor(remote);
  const directory = await mkdtemp(join(tmpdir(), 'feishu-ids-test-')); const outputFile = join(directory, '.env.feishu.ids');
  try {
    const first = await initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client, outputFile });
    assert.equal(first.ready, true); assert.equal(first.applied.length, 3); assert.equal(remote.tables.length, 3);
    const second = await initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client, outputFile });
    assert.equal(second.ready, true); assert.equal(second.applied.length, 0); assert.equal(remote.writes().length, 3);
    const content = await readFile(outputFile, 'utf8'); assert.equal(content.includes('SECRET'), false); assert.equal(content.includes('FEISHU_APP_ID='), false);
    for (const [key, value] of Object.entries(first.env)) assert.match(content, new RegExp(`^${key}=${value}$`, 'm'));
    assert.equal((await stat(outputFile)).isFile(), true);
    // Windows mode bits do not represent NTFS ACLs. The same content/secret
    // exclusion and overwrite-preservation assertions run on every platform.
    if (process.platform !== 'win32') assert.equal((await stat(outputFile)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('existing compatible renamed tables are reused and field pagination preserves every required field ID', async () => {
  const remote = new MockFeishu(); for (const table of remote.tables) table.name = `已有_${table.name}`;
  const report = await planFeishu(envWithoutIds(), { client: clientFor(remote) });
  assert.equal(report.ready, true); assert.equal(report.operations.length, 0);
  assert.deepEqual(report.env, Object.fromEntries(Object.entries(feishuEnv).filter(([key]) => key === 'FEISHU_BITABLE_APP_TOKEN' || key.endsWith('_TABLE_ID'))));
  assert.equal(Object.keys(report.tables[1].fieldIds).length, FEISHU_TABLES[1].fields.length);
  assert.ok(remote.calls.some(call => call.url.pathname.endsWith('/fields') && call.url.searchParams.has('page_token')));
  assert.ok(remote.calls.some(call => call.url.pathname.endsWith('/tables') && call.url.searchParams.has('page_token')));
  assert.equal(remote.writes().length, 0);
});

test('missing fields are added once without updating or replacing any existing schema', async () => {
  const remote = new MockFeishu(); remote.table('attendance').fields = remote.table('attendance').fields.filter(field => field.field_name !== '内部备注');
  const before = structuredClone(remote.table('attendance').fields);
  const result = await initializeFeishu(feishuEnv, { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) });
  assert.equal(result.ready, true); assert.equal(result.applied.length, 1); assert.equal(result.applied[0].action, 'create_field');
  for (const field of before) assert.deepEqual(remote.table('attendance').fields.find(current => current.field_id === field.field_id), field);
  assert.equal(remote.writes().length, 1); assert.equal(remote.writes()[0].method, 'POST');
  await initializeFeishu(feishuEnv, { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) });
  assert.equal(remote.writes().length, 1);
});

test('type conflicts and missing status options block all apply operations and retain internal conflict details', async () => {
  for (const change of [table => { table.fields.find(field => field.field_name === '用户ID').type = 2; }, table => { table.fields.find(field => field.field_name === '审核状态').property.options.pop(); }]) {
    const remote = new MockFeishu(); change(remote.table('submission'));
    remote.table('attendance').fields.pop(); // An unrelated additive operation must not run before the conflict is found.
    const before = structuredClone(remote.tables);
    const report = await planFeishu(feishuEnv, { client: clientFor(remote) });
    assert.equal(report.ready, false); assert.ok(report.conflicts.length); assert.equal(report.conflicts[0].kind, 'submission');
    await assert.rejects(initializeFeishu(feishuEnv, { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) }), error => error.report.conflicts.length > 0 && /operator review/.test(error.message));
    assert.equal(remote.writes().length, 0); assert.deepEqual(remote.tables, before);
  }
});

test('ambiguous table names and configured IDs never cause silently created replacement tables', async () => {
  const remote = new MockFeishu(); remote.addTable(FEISHU_TABLES[0], '报名', 'tbl_duplicate');
  const report = await planFeishu(envWithoutIds(), { client: clientFor(remote) });
  assert.equal(report.conflicts.some(conflict => conflict.issue === 'ambiguous_table'), true);
  const missing = await planFeishu({ ...feishuEnv, FEISHU_QUESTION_TABLE_ID: 'tbl_missing' }, { client: clientFor(remote) });
  assert.equal(missing.conflicts.some(conflict => conflict.issue === 'configured_table_not_found'), true);
  assert.equal(missing.operations.some(operation => operation.kind === 'question'), false);
  const reused = await planFeishu({ ...feishuEnv, FEISHU_QUESTION_TABLE_ID: feishuEnv.FEISHU_SUBMISSION_TABLE_ID }, { client: clientFor(remote) });
  assert.equal(reused.conflicts.some(conflict => conflict.issue === 'table_reused_for_multiple_kinds'), true);
  assert.equal(remote.writes().length, 0);
});

test('API scope failures and resource collaborator failures are separately reported without changing permissions', async () => {
  for (const [code, category] of [[99991672, 'app_scope'], [91403, 'resource_permission'], [1254302, 'resource_permission']]) {
    const remote = new MockFeishu(); remote.fail = ({ url }) => url.pathname.includes('/tables') ? remote.response({}, code) : null;
    const report = await planFeishu(feishuEnv, { client: clientFor(remote) });
    assert.equal(report.ready, false); assert.equal(report.errors[0].category, category); assert.equal(report.errors[0].code, code);
    assert.equal(remote.writes().length, 0); assert.equal(remote.calls.some(call => /permission|oauth|member/.test(call.url.pathname)), false);
  }
  const remote = new MockFeishu({ populated: false }); remote.fail = ({ method, url }) => method === 'POST' && url.pathname.endsWith('/tables') ? remote.response({}, 99991672) : null;
  await assert.rejects(initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) }), error => error.report.errors[0].category === 'app_scope' && error.report.applied.length === 0);
});

test('interrupted successful remote table creation is discovered on retry rather than duplicated', async () => {
  const remote = new MockFeishu({ populated: false }); let interrupted = false;
  const transport = async (url, options) => {
    const result = await remote.transport(url, options);
    if (!interrupted && options?.method === 'POST' && new URL(url).pathname.endsWith('/tables')) { interrupted = true; throw new Error('mock network lost after remote commit'); }
    return result;
  };
  const client = new FeishuClient(feishuEnv, { transport });
  await assert.rejects(initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client }), /Completed operations were retained/);
  assert.equal(remote.tables.length, 1);
  const result = await initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client });
  assert.equal(result.ready, true); assert.equal(remote.tables.length, 3); assert.equal(remote.writes().length, 3);
});

test('pagination fails closed on missing or repeated cursors; authentication is cached and refreshable', async () => {
  for (const page_token of [undefined, 'same_cursor']) {
    let pages = 0; const client = new FeishuClient(feishuEnv, { transport: async url => ({ ok: true, json: async () => url.includes('/auth/') ? { code: 0, tenant_access_token: 'mock', expire: 7200 } : (pages++, { code: 0, data: { items: [], has_more: true, page_token } }) }) });
    await assert.rejects(client.list('/bitable/v1/apps/base_mock_only/tables'), /did not advance/); assert.ok(pages <= 2);
  }
  const remote = new MockFeishu(); let now = 0; const client = new FeishuClient(feishuEnv, { transport: remote.transport, now: () => now });
  await client.list('/bitable/v1/apps/base_mock_only/tables'); await client.list('/bitable/v1/apps/base_mock_only/tables');
  assert.equal(remote.calls.filter(call => call.url.pathname.includes('/auth/')).length, 1);
  now = 7200 * 1000; await client.list('/bitable/v1/apps/base_mock_only/tables');
  assert.equal(remote.calls.filter(call => call.url.pathname.includes('/auth/')).length, 2);
});

test('ID persistence refuses to overwrite an existing secret env or other operator-managed file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'feishu-secret-preservation-')); const output = join(directory, '.env');
  try {
    const content = 'FEISHU_APP_SECRET=operator-owned-test-placeholder\n'; await writeFile(output, content);
    await assert.rejects(writeFeishuIds(output, feishuEnv), /Refusing to overwrite/);
    assert.equal(await readFile(output, 'utf8'), content);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent table creation respects the provider name uniqueness constraint and retries converge', async () => {
  const remote = new MockFeishu({ populated: false });
  const results = await Promise.allSettled([initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) }), initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) })]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(remote.tables.length, 3); assert.equal(new Set(remote.tables.map(table => table.name)).size, 3);
  for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.report.errors[0].code, 1254013);
  const retry = await initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: clientFor(remote) });
  assert.equal(retry.ready, true); assert.equal(retry.applied.length, 0); assert.equal(remote.tables.length, 3);
});

test('a concurrently appearing incompatible table blocks subsequent create operations', async () => {
  const remote = new MockFeishu({ populated: false }); let tableReads = 0;
  const transport = async (url, options) => {
    if (options?.method !== 'POST' && new URL(url).pathname.endsWith('/tables') && ++tableReads === 2) {
      const table = remote.addTable(FEISHU_TABLES[0]); table.fields[0].type = 2;
    }
    return remote.transport(url, options);
  };
  await assert.rejects(initializeFeishu(envWithoutIds(), { mode: 'apply', authorizeBase: feishuEnv.FEISHU_BITABLE_APP_TOKEN, client: new FeishuClient(feishuEnv, { transport }) }), error => error.report.conflicts[0].issue === 'field_type' && /appeared/.test(error.message));
  assert.equal(remote.writes().length, 0); assert.equal(remote.tables.length, 1);
});

test('expired tenant token is refreshed exactly once and arbitrary API failures are never automatically retried', async () => {
  let auth = 0, requests = 0;
  const client = new FeishuClient(feishuEnv, { transport: async url => {
    if (url.includes('/auth/')) { auth++; return { ok: true, json: async () => ({ code: 0, tenant_access_token: `mock_${auth}`, expire: 7200 }) }; }
    requests++; return { ok: true, json: async () => requests === 1 ? { code: 99991664 } : { code: 0, data: { items: [], has_more: false } } };
  } });
  await client.list('/bitable/v1/apps/base_mock_only/tables'); assert.equal(auth, 2); assert.equal(requests, 2);
  let rejectedRequests = 0;
  const rejected = new FeishuClient(feishuEnv, { transport: async url => ({ ok: true, json: async () => url.includes('/auth/') ? { code: 0, tenant_access_token: 'mock', expire: 7200 } : (rejectedRequests++, { code: 1254302 }) }) });
  await assert.rejects(rejected.api('/bitable/v1/apps/base_mock_only/tables'), error => error.category === 'resource_permission'); assert.equal(rejectedRequests, 1);
  let expiredRequests = 0;
  const expired = new FeishuClient(feishuEnv, { transport: async url => ({ ok: true, json: async () => url.includes('/auth/') ? { code: 0, tenant_access_token: 'mock', expire: 7200 } : (expiredRequests++, { code: 99991664 }) }) });
  await assert.rejects(expired.api('/bitable/v1/apps/base_mock_only/tables')); assert.equal(expiredRequests, 2);
});

test('read-only integration plan checks record-read access separately from field metadata without exposing record data', async () => {
  const remote = new MockFeishu(); remote.table('attendance').records.push({ record_id: 'rec_private', fields: { '用户ID': 'private-id-never-report', '手机号': 'private-phone-never-report' } });
  const report = await planFeishu(feishuEnv, { client: clientFor(remote) });
  assert.equal(report.ready, true); assert.equal(report.tables.every(table => table.recordsReadable), true);
  assert.equal(JSON.stringify(report).includes('private-id-never-report'), false);
  assert.equal(remote.calls.filter(call => call.url.pathname.endsWith('/records') && call.url.searchParams.get('page_size') === '1').length, 3);
  remote.fail = ({ url }) => url.pathname.endsWith('/records') ? remote.response({}, 99991672) : null;
  const blocked = await planFeishu(feishuEnv, { client: clientFor(remote) });
  assert.equal(blocked.ready, false); assert.equal(blocked.errors[0].category, 'app_scope'); assert.equal(remote.writes().length, 0);
});
