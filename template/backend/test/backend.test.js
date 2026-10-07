import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { createServer } from '../server.js';
import { businessReadiness } from '../readiness.js';
import { checkIntegration } from '../check.js';
import { startLocalPostgres } from '../local-postgres.js';
import { detectDocument } from '../files.js';

let root, local, admin, server, dbUrl, origin, clock = Date.now(), phoneIndex = 100;
const openWindow = { openAt: '2000-01-01T00:00:00Z', closeAt: '2099-01-01T00:00:00Z' };
const baseConfig = { event: { slug: 'test-conference', title: '测试学术会议', capacity: 1 }, attendance: { ...openWindow }, submission: { ...openWindow }, files: { maxFileBytes: 20 * 1048576, maxAttachments: 3, allowedExtensions: ['pdf', 'docx', 'pptx'] }, sync: { pollSeconds: 60 } };
const pdf = Buffer.from('%PDF-2.0\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n').toString('base64');
const freePort = async () => { const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; };
const schema = `test_event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'event-backend-test-'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'index.html'), '<html><body>Event SPA</body></html>');
  let url = process.env.TEST_DATABASE_URL;
  if (!url) { local = await startLocalPostgres({ dataDir: join(root, 'postgres'), port: await freePort(), persistent: true }); url = local.connectionString; }
  admin = new pg.Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection = new URL(url);
  connection.searchParams.set('options', `-c search_path=${schema}`);
  dbUrl = connection.toString();
  await writeFile(join(root, 'config.json'), JSON.stringify(baseConfig));
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  server = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false, now: () => clock, onError: error => console.error(error) });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
});
after(async () => {
  await server?.shutdown();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  await local?.stop();
  if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
  clock += 3600001;
  await server.database.query('TRUNCATE users,sms_codes CASCADE');
  await writeFile(join(root, 'config.json'), JSON.stringify(baseConfig));
});

async function call(path, { method = 'GET', body, cookie, badOrigin, raw = false } = {}) {
  const response = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { origin: badOrigin || origin } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: raw ? await response.text() : await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
}
async function account({ complete = true } = {}) {
  const phone = `1380000${String(phoneIndex++).padStart(4, '0')}`;
  const sms = await call('/api/auth/sms/request', { method: 'POST', body: { phone, purpose: 'register' } });
  assert.equal(sms.status, 200); assert.equal(sms.body.simulationCode, undefined); sms.body.simulationCode = (await server.database.query('SELECT code FROM simulation_sms WHERE phone=$1 AND purpose=$2', [`+86${phone}`, 'register'])).rows[0].code; assert.match(sms.body.simulationCode, /^\d{6}$/);
  const registration = await call('/api/auth/register', { method: 'POST', body: { phone, password: 'Password-1234', code: sms.body.simulationCode } });
  assert.equal(registration.status, 201);
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/); assert.match(registration.headers.get('set-cookie'), /SameSite=Strict/);
  const user = { phone, cookie: registration.cookie, id: registration.body.user.id };
  if (complete) {
    const profile = await call('/api/me/profile', { method: 'PATCH', cookie: user.cookie, body: { name: '王同学', email: 'academic@example.org', organization: '示例大学', identity: '博士研究生', researchDirection: '人工智能' } });
    assert.equal(profile.status, 200); assert.equal(profile.body.complete, true);
  }
  return user;
}
async function upload(user, name = 'paper.pdf', contentBase64 = pdf) {
  const response = await call('/api/me/files', { method: 'POST', cookie: user.cookie, body: { name, contentBase64 } });
  assert.equal(response.status, 201); return response.body.file;
}
async function draft(user, overrides = {}) {
  const file = await upload(user);
  const body = { title: '学术研究题目', abstract: '本研究提出并验证新的方法。', keywords: ['算法', '实验'], authors: [{ name: '王同学', affiliation: '示例大学' }], presenter: '王同学', note: '', attachmentIds: [file.id], ...overrides };
  const response = await call('/api/me/submission', { method: 'PUT', cookie: user.cookie, body });
  assert.equal(response.status, 200); return response.body.submission;
}
async function submit(user) { await draft(user); const response = await call('/api/me/submission/submit', { method: 'POST', cookie: user.cookie, body: {} }); assert.equal(response.status, 200); return response.body.submission; }
async function review(user, kind, decision, feedback = '') {
  const queued = await server.queueSimulationReview({ phone: user.phone, kind, decision, feedback });
  return { status: 202, body: { review: queued } };
}
async function sync(force = true) { return server.syncReviews({ force }); }


 test('SMS registration sets a bcrypt12 password; phone/password login and reset invalidate all sessions', async () => {
  const user = await account();
  const saved = (await server.database.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0];
  assert.match(saved.password_hash, /^\$2[ab]\$12\$/);
  const login = await call('/api/auth/login', { method: 'POST', body: { phone: user.phone, password: 'Password-1234' } });
  assert.equal(login.status, 200);
  const sms = await call('/api/auth/sms/request', { method: 'POST', body: { phone: user.phone, purpose: 'reset' } });
  assert.equal(sms.status, 200);
  sms.body.simulationCode = (await server.database.query("SELECT code FROM simulation_sms WHERE phone=$1 AND purpose='reset'", [`+86${user.phone}`])).rows[0].code;
  const reset = await call('/api/auth/reset', { method: 'POST', body: { phone: user.phone, code: sms.body.simulationCode, password: 'Changed-Password-1234' } });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/me/profile', { cookie: user.cookie })).status, 401);
  assert.equal((await call('/api/me/profile', { cookie: login.cookie })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { phone: user.phone, password: 'Password-1234' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { phone: user.phone, password: 'Changed-Password-1234' } })).status, 200);
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { phone: user.phone, code: sms.body.simulationCode, password: 'Third-Password-1234' } })).status, 400);
});

test('private files require session + owner, genuine file contents and attachment limits', async () => {
  const owner = await account(), other = await account(), file = await upload(owner);
  assert.equal((await call(`/api/me/files/${file.id}`, { raw: true })).status, 401);
  assert.equal((await call(`/api/me/files/${file.id}`, { cookie: other.cookie, raw: true })).status, 404);
  const downloaded = await call(`/api/me/files/${file.id}`, { cookie: owner.cookie, raw: true });
  assert.equal(downloaded.status, 200); assert.match(downloaded.body, /^%PDF-2\.0/); assert.match(downloaded.headers.get('content-disposition'), /^attachment/);
  assert.equal((await call('/api/me/files', { method: 'POST', cookie: owner.cookie, body: { name: 'fake.pdf', contentBase64: Buffer.from('not a PDF').toString('base64') } })).status, 400);
  assert.equal((await call('/api/me/submission', { method: 'PUT', cookie: other.cookie, body: { attachmentIds: [file.id] } })).status, 403);
  const files = [file, await upload(owner), await upload(owner), await upload(owner)];
  assert.equal((await call('/api/me/submission', { method: 'PUT', cookie: owner.cookie, body: { attachmentIds: files.map(x => x.id) } })).status, 400);
  assert.equal((await call('/api/me/files', { method: 'POST', cookie: owner.cookie, badOrigin: 'https://evil.example', body: { name: 'a.pdf', contentBase64: pdf } })).status, 403);
});

test('attendee application and online submission are independent; draft validation and profile locking', async () => {
  const attendee = await account();
  assert.equal((await call('/api/me/submission', { cookie: attendee.cookie })).body.submission, null);
  const application = await call('/api/me/attendance', { method: 'POST', cookie: attendee.cookie, body: { motivation: '交流学习' } });
  assert.equal(application.status, 201); assert.equal(application.body.attendance.status, 'under_review');
  assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: attendee.cookie, body: { name: '更改名字' } })).status, 409);
  assert.equal((await call('/api/me/attendance', { method: 'POST', cookie: attendee.cookie, body: {} })).status, 409);
  const author = await account();
  const submitted = await submit(author); assert.equal(submitted.status, 'under_review');
  assert.equal((await call('/api/me/attendance', { cookie: author.cookie })).body.attendance.status, null);
  const incomplete = await account({ complete: false }); await draft(incomplete);
  assert.equal((await call('/api/me/submission/submit', { method: 'POST', cookie: incomplete.cookie, body: {} })).status, 409);
});

test('pending -> feedback -> supplement -> accepted uses delayed shared review-sync path', async () => {
  const user = await account(); const initialSubmission = await submit(user); assert.equal(initialSubmission.reviewRound, 1);
  await review(user, 'submission', 'needs_materials', '请补充完整版');
  assert.equal((await sync(false)).applied, 0);
  assert.equal((await call('/api/me/submission', { cookie: user.cookie })).body.submission.status, 'under_review');
  clock += 60001; assert.equal((await sync(false)).applied, 1);
  let submission = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
  assert.equal(submission.status, 'needs_materials'); assert.equal(submission.feedback, '请补充完整版');
  assert.equal((await call('/api/me/submission', { method: 'PUT', cookie: user.cookie, body: submission })).status, 409);
  assert.equal((await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { title: '不允许改标题' } })).status, 400);
  const replacement = await upload(user, 'replacement.pdf');
  const supplement = await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { note: '已补充全文', attachmentIds: [replacement.id] } });
  assert.equal(supplement.status, 200); assert.equal(supplement.body.submission.status, 'under_review'); assert.equal(supplement.body.submission.title, submission.title); assert.equal(supplement.body.submission.reviewRound, 2);
  await review(user, 'submission', 'accepted', '录用'); await sync();
  submission = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
  assert.equal(submission.status, 'accepted'); assert.equal(submission.reviewRound, 2);
  const attendance = (await call('/api/me/attendance', { cookie: user.cookie })).body.attendance;
  assert.equal(attendance.attendanceGranted, true); assert.deepEqual(attendance.grantSources, ['accepted_submission']);
  assert.equal((await call('/api/me/submission/submit', { method: 'POST', cookie: user.cookie, body: {} })).status, 409);
  assert.equal((await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { note: '录用后修改' } })).status, 409);
  await review(user, 'submission', 'rejected', '更正录用结果'); await sync();
  const corrected = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
  assert.equal(corrected.status, 'rejected'); assert.equal(corrected.reviewRound, 2);
});

test('deduplicated capacity only warns, never blocks; corrections preserve separate manual attendance', async () => {
  const first = await account(), second = await account();
  await call('/api/me/attendance', { method: 'POST', cookie: first.cookie, body: {} });
  await submit(first); await submit(second);
  await review(first, 'attendance', 'accepted'); await review(first, 'submission', 'accepted'); await sync();
  let data = (await call('/api/me/attendance', { cookie: first.cookie })).body;
  assert.equal(data.attendanceStats.total, 1); assert.equal(data.attendanceStats.capacityWarning, true); assert.equal(data.attendance.grantSources.length, 2);
  await review(second, 'submission', 'accepted'); await sync();
  data = (await call('/api/me/attendance', { cookie: first.cookie })).body; assert.equal(data.attendanceStats.total, 2);
  await review(first, 'submission', 'rejected', '更正原结果'); await sync();
  data = (await call('/api/me/attendance', { cookie: first.cookie })).body; assert.equal(data.attendanceStats.total, 2); assert.deepEqual(data.attendance.grantSources, ['manual_attendance']);
  await review(first, 'attendance', 'rejected'); await sync();
  data = (await call('/api/me/attendance', { cookie: first.cookie })).body; assert.equal(data.attendanceStats.total, 1); assert.equal(data.attendance.attendanceGranted, false);
  await review(second, 'submission', 'rejected'); await sync();
  assert.equal((await call('/api/me/attendance', { cookie: second.cookie })).body.attendanceStats.total, 0);
  const audits = await server.database.query('SELECT count(*)::int AS count FROM review_history'); assert.equal(audits.rows[0].count, 6);
});

test('config regeneration changes public content without erasing accounts, files or submitted business data', async () => {
  const user = await account(); await submit(user); await review(user, 'submission', 'accepted'); await sync();
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...baseConfig, event: { ...baseConfig.event, title: '更新后的活动标题', capacity: 100 } }));
  const publicData = await call('/api/public/config'); assert.equal(publicData.body.config.event.title, '更新后的活动标题');
  const submitted = (await call('/api/me/submission', { cookie: user.cookie })).body.submission; assert.equal(submitted.status, 'accepted');
  assert.equal((await call('/api/me/files/' + submitted.attachmentIds[0], { cookie: user.cookie, raw: true })).status, 200);
  const rows = await server.database.query('SELECT count(*)::int AS count FROM users'); assert.equal(rows.rows[0].count, 1);
  const restarted = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false, now: () => clock });
  assert.equal((await restarted.database.query('SELECT submission_status FROM business WHERE user_id=$1', [user.id])).rows[0].submission_status, 'accepted');
  await restarted.shutdown();
});

test('unknown event capacity/windows permit SMS auth, profile, private upload and draft but reject both final applications without mutation', async () => {
  const unknown = { ...baseConfig, event: { ...baseConfig.event, capacity: null, startDate: '2026-09-05', endDate: '2026-09-08', startAt: null, endAt: null }, attendance: { openAt: null, closeAt: null }, submission: { openAt: null, closeAt: null, supplementCloseAt: null }, readiness: { mode: 'ready', unresolved: [], attendanceEnabled: true, submissionEnabled: true } };
  await writeFile(join(root, 'config.json'), JSON.stringify(unknown));
  const publicData = await call('/api/public/config');
  assert.equal(publicData.status, 200); assert.equal(publicData.body.readiness, undefined); assert.equal(publicData.body.runtime, undefined);
  assert.equal(publicData.body.config.readiness, undefined);
  assert.equal(publicData.body.config.event.capacity, null); assert.equal(publicData.body.config.event.startAt, null); assert.equal(publicData.body.config.event.startDate, '2026-09-05');
  assert.deepEqual(businessReadiness(unknown).unresolved.map(item => item.key), ['event.capacity', 'attendance.openAt', 'attendance.closeAt', 'submission.openAt', 'submission.closeAt']);
  assert.equal(businessReadiness(unknown).attendanceEnabled, false); assert.equal(businessReadiness(unknown).submissionEnabled, false);
  const user = await account();
  const login = await call('/api/auth/login', { method: 'POST', body: { phone: user.phone, password: 'Password-1234' } }); assert.equal(login.status, 200);
  assert.equal((await call('/api/me/profile', { cookie: login.cookie })).status, 200);
  const prepared = await draft(user); assert.equal(prepared.status, 'draft'); assert.equal(prepared.reviewRound, 0);
  assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: user.cookie, body: { department: '预览时补充资料' } })).status, 200);
  const before = (await server.database.query('SELECT to_jsonb(b) AS data FROM business b WHERE user_id=$1', [user.id])).rows[0].data;
  for (const path of ['/api/me/attendance', '/api/me/submission/submit']) {
    const refused = await call(path, { method: 'POST', cookie: user.cookie, body: {} });
    assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'APPLICATION_UNAVAILABLE'); assert.match(refused.body.error.message, /暂未开放/); assert.equal(refused.body.error.unresolved, undefined);
  }
  assert.deepEqual((await server.database.query('SELECT to_jsonb(b) AS data FROM business b WHERE user_id=$1', [user.id])).rows[0].data, before);
  const attendance = await call('/api/me/attendance', { cookie: user.cookie }); assert.equal(attendance.body.attendanceStats.capacity, null); assert.equal(attendance.body.attendanceStats.capacityWarning, false);
  assert.equal((await server.database.query('SELECT count(*)::int AS count FROM review_history')).rows[0].count, 0);
  assert.equal((await call('/api/me/files/' + prepared.attachmentIds[0], { cookie: user.cookie, raw: true })).status, 200);
});

test('each unresolved operational field disables only affected final routes, including invalid or backwards windows', async () => {
  const user = await account(); await draft(user);
  const cases = [
    ['event.capacity', cfg => { cfg.event.capacity = null; }, false, false],
    ['attendance.openAt', cfg => { cfg.attendance.openAt = null; }, false, true],
    ['attendance.closeAt', cfg => { delete cfg.attendance.closeAt; }, false, true],
    ['submission.openAt', cfg => { cfg.submission.openAt = null; }, true, false],
    ['submission.closeAt', cfg => { cfg.submission.closeAt = null; }, true, false],
    ['submission.closeAt', cfg => { cfg.submission.closeAt = 'not-a-date'; }, true, false],
    ['submission.closeAt', cfg => { cfg.submission.closeAt = cfg.submission.openAt; }, true, false],
  ];
  for (const [key, change, attendanceEnabled, submissionEnabled] of cases) {
    const cfg = structuredClone(baseConfig); change(cfg); await writeFile(join(root, 'config.json'), JSON.stringify(cfg));
    assert.equal((await call('/api/public/config')).body.readiness, undefined);
    const data = businessReadiness(cfg);
    assert.equal(data.mode, 'preview'); assert.equal(data.attendanceEnabled, attendanceEnabled, key); assert.equal(data.submissionEnabled, submissionEnabled, key);
    assert.ok(data.unresolved.some(item => item.key === key));
    for (const [path, enabled] of [['/api/me/attendance', attendanceEnabled], ['/api/me/submission/submit', submissionEnabled]]) {
      if (enabled) continue;
      const refused = await call(path, { method: 'POST', cookie: user.cookie, body: {} }); assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'APPLICATION_UNAVAILABLE');
      assert.equal(refused.body.error.unresolved, undefined);
    }
  }
  await writeFile(join(root, 'config.json'), JSON.stringify(baseConfig));
  assert.equal((await call('/api/public/config')).body.readiness, undefined); assert.equal(businessReadiness(baseConfig).mode, 'ready');
  assert.equal((await call('/api/me/attendance', { method: 'POST', cookie: user.cookie, body: {} })).status, 201);
  const submitted = await call('/api/me/submission/submit', { method: 'POST', cookie: user.cookie, body: {} }); assert.equal(submitted.status, 200); assert.equal(submitted.body.submission.reviewRound, 1);
});

test('same-event unresolved regeneration preserves submitted rows/private files; staff approvals and corrections remain available with unknown capacity', async () => {
  const user = await account(); const prepared = await submit(user);
  assert.equal((await call('/api/me/attendance', { method: 'POST', cookie: user.cookie, body: {} })).status, 201);
  const before = (await server.database.query('SELECT to_jsonb(b) AS data FROM business b WHERE user_id=$1', [user.id])).rows[0].data;
  const unknown = { ...baseConfig, event: { ...baseConfig.event, capacity: null }, attendance: { openAt: null, closeAt: null }, submission: { openAt: null, closeAt: null, supplementCloseAt: null } };
  await writeFile(join(root, 'config.json'), JSON.stringify(unknown));
  assert.equal((await call('/api/public/config')).body.readiness, undefined); assert.equal(businessReadiness(unknown).mode, 'preview');
  assert.deepEqual((await server.database.query('SELECT to_jsonb(b) AS data FROM business b WHERE user_id=$1', [user.id])).rows[0].data, before);
  const restarted = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false, now: () => clock });
  try { assert.deepEqual((await restarted.database.query('SELECT to_jsonb(b) AS data FROM business b WHERE user_id=$1', [user.id])).rows[0].data, before); } finally { await restarted.shutdown(); }
  for (const kind of ['submission', 'attendance']) await review(user, kind, 'accepted'); await sync();
  let attendance = (await call('/api/me/attendance', { cookie: user.cookie })).body;
  assert.equal(attendance.attendanceStats.total, 1); assert.equal(attendance.attendanceStats.capacity, null); assert.equal(attendance.attendanceStats.capacityWarning, false); assert.deepEqual(attendance.attendance.grantSources, ['manual_attendance', 'accepted_submission']);
  await review(user, 'submission', 'needs_materials', '修正结果'); await sync();
  const refused = await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { note: '资料待确认期间尝试补交' } });
  assert.equal(refused.status, 409); assert.equal(refused.body.error.code, 'APPLICATION_UNAVAILABLE');
  assert.equal((await call('/api/me/submission', { cookie: user.cookie })).body.submission.reviewRound, 1);
  attendance = (await call('/api/me/attendance', { cookie: user.cookie })).body; assert.deepEqual(attendance.attendance.grantSources, ['manual_attendance']);
  await review(user, 'attendance', 'rejected'); await review(user, 'submission', 'accepted'); await sync();
  attendance = (await call('/api/me/attendance', { cookie: user.cookie })).body;
  assert.deepEqual(attendance.attendance.grantSources, ['accepted_submission']); assert.equal(attendance.attendanceStats.total, 1); assert.equal(attendance.attendanceStats.capacityWarning, false);
  assert.equal((await call('/api/me/files/' + prepared.attachmentIds[0], { cookie: user.cookie, raw: true })).status, 200);
  assert.equal((await server.database.query('SELECT count(*)::int AS count FROM users')).rows[0].count, 1);
  const submission = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
  assert.equal(submission.status, 'accepted'); assert.equal(submission.reviewRound, 1); assert.equal(submission.title, prepared.title);
});

test('Feishu-sourced review corrections keep their original business boundary in factual preview, using mocked provider transport', async () => {
  const user = await account(); await submit(user);
  assert.equal((await call('/api/me/attendance', { method: 'POST', cookie: user.cookie, body: {} })).status, 201);
  await review(user, 'attendance', 'accepted'); await sync();
  const cfg = { ...baseConfig, event: { ...baseConfig.event, capacity: null }, attendance: { openAt: null, closeAt: null }, submission: { openAt: null, closeAt: null } };
  await writeFile(join(root, 'config.json'), JSON.stringify(cfg));
  await server.database.query("INSERT INTO remote_records(kind,user_id,remote_id,snapshot,review_fingerprint) VALUES('submission',$1,'mock-review-record','initial','initial')", [user.id]);
  let pending = [], exported = [];
  const staff = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: 'https://event.example.org', mode: 'real', smsAdapter: { send: async () => ({ mode: 'real' }) }, feishuAdapter: { pull: async () => pending.splice(0), export: async rows => { exported = rows; } }, autoSync: false, now: () => clock });
  try {
    for (const decision of ['accepted', 'needs_materials', 'accepted', 'rejected']) {
      pending.push({ user_id: user.id, kind: 'submission', reviewRound: 1, decision, feedback: '飞书模拟传输更正', remote_id: 'mock-review-record', fingerprint: `changed-${decision}-${clock++}` });
      assert.equal((await staff.syncReviews()).applied, 1);
      const state = (await call('/api/me/attendance', { cookie: user.cookie })).body;
      assert.equal(state.attendanceStats.total, 1); assert.equal(state.attendanceStats.capacity, null); assert.equal(state.attendanceStats.capacityWarning, false);
      assert.deepEqual(state.attendance.grantSources, decision === 'accepted' ? ['manual_attendance', 'accepted_submission'] : ['manual_attendance']);
      const submission = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
      assert.equal(submission.status, decision); assert.equal(submission.reviewRound, 1);
      assert.equal(exported.find(record => record.kind === 'submission').status, decision);
    }
    assert.equal((await server.database.query("SELECT count(*)::int AS count FROM review_history WHERE source='feishu'")).rows[0].count, 4);
  } finally { await staff.shutdown(); }
});

test('event windows, identity tampering, SMS retry limits and missing authentication fail safely', async () => {
  const user = await account();
  assert.equal((await call('/api/me/profile', { method: 'PATCH', cookie: user.cookie, body: { phone: '13900009999' } })).status, 400);
  const config = { ...baseConfig, submission: { ...baseConfig.submission, closeAt: new Date(clock - 1).toISOString() } }; await writeFile(join(root, 'config.json'), JSON.stringify(config));
  assert.equal((await call('/api/me/submission', { method: 'PUT', cookie: user.cookie, body: {} })).status, 409);
  assert.equal((await call('/api/me/attendance', { method: 'POST', cookie: user.cookie, body: {} })).status, 201);
  assert.equal((await call('/api/me/profile')).status, 401);
  const sms = await call('/api/auth/sms/request', { method: 'POST', body: { phone: user.phone, purpose: 'reset' } });
  assert.equal((await call('/api/auth/sms/request', { method: 'POST', body: { phone: user.phone, purpose: 'reset' } })).status, 429);
  sms.body.simulationCode = (await server.database.query("SELECT code FROM simulation_sms WHERE phone=$1 AND purpose='reset'", [`+86${user.phone}`])).rows[0].code;
  const wrong = sms.body.simulationCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/reset', { method: 'POST', body: { phone: user.phone, password: 'Changed-Password-1234', code: wrong } })).status, 400);
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { phone: user.phone, password: 'Changed-Password-1234', code: sms.body.simulationCode } })).status, 400);
});

test('public configuration and SPA contain no development routes or internal diagnostics', async () => {
  const spa = await call('/unseen-client-route', { raw: true }); assert.equal(spa.status, 200); assert.match(spa.body, /Event SPA/);
  assert.equal((await call('/simulation')).status, 404);
  assert.equal((await call('/api/simulation/state')).status, 404);
  assert.equal((await call('/api/missing')).status, 404);
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...baseConfig, sourceNotes: [{title:'Private note',body:'internal-only'}], source:{workbookSha256:'internal-hash'}, readiness:{mode:'preview'}, sync:{pollSeconds:60}, branding:{heroWarning:'internal-only',heroBinding:{secret:'private'},heroImage:'/assets/hero.svg'} }));
  const publicData = (await call('/api/public/config')).body;
  assert.equal(publicData.runtime, undefined); assert.equal(publicData.readiness, undefined);
  for (const key of ['source','sourceNotes','readiness','sync']) assert.equal(publicData.config[key], undefined);
  assert.equal(publicData.config.branding.heroImage, '/assets/hero.svg');
  assert.equal(publicData.config.branding.heroWarning, undefined); assert.equal(JSON.stringify(publicData).includes('internal-only'), false);
});

test('basic document signatures distinguish PDF, valid OOXML and disguised archives', () => {
  assert.equal(detectDocument(Buffer.from(pdf, 'base64'), 'paper.pdf'), 'application/pdf');
  assert.equal(detectDocument(Buffer.from('PKnot-real'), 'slides.pptx'), null);
  assert.equal(detectDocument(Buffer.from(pdf, 'base64'), 'paper.docx'), null);
  const zip = entries => {
    const parts = [], central = []; let offset = 0;
    for (const [name, text] of entries) {
      const filename = Buffer.from(name), data = Buffer.from(text), header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
      parts.push(header, filename, data);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 6); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(filename.length, 28); c.writeUInt32LE(offset, 42); central.push(c, filename); offset += header.length + filename.length + data.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...parts, directory, end]);
  };
  const docx = zip([['[Content_Types].xml', '<Types>application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml</Types>'], ['word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>']]);
  assert.equal(detectDocument(docx, 'paper.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const pptx = zip([['[Content_Types].xml', '<Types>application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml</Types>'], ['ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>']]);
  assert.equal(detectDocument(pptx, 'slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
});


test('explicit CLI synchronization and periodic worker use the same persisted review queue', async () => {
  const user = await account(); await submit(user);
  await review(user, 'submission', 'needs_materials', 'CLI请求补材料');
  const command = await promisify(execFile)(process.execPath, [join(import.meta.dirname, '..', 'sync.js'), '--force'], { env: { ...process.env, APP_MODE: 'simulation', APP_ROOT: root, DATABASE_URL: dbUrl, PUBLIC_ORIGIN: origin } });
  assert.equal(JSON.parse(command.stdout.trim()).applied, 1);
  assert.equal((await call('/api/me/submission', { cookie: user.cookie })).body.submission.status, 'needs_materials');
  await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { note: '补材料已完成' } });
  const port = await freePort(), workerOrigin = `http://127.0.0.1:${port}`;
  const worker = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: workerOrigin, mode: 'simulation', env: { SYNC_POLL_SECONDS: '1' }, now: () => clock });
  await new Promise(resolve => worker.listen(port, '127.0.0.1', resolve));
  try {
    await worker.queueSimulationReview({ phone: user.phone, kind: 'submission', decision: 'accepted', feedback: '周期同步录用' });
    clock += 1001;
    const deadline = Date.now() + 5000;
    let status;
    while (Date.now() < deadline) {
      status = (await call('/api/me/submission', { cookie: user.cookie })).body.submission.status;
      if (status === 'accepted') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(status, 'accepted');
  } finally { await worker.shutdown(); }
});

