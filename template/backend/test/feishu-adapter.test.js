import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { FeishuBitable, SimulationSms } from '../adapters.js';
import { connectDatabase } from '../database.js';
import { createServer } from '../server.js';
import { startLocalPostgres } from '../local-postgres.js';
import { MockFeishu, feishuEnv } from './feishu-fixture.js';

// Real isolated PostgreSQL verifies mapping persistence/uniqueness/recovery. All Feishu HTTP calls are mocks.
let directory, local, admin, db, remote, adapter;
const schema = `test_feishu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const freePort = async () => { const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; };
const profile = { name: '测试参会人', organization: '示例机构', email: 'mock@example.test', identity: '研究生' };
const timestamp = Date.parse('2026-10-07T08:00:00Z');
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'feishu-adapter-pg-test-'));
  let url = process.env.TEST_DATABASE_URL;
  if (!url) { local = await startLocalPostgres({ dataDir: join(directory, 'postgres'), port: await freePort(), persistent: true }); url = local.connectionString; }
  admin = new pg.Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(url); connection.searchParams.set('options', `-c search_path=${schema}`);
  db = await connectDatabase(connection.toString(), 'feishu-adapter-test');
  const windows = { openAt: '2000-01-01T00:00:00Z', closeAt: '2099-01-01T00:00:00Z' };
  await writeFile(join(directory, 'config.json'), JSON.stringify({ event: { slug: 'feishu-adapter-test', title: '飞书协议隔离测试', capacity: 100 }, attendance: windows, submission: windows }));
});
after(async () => {
  await db?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  await local?.stop(); if (directory) await rm(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.query('TRUNCATE users,simulation_sms CASCADE');
  await db.query('INSERT INTO users(id,phone,password_hash,profile,created_at) VALUES($1,$2,$3,$4,$5)', ['user_mock_1', '13800000001', 'unused_test_hash', profile, timestamp]);
  await db.query('INSERT INTO business(user_id,attendance_status,attendance_data,submission_status,submission_data,submission_review_round) VALUES($1,$2,$3,$2,$3,1)', ['user_mock_1', 'under_review', {}]);
  for (const id of ['question_mock_1', 'question_mock_2']) await db.query('INSERT INTO questions(id,user_id,request_id,question,created_at) VALUES($1,$2,$1,$3,$4)', [id, 'user_mock_1', `测试问题 ${id}`, timestamp]);
  remote = new MockFeishu(); adapter = new FeishuBitable(feishuEnv, db, { transport: remote.transport });
});
const attendance = (overrides = {}) => ({ kind: 'attendance', userId: 'user_mock_1', phone: '13800000001', profile, data: { motivation: '参加学术交流' }, status: 'under_review', feedback: '', files: [], ...overrides });
const submission = (overrides = {}) => ({ kind: 'submission', userId: 'user_mock_1', phone: '13800000001', profile, data: { title: '研究题目', note: '作者备注' }, status: 'under_review', feedback: '', reviewRound: 1, files: [], ...overrides });
const question = (id = 'question_mock_1', overrides = {}) => ({ kind: 'question', questionId: id, userId: 'user_mock_1', phone: '13800000001', profile, question: `测试问题 ${id}`, reply: '', createdAt: timestamp, repliedAt: null, files: [], ...overrides });
async function ack(update) {
  if (update.kind === 'question') await db.query('UPDATE question_remote_records SET reply_fingerprint=$1 WHERE question_id=$2', [update.fingerprint, update.question_id]);
  else await db.query('UPDATE remote_records SET review_fingerprint=$1 WHERE kind=$2 AND user_id=$3', [update.fingerprint, update.kind, update.user_id]);
}

test('real Feishu configuration requires all three distinct tables and rejects unknown kinds', () => {
  assert.throws(() => new FeishuBitable({ ...feishuEnv, FEISHU_QUESTION_TABLE_ID: '' }, db), /FEISHU_QUESTION_TABLE_ID/);
  assert.throws(() => new FeishuBitable({ ...feishuEnv, FEISHU_QUESTION_TABLE_ID: feishuEnv.FEISHU_SUBMISSION_TABLE_ID }, db), /three distinct/);
  assert.throws(() => adapter.table('not-a-table'), /Unsupported/);
});

test('local simulation stores SMS privately for CLI access and never returns a verification code', async () => {
  const sms = new SimulationSms(db);
  assert.deepEqual(await sms.send({ phone: '13800000001', purpose: 'register', code: '123456' }), { mode: 'simulation' });
  await sms.send({ phone: '13800000001', purpose: 'register', code: '654321' });
  const result = (await db.query('SELECT * FROM simulation_sms WHERE phone=$1 AND purpose=$2', ['13800000001', 'register'])).rows;
  assert.equal(result.length, 1); assert.equal(result[0].code, '654321');
});

test('three-table export is idempotent, uses stable business keys, and supports multiple questions per user', async () => {
  const records = [attendance(), submission(), question(), question('question_mock_2')];
  await adapter.export(records); await adapter.export(records);
  assert.equal(remote.writes().length, 4); assert.equal(remote.table('attendance').records.length, 1); assert.equal(remote.table('submission').records.length, 1); assert.equal(remote.table('question').records.length, 2);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM remote_records')).rows[0].count, 2);
  const mappings = (await db.query('SELECT * FROM question_remote_records ORDER BY question_id')).rows;
  assert.equal(mappings.length, 2); assert.notEqual(mappings[0].remote_id, mappings[1].remote_id);
  assert.equal(remote.table('question').records[0].fields['提交时间'], timestamp);
  assert.deepEqual(await adapter.pull(), []);
  assert.equal(remote.calls.some(call => /oauth|permissions|members|apps$/.test(call.url.pathname)), false);
});

test('reviews, public feedback, internal notes and question replies are pulled with independent fingerprints', async () => {
  await adapter.export([attendance(), submission(), question(), question('question_mock_2')]);
  const [a] = remote.table('attendance').records; const [s] = remote.table('submission').records; const [q1, q2] = remote.table('question').records;
  a.fields['审核状态'] = 'accepted'; a.fields['反馈'] = [{ text: '报名' }, { text: '通过' }]; a.fields['内部备注'] = [{ text: '内部容量备注' }];
  s.fields['审核状态'] = 'needs_materials'; s.fields['反馈'] = '请补充完整稿'; s.fields['内部备注'] = '内部审稿备注';
  q1.fields['回复'] = '第一条问题的回复'; q2.fields['回复'] = [{ text: '第二条' }, { text: '回复' }];
  const pulled = await adapter.pull(); assert.equal(pulled.length, 4);
  const review = pulled.find(update => update.kind === 'submission');
  assert.deepEqual({ user: review.user_id, decision: review.decision, feedback: review.feedback, round: review.reviewRound, note: review.internalNote }, { user: 'user_mock_1', decision: 'needs_materials', feedback: '请补充完整稿', round: 1, note: '内部审稿备注' });
  assert.equal(pulled.find(update => update.kind === 'attendance').feedback, '报名通过');
  assert.deepEqual(pulled.filter(update => update.kind === 'question').map(update => [update.question_id, update.reply]), [['question_mock_1', '第一条问题的回复'], ['question_mock_2', '第二条回复']]);
  for (const update of pulled) await ack(update); assert.deepEqual(await adapter.pull(), []);
  q1.fields['回复'] = ''; const cleared = await adapter.pull(); assert.equal(cleared.length, 1); assert.equal(cleared[0].reply, '');
});

test('an internal-note-only change under_review is returned without inventing a public review decision', async () => {
  await adapter.export([submission()]); const record = remote.table('submission').records[0];
  record.fields['内部备注'] = '工作人员内部备注';
  const [update] = await adapter.pull(); assert.equal(update.decision, 'under_review'); assert.equal(update.feedback, ''); assert.equal(update.internalNote, '工作人员内部备注'); assert.equal(update.reviewRound, 1);
  await ack(update); assert.deepEqual(await adapter.pull(), []);
});

test('ordinary outbound changes never overwrite staff status, feedback, internal notes or replies', async () => {
  await adapter.export([attendance(), submission(), question()]);
  for (const kind of ['attendance', 'submission']) { const record = remote.table(kind).records[0]; record.fields['审核状态'] = 'accepted'; record.fields['反馈'] = '工作人员刚写的反馈'; record.fields['内部备注'] = '仅工作人员可写'; }
  remote.table('question').records[0].fields['回复'] = '工作人员刚写的回复';
  const changedProfile = { ...profile, organization: '更新后的示例机构' };
  await adapter.export([attendance({ profile: changedProfile, status: 'rejected', feedback: '旧本地反馈' }), submission({ profile: changedProfile, status: 'needs_materials', feedback: '旧本地反馈' }), question('question_mock_1', { profile: changedProfile, reply: '旧本地回复' })]);
  for (const call of remote.writes().slice(3)) {
    for (const field of ['审核状态', '反馈', '内部备注', '回复']) assert.equal(Object.hasOwn(call.body.fields, field), false);
  }
  for (const kind of ['attendance', 'submission']) { const fields = remote.table(kind).records[0].fields; assert.equal(fields['审核状态'], 'accepted'); assert.equal(fields['反馈'], '工作人员刚写的反馈'); assert.equal(fields['内部备注'], '仅工作人员可写'); }
  assert.equal(remote.table('question').records[0].fields['回复'], '工作人员刚写的回复');
  assert.equal((await adapter.pull()).length, 3);
});

test('resubmission resets only the new review round; old-round decisions cannot be returned', async () => {
  await adapter.export([submission()]); const record = remote.table('submission').records[0];
  record.fields['审核状态'] = 'needs_materials'; record.fields['反馈'] = '请补料'; record.fields['内部备注'] = '旧轮内部意见保留';
  const [first] = await adapter.pull(); await ack(first);
  const second = submission({ reviewRound: 2, data: { title: '研究题目', note: '作者备注', supplementNote: '新的补料' } });
  await adapter.export([second]);
  assert.equal(record.fields['审核轮次'], 2); assert.equal(record.fields['审核状态'], 'under_review'); assert.equal(record.fields['反馈'], ''); assert.equal(record.fields['内部备注'], '旧轮内部意见保留');
  assert.deepEqual(await adapter.pull(), []);
  record.fields['审核轮次'] = 1; record.fields['审核状态'] = 'accepted'; record.fields['反馈'] = '延迟旧轮审批'; assert.deepEqual(await adapter.pull(), []);
  record.fields['审核轮次'] = 2; record.fields['反馈'] = '当前轮通过'; const [current] = await adapter.pull(); assert.equal(current.reviewRound, 2); assert.equal(current.feedback, '当前轮通过');
  await assert.rejects(adapter.export([submission({ profile: { ...profile, name: '触发变更' } })]), /newer review round/);
});

test('successful remote review create followed by local save failure recovers by business key without duplicate or lost staff work', async () => {
  let failOnce = true;
  const failingDb = { query: async (sql, params) => { if (failOnce && sql.startsWith('INSERT INTO remote_records')) { failOnce = false; throw new Error('mock local persistence interruption'); } return db.query(sql, params); } };
  const firstAdapter = new FeishuBitable(feishuEnv, failingDb, { transport: remote.transport });
  await assert.rejects(firstAdapter.export([attendance()]), /persistence interruption/);
  assert.equal(remote.table('attendance').records.length, 1); assert.equal((await db.query('SELECT * FROM remote_records')).rows.length, 0);
  const record = remote.table('attendance').records[0]; record.fields['审核状态'] = 'accepted'; record.fields['反馈'] = '恢复前已审核'; record.fields['内部备注'] = '不要覆盖';
  adapter = new FeishuBitable(feishuEnv, db, { transport: remote.transport }); await adapter.export([attendance()]);
  assert.equal(remote.table('attendance').records.length, 1); assert.equal(remote.writes().filter(call => call.method === 'POST').length, 1);
  assert.equal(record.fields['审核状态'], 'accepted'); assert.equal(record.fields['反馈'], '恢复前已审核');
  const [update] = await adapter.pull(); assert.equal(update.decision, 'accepted'); assert.equal(update.internalNote, '不要覆盖');
});

test('question create/local-save recovery maps each question independently and preserves replies', async () => {
  let failOnce = true;
  const failingDb = { query: async (sql, params) => { if (failOnce && sql.startsWith('INSERT INTO question_remote_records')) { failOnce = false; throw new Error('mock question mapping interruption'); } return db.query(sql, params); } };
  await assert.rejects(new FeishuBitable(feishuEnv, failingDb, { transport: remote.transport }).export([question()]), /mapping interruption/);
  remote.table('question').records[0].fields['回复'] = '映射恢复前的回复';
  await adapter.export([question(), question('question_mock_2')]);
  assert.equal(remote.table('question').records.length, 2); assert.equal(remote.writes().filter(call => call.method === 'POST').length, 2);
  const updates = await adapter.pull(); assert.equal(updates.length, 1); assert.equal(updates[0].question_id, 'question_mock_1'); assert.equal(updates[0].reply, '映射恢复前的回复');
});

test('lost network response after remote record creation can retry with a stable official UUIDv4 token', async () => {
  let failOnce = true;
  const transport = async (url, options) => {
    const result = await remote.transport(url, options);
    if (failOnce && options?.method === 'POST' && new URL(url).pathname.endsWith('/records')) { failOnce = false; throw new Error('mock response lost after commit'); }
    return result;
  };
  await assert.rejects(new FeishuBitable(feishuEnv, db, { transport }).export([submission()]), /response lost/);
  await adapter.export([submission()]);
  assert.equal(remote.table('submission').records.length, 1); assert.equal(remote.writes().filter(call => call.method === 'POST').length, 1);
  assert.equal(adapter.createToken('submission', 'user_mock_1'), new FeishuBitable(feishuEnv, db).createToken('submission', 'user_mock_1'));
  assert.notEqual(adapter.createToken('question', 'question_mock_1'), adapter.createToken('question', 'question_mock_2'));
});

test('attachment uploads use the existing private media protocol and persist token cache in real PostgreSQL', async () => {
  const content = Buffer.from('%PDF-1.7\nmock-file-only');
  const file = { id: 'file_mock_local', name: '稿件.pdf', mime: 'application/pdf', size: content.length, content };
  await db.query('INSERT INTO files(id,user_id,name,mime,size,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [file.id, 'user_mock_1', file.name, file.mime, file.size, file.content, timestamp]);
  await adapter.export([submission({ files: [file] })]);
  assert.deepEqual(remote.table('submission').records[0].fields['附件'], [{ file_token: 'file_mock_1' }]);
  await adapter.export([submission({ files: [file], profile: { ...profile, name: '变更姓名' } })]);
  assert.equal(remote.calls.filter(call => call.url.pathname.endsWith('/medias/upload_all')).length, 1);
  assert.equal((await db.query('SELECT * FROM feishu_files')).rows[0].file_token, 'file_mock_1');
});

test('duplicate, tampered, missing or foreign stable mappings fail closed; phone numbers never identify records', async () => {
  remote.table('attendance').records.push({ record_id: 'rec_unowned', fields: { '手机号': '13800000001', '姓名': profile.name, '审核状态': 'accepted' } });
  await adapter.export([attendance()]); assert.equal(remote.table('attendance').records.length, 2); assert.deepEqual(await adapter.pull(), []);
  const mapped = remote.table('attendance').records[1];
  remote.table('attendance').records.push({ record_id: 'rec_duplicate', fields: { ...mapped.fields } });
  await assert.rejects(adapter.export([attendance()]), /Duplicate stable business key/); await assert.rejects(adapter.pull(), /Duplicate stable business key/);
  remote.table('attendance').records.pop(); mapped.fields['用户ID'] = 'tampered_user';
  await assert.rejects(adapter.pull(), /no longer matches/); await assert.rejects(adapter.export([attendance()]), /mapping conflicts/);
  remote.table('attendance').records.pop(); await assert.rejects(adapter.export([attendance()]), /mapped Feishu record is missing/);
  remote.table('question').records.push({ record_id: 'rec_foreign_question', fields: { '问题ID': 'question_mock_1', '用户ID': 'different_user' } });
  await assert.rejects(adapter.export([question()]), /different local user/);
});

test('one export batch shares table pagination and optionally isolates per-record failures', async () => {
  const records = [];
  for (let i = 0; i < 8; i++) {
    const id = `user_batch_${i}`; const phone = `13900000${String(i).padStart(3, '0')}`;
    await db.query('INSERT INTO users(id,phone,password_hash,profile,created_at) VALUES($1,$2,$3,$4,$5)', [id, phone, 'unused', profile, timestamp]);
    records.push(attendance({ userId: id, phone }));
  }
  const first = records[0]; records[0] = { ...first, status: 'unsupported_status' };
  const result = await adapter.export([...records, question()], { continueOnError: true });
  assert.equal(result.errors.length, 1); assert.equal(result.errors[0].key, 'user_batch_0');
  assert.equal(remote.table('attendance').records.length, 7); assert.equal(remote.table('question').records.length, 1);
  assert.equal(remote.calls.filter(call => call.method === 'GET' && call.url.pathname.endsWith('/tbl_attendance/records')).length, 1);
  assert.equal(remote.calls.filter(call => call.method === 'GET' && call.url.pathname.endsWith('/tbl_question/records')).length, 1);
  await adapter.export([first], { continueOnError: true }); assert.equal(remote.table('attendance').records.length, 8);
});

test('an inaccessible table fails once per batch while unrelated table exports continue', async () => {
  remote.fail = ({ url }) => url.pathname.includes('/tbl_submission/') ? remote.response({}, 1254302) : null;
  const result = await adapter.export([submission(), submission({ userId: 'another-user' }), question()], { continueOnError: true });
  assert.equal(result.errors.length, 2); assert.equal(result.errors[0].category, 'resource_permission'); assert.equal(remote.table('question').records.length, 1);
  assert.equal(remote.calls.filter(call => call.method === 'GET' && call.url.pathname.includes('/tbl_submission/')).length, 1);
});

test('pull optionally isolates table permission failures so unrelated replies and reviews are still returned', async () => {
  await adapter.export([attendance(), submission(), question()]);
  remote.table('attendance').records[0].fields['审核状态'] = 'accepted'; remote.table('question').records[0].fields['回复'] = '正常问答回复';
  remote.fail = ({ url }) => url.pathname.includes('/tbl_submission/') ? remote.response({}, 1254302) : null;
  await assert.rejects(adapter.pull(), error => error.category === 'resource_permission');
  const updates = await adapter.pull(timestamp, false, { continueOnError: true });
  assert.deepEqual(updates.map(update => update.kind), ['attendance', 'question']);
  assert.equal(updates.errors.length, 1); assert.equal(updates.errors[0].kind, 'submission'); assert.equal(updates.errors[0].category, 'resource_permission');
});

test('pull isolates a tampered mapped row while other users in the same table and other tables continue', async () => {
  await db.query('INSERT INTO users(id,phone,password_hash,profile,created_at) VALUES($1,$2,$3,$4,$5)', ['user_mock_2', '13800000002', 'unused', profile, timestamp]);
  await adapter.export([attendance(), attendance({ userId: 'user_mock_2', phone: '13800000002' }), question()]);
  remote.table('attendance').records[0].fields['用户ID'] = 'tampered_user'; remote.table('attendance').records[1].fields['审核状态'] = 'accepted'; remote.table('question').records[0].fields['回复'] = '另一表回复';
  const updates = await adapter.pull(timestamp, false, { continueOnError: true });
  assert.equal(updates.length, 2); assert.equal(updates[0].user_id, 'user_mock_2'); assert.equal(updates[1].kind, 'question');
  assert.equal(updates.errors.length, 1); assert.equal(updates.errors[0].remote_id, remote.table('attendance').records[0].record_id);
});

async function syncServer() {
  return createServer({ appRoot: directory, pool: db, mode: 'real', publicOrigin: 'https://mock.example.test', env: { FEISHU_MODE: 'real' }, smsAdapter: { send: async () => { throw new Error('This integration test must never send SMS.'); } }, feishuAdapter: adapter, autoSync: false, now: () => timestamp });
}

test('actual server sync applies three-table mocked protocol updates through real database transactions', async () => {
  const server = await syncServer();
  try {
    await server.syncReviews();
    remote.table('submission').records[0].fields['审核状态'] = 'accepted'; remote.table('submission').records[0].fields['反馈'] = '录用反馈'; remote.table('submission').records[0].fields['内部备注'] = '内部记录';
    remote.table('question').records[0].fields['回复'] = '第一条答复'; remote.table('question').records[1].fields['回复'] = '第二条答复';
    const synced = await server.syncReviews(); assert.equal(synced.applied, 3);
    const business = (await db.query('SELECT * FROM business WHERE user_id=$1', ['user_mock_1'])).rows[0];
    assert.equal(business.submission_status, 'accepted'); assert.equal(business.submission_feedback, '录用反馈'); assert.equal(business.submission_internal_note, '内部记录');
    const questions = (await db.query('SELECT reply,replied_at FROM questions ORDER BY id')).rows;
    assert.deepEqual(questions.map(row => row.reply), ['第一条答复', '第二条答复']); assert.ok(questions.every(row => Number(row.replied_at) === timestamp));
    assert.equal((await server.syncReviews()).applied, 0);
    const health = (await db.query('SELECT * FROM sync_health WHERE id=1')).rows[0]; assert.equal(health.consecutive_failures, 0); assert.equal(health.last_error, null);
    assert.equal(remote.writes().filter(call => call.method === 'POST' && call.url.pathname.endsWith('/records')).length, 4);
  } finally { await server.shutdown(); }
});

test('actual server rejects an old-round read before exporting the new supplement round', async () => {
  const server = await syncServer();
  try {
    await server.syncReviews();
    const record = remote.table('submission').records[0]; record.fields['审核状态'] = 'accepted'; record.fields['反馈'] = '延迟旧轮审核';
    await db.query("UPDATE business SET submission_review_round=2,submission_status='under_review',submission_feedback='',submission_data=$1 WHERE user_id=$2", [{ title: '新轮稿件', supplementNote: '新补料' }, 'user_mock_1']);
    const synced = await server.syncReviews(); assert.equal(synced.applied, 0);
    assert.equal((await db.query('SELECT submission_status FROM business')).rows[0].submission_status, 'under_review');
    assert.equal((await db.query('SELECT * FROM review_history')).rows.length, 0);
    assert.equal(record.fields['审核轮次'], 2); assert.equal(record.fields['审核状态'], 'under_review'); assert.equal(record.fields['反馈'], '');
    record.fields['审核状态'] = 'accepted'; record.fields['反馈'] = '新轮审核通过';
    assert.equal((await server.syncReviews()).applied, 1);
    const history = (await db.query('SELECT * FROM review_history')).rows; assert.equal(history.length, 1); assert.equal(history[0].review_round, 2);
  } finally { await server.shutdown(); }
});