test('embedded PostgreSQL bootstrap reuses existing cluster without reinitializing business data', async () => {
  const dataDir = join(root, 'restart-postgres'), port = await freePort();
  let cluster = await startLocalPostgres({ dataDir, port, persistent: true });
  let pool = new pg.Pool({ connectionString: cluster.connectionString });
  pool.on('error', error => { if (!pool.ending) throw error; });
  try {
    await pool.query("CREATE TABLE keep_record(value text); INSERT INTO keep_record VALUES('persistent')");
    await pool.end(); pool = undefined; await cluster.stop(); cluster = undefined;
    cluster = await startLocalPostgres({ dataDir, port, persistent: true });
    pool = new pg.Pool({ connectionString: cluster.connectionString });
    pool.on('error', error => { if (!pool.ending) throw error; });
    assert.equal((await pool.query('SELECT value FROM keep_record')).rows[0].value, 'persistent');
  } finally { await pool?.end(); await cluster?.stop(); }
});


test('persisted event slug accepts same-event regeneration and rejects a different event without data mutation', async () => {
  const user = await account(); await submit(user);
  const before = (await server.database.query('SELECT to_jsonb(u) AS data FROM users u WHERE id=$1', [user.id])).rows[0].data;
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...baseConfig, event: { ...baseConfig.event, title: '同一活动更新' } }));
  const same = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false }); await same.shutdown();
  await writeFile(join(root, 'config.json'), JSON.stringify({ ...baseConfig, event: { ...baseConfig.event, slug: 'another-conference' } }));
  await assert.rejects(createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false }), /requires an independent database/);
  const after = (await server.database.query('SELECT to_jsonb(u) AS data FROM users u WHERE id=$1', [user.id])).rows[0].data;
  assert.deepEqual(after, before);
  assert.equal((await server.database.query("SELECT value FROM app_metadata WHERE key='event_slug'")).rows[0].value, 'test-conference');
  assert.equal((await server.database.query('SELECT submission_status FROM business WHERE user_id=$1', [user.id])).rows[0].submission_status, 'under_review');
  assert.equal((await call('/api/public/config')).status, 500); // Existing process also refuses a swapped identity.
  await writeFile(join(root, 'config.json'), JSON.stringify(baseConfig));
});


test('local PostgreSQL refuses an existing or unknown owner even if local PID and port are not visible', async () => {
  const dataDir = join(root, 'unknown-owner'); await mkdir(dataDir);
  await writeFile(join(dataDir, 'postmaster.pid'), '999999\nshared-namespace-owner\n');
  const before = await import('node:fs/promises').then(fs => fs.readFile(join(dataDir, 'postmaster.pid'), 'utf8'));
  await assert.rejects(startLocalPostgres({ dataDir, port: await freePort() }), /ownership is active or unknown/);
  const after = await import('node:fs/promises').then(fs => fs.readFile(join(dataDir, 'postmaster.pid'), 'utf8'));
  assert.equal(after, before);
});

test('private questions are owner-isolated, persist before success, and deduplicate retries', async () => {
  const owner = await account({ complete: false }), other = await account();
  const requestId = 'question-request-0001';
  assert.equal((await call('/api/me/questions')).status, 401);
  const created = await call('/api/me/questions', { method: 'POST', cookie: owner.cookie, body: { question: '如何到达会场？', requestId } });
  assert.equal(created.status, 201); assert.equal(created.body.question.reply, ''); assert.equal(created.body.question.repliedAt, null);
  const questionId = created.body.question.id;
  assert.equal((await server.database.query('SELECT question FROM questions WHERE id=$1', [questionId])).rows[0].question, '如何到达会场？');
  const repeat = await call('/api/me/questions', { method: 'POST', cookie: owner.cookie, body: { question: '如何到达会场？', requestId } });
  assert.equal(repeat.status, 200); assert.equal(repeat.body.question.id, questionId);
  assert.equal((await call('/api/me/questions', { cookie: owner.cookie })).body.questions.length, 1);
  assert.deepEqual((await call('/api/me/questions', { cookie: other.cookie })).body.questions, []);
  assert.equal((await call('/api/me/questions/' + questionId, { cookie: other.cookie })).status, 404);
  assert.equal((await call('/api/me/questions/' + questionId, { cookie: owner.cookie })).status, 200);
  assert.equal((await call('/api/me/questions', { method: 'POST', cookie: owner.cookie, body: { question: '改为不同问题', requestId } })).status, 409);
  assert.equal((await call('/api/me/questions', { method: 'POST', cookie: owner.cookie, body: { question: 'x'.repeat(5001), requestId: 'question-request-long' } })).status, 400);
  assert.equal((await call('/api/me/questions', { method: 'POST', cookie: owner.cookie, body: { question: '尝试伪造归属', requestId: 'question-request-other', userId: other.id } })).status, 400);
  const otherQuestion = await call('/api/me/questions', { method: 'POST', cookie: other.cookie, body: { question: '第二位用户的私有问题', requestId } });
  assert.equal(otherQuestion.status, 201); assert.notEqual(otherQuestion.body.question.id, questionId);
  const restarted = await createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', autoSync: false });
  try { assert.equal((await restarted.database.query('SELECT count(*)::int AS n FROM questions')).rows[0].n, 2); } finally { await restarted.shutdown(); }
});

test('question write failure never returns submitted success; actual DB recovers without phantom records', async () => {
  const user = await account();
  await server.database.query("CREATE FUNCTION reject_question_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert rejected'; END $$; CREATE TRIGGER question_fail_test BEFORE INSERT ON questions FOR EACH ROW EXECUTE FUNCTION reject_question_test()");
  try {
    const refused = await call('/api/me/questions', { method: 'POST', cookie: user.cookie, body: { question: '数据库未可靠接收', requestId: 'question-rejected-001' } });
    assert.equal(refused.status, 500); assert.equal(refused.body.question, undefined); assert.equal((await server.database.query('SELECT count(*)::int AS n FROM questions')).rows[0].n, 0);
  } finally { await server.database.query('DROP TRIGGER question_fail_test ON questions; DROP FUNCTION reject_question_test()'); }
  const recovered = await call('/api/me/questions', { method: 'POST', cookie: user.cookie, body: { question: '数据库未可靠接收', requestId: 'question-rejected-001' } });
  assert.equal(recovered.status, 201); assert.equal((await server.database.query('SELECT count(*)::int AS n FROM questions')).rows[0].n, 1);
});

test('question replies synchronize as one updateable private answer and never cross ownership', async () => {
  const user = await account(), other = await account();
  const created = await call('/api/me/questions', { method: 'POST', cookie: user.cookie, body: { question: '工作人员会在何处回复？', requestId: 'private-reply-request' } });
  const questionId = created.body.question.id;
  await server.database.query("INSERT INTO question_remote_records(question_id,remote_id,snapshot,reply_fingerprint) VALUES($1,'mock-question-1','exported','initial')", [questionId]);
  let replies = [];
  const staff = await createServer({ appRoot: root, pool: server.database, publicOrigin: origin, mode: 'simulation', feishuAdapter: { pull: async () => replies, export: async () => {} }, autoSync: false, now: () => clock });
  try {
    for (const reply of ['在个人中心查看即可。', '更正回复：请查看交通页面。', '']) {
      replies = [{ kind: 'question', question_id: questionId, remote_id: 'mock-question-1', reply, fingerprint: JSON.stringify({ reply }) }];
      assert.equal((await staff.syncReviews()).applied, 1);
      assert.equal((await staff.syncReviews()).applied, 0);
      const view = (await call('/api/me/questions/' + questionId, { cookie: user.cookie })).body.question;
      assert.equal(view.reply, reply); assert.equal(Boolean(view.repliedAt), Boolean(reply));
      assert.deepEqual((await call('/api/me/questions', { cookie: other.cookie })).body.questions, []);
      assert.equal((await call('/api/me/questions/' + questionId, { cookie: other.cookie })).status, 404);
    }
    replies = [{ kind: 'question', question_id: questionId, remote_id: 'unmapped-question', reply: '伪造回复', fingerprint: 'fake' }];
    assert.equal((await staff.syncReviews()).applied, 0);
    assert.equal((await call('/api/me/questions/' + questionId, { cookie: user.cookie })).body.question.reply, '');
    assert.equal((await server.database.query('SELECT count(*)::int AS n FROM questions')).rows[0].n, 1);
  } finally { await staff.shutdown(); }
});

test('Feishu temporary outage retains accepted local data and retries individual exports without stopping public pages', async () => {
  const user = await account(); await submit(user);
  const question = await call('/api/me/questions', { method: 'POST', cookie: user.cookie, body: { question: '已接收问题不应丢失', requestId: 'outage-question-001' } });
  let failing = true; const written = new Map(); const attempts = [];
  const staff = await createServer({ appRoot: root, pool: server.database, publicOrigin: origin, mode: 'simulation', feishuAdapter: {
    pull: async () => { if (failing) throw new Error('mock temporary read failure'); return []; },
    export: async rows => { const errors=[]; for (const record of rows) { attempts.push(record.kind); if (failing && record.kind === 'submission') errors.push({message:'mock temporary write failure'}); else written.set(record.questionId || record.userId, record); } return {errors}; },
  }, autoSync: false, now: () => clock });
  try {
    await assert.rejects(staff.syncReviews(), /synchronization operation/);
    assert.ok(attempts.includes('question')); assert.ok(written.has(question.body.question.id));
    assert.equal((await call('/api/public/config')).status, 200);
    assert.equal((await call('/api/me/submission', { cookie: user.cookie })).body.submission.status, 'under_review');
    const failedHealth = (await server.database.query('SELECT * FROM sync_health WHERE id=1')).rows[0]; assert.equal(failedHealth.consecutive_failures, 1); assert.match(failedHealth.last_error, /mock temporary/);
    failing = false; await staff.syncReviews();
    assert.ok(written.has(user.id)); assert.ok(written.has(question.body.question.id));
    const restoredHealth = (await server.database.query('SELECT * FROM sync_health WHERE id=1')).rows[0]; assert.equal(restoredHealth.consecutive_failures, 0); assert.equal(restoredHealth.last_error, null); assert.ok(restoredHealth.last_success_at);
  } finally { await staff.shutdown(); }
});

test('obsolete remote/queued review rounds cannot overwrite supplemented materials; internal notes stay private', async () => {
  const user = await account(); await submit(user);
  await review(user, 'submission', 'needs_materials', '补充方法说明'); await sync();
  // This queued round-1 decision must become stale when the owner supplements.
  await review(user, 'submission', 'rejected', '旧轮拒绝');
  await call('/api/me/submission/supplement', { method: 'POST', cookie: user.cookie, body: { note: '新轮材料' } });
  assert.equal((await sync()).applied, 0);
  await server.database.query("INSERT INTO remote_records(kind,user_id,remote_id,snapshot,review_fingerprint,review_round) VALUES('submission',$1,'mock-round-record','old','old',1)", [user.id]);
  let pending = [{ kind: 'submission', user_id: user.id, reviewRound: 1, decision: 'rejected', feedback: '旧审核不能覆盖', internalNote: '内部私密', remote_id: 'mock-round-record', fingerprint: 'old-round-change' }];
  const staff = await createServer({ appRoot: root, pool: server.database, publicOrigin: origin, mode: 'simulation', feishuAdapter: { pull: async () => pending, export: async () => {} }, autoSync: false, now: () => clock });
  try {
    assert.equal((await staff.syncReviews()).applied, 0);
    let view = (await call('/api/me/submission', { cookie: user.cookie })).body.submission;
    assert.equal(view.status, 'under_review'); assert.equal(view.reviewRound, 2); assert.equal(view.note, '新轮材料');
    pending = [{ ...pending[0], reviewRound: 2, decision: 'accepted', feedback: '已录用', fingerprint: 'new-round-accepted' }];
    assert.equal((await staff.syncReviews()).applied, 1);
    view = (await call('/api/me/submission', { cookie: user.cookie })).body.submission; assert.equal(view.status, 'accepted'); assert.equal(view.feedback, '已录用');
    assert.equal(JSON.stringify(view).includes('内部私密'), false);
    assert.equal((await server.database.query('SELECT submission_internal_note FROM business WHERE user_id=$1', [user.id])).rows[0].submission_internal_note, '内部私密');
    assert.equal((await call('/api/me/attendance', { cookie: user.cookie })).body.attendance.attendanceGranted, true);
    const oldUpdatedAt=view.updatedAt; const oldAuditCount=(await server.database.query('SELECT count(*)::int AS n FROM review_history')).rows[0].n;
    clock += 100; pending=[{...pending[0],internalNote:'只更新内部说明',fingerprint:'new-internal-note-only'}];
    assert.equal((await staff.syncReviews()).applied,1);
    assert.equal((await call('/api/me/submission', {cookie:user.cookie})).body.submission.updatedAt,oldUpdatedAt);
    assert.equal((await server.database.query('SELECT count(*)::int AS n FROM review_history')).rows[0].n,oldAuditCount);
    pending=[{...pending[0],decision:'under_review',feedback:'重新审核',fingerprint:'back-to-under-review'}];
    assert.equal((await staff.syncReviews()).applied,1);
    assert.equal((await call('/api/me/submission', {cookie:user.cookie})).body.submission.status,'under_review');
    assert.equal((await call('/api/me/attendance', {cookie:user.cookie})).body.attendance.attendanceGranted,false);
  } finally { await staff.shutdown(); }
});

test('production defaults fail closed on missing real Feishu; explicit simulation is refused in production', async () => {
  await assert.rejects(createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: 'https://event.example.org', smsAdapter: { send: async () => ({}) }, env: { FEISHU_MODE: 'real', FEISHU_APP_ID: '', FEISHU_APP_SECRET: '' } }), /FEISHU|Feishu/);
  await assert.rejects(createServer({ appRoot: root, databaseUrl: dbUrl, publicOrigin: origin, mode: 'simulation', env: { NODE_ENV: 'production' } }), /Production refuses/);
  const runtimeIds = {FEISHU_APP_ID:'mock-existing-app',FEISHU_APP_SECRET:'mock-secret-only',FEISHU_BITABLE_APP_TOKEN:'mockBase',FEISHU_ATTENDANCE_TABLE_ID:'mockAttendance',FEISHU_SUBMISSION_TABLE_ID:'mockSubmission',FEISHU_QUESTION_TABLE_ID:'mockQuestion'};
  const checked = await checkIntegration({ ...runtimeIds, PUBLIC_ORIGIN: 'https://event.example.org', SMS_PROVIDER:'http', SMS_SEND_URL:'https://sms.example.org/send', SMS_API_KEY:'mock-only' }, { config: baseConfig, pool: server.database, plan: async () => ({ready:true,permissions:{write:'unverified'}}) });
  assert.equal(checked.codeConfigurationReady, true); assert.equal(checked.productionAcceptancePassed, false);
  const missingIds = await checkIntegration({PUBLIC_ORIGIN:'https://event.example.org',SMS_PROVIDER:'http',SMS_SEND_URL:'https://sms.example.org/send',SMS_API_KEY:'mock-only'}, {config:baseConfig,pool:server.database,plan:async()=>({ready:true})});
  assert.equal(missingIds.codeConfigurationReady,false); assert.ok(missingIds.missing.includes('Feishu runtime identity/resource IDs'));
  const missing = await checkIntegration({}, { config: baseConfig, pool: server.database, plan: async () => ({ready:false,errors:[{category:'configuration'}]}) });
  assert.equal(missing.codeConfigurationReady, false); assert.ok(missing.missing.includes('Feishu three-table schema/resource read access'));
});
