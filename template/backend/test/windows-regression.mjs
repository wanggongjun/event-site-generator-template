// Run `npm run test:windows` from a generated instance on Windows with Node 24.
// Uses a NEW isolated directory with spaces/Chinese. Never resets an existing cluster.
// An IPC "shutdown" request enters the same application shutdown handler as Ctrl+C;
// Windows child.kill('SIGINT') is a forced termination and is deliberately never used.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';

if (process.platform !== 'win32') {
  console.log(`SKIP Windows native lifecycle regression: current platform is ${process.platform}. Run npm run test:windows on Windows with Node 24.`);
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Windows regression requires the documented Node 24 runtime.');

const backendRoot = resolve(import.meta.dirname, '..');
const fixture = await mkdtemp(join(tmpdir(), 'event windows 空格 中文 回归 '));
const dataDir = join(fixture, 'persistent postgres 数据');
const configPath = join(fixture, 'config.json');
const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const transcript = [];
let running, cookie, userId, fileId;
const freePort = async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
};
const httpPort = await freePort(), pgPort = await freePort();
const origin = `http://127.0.0.1:${httpPort}`;
const databaseUrl = `postgresql://event_demo:local_demo_only@127.0.0.1:${pgPort}/postgres`;
const window = { openAt: '2000-01-01T00:00:00Z', closeAt: '2099-01-01T00:00:00Z' };
await mkdir(join(fixture, 'dist'));
await writeFile(join(fixture, 'dist', 'index.html'), '<!doctype html><title>Isolated Windows lifecycle regression</title>');
await writeFile(configPath, JSON.stringify({
  event: { slug: 'windows-lifecycle-regression', title: 'Windows 独立生命周期回归', capacity: 100 },
  attendance: window, submission: window,
  files: { maxFileBytes: 1048576, maxAttachments: 3, allowedExtensions: ['pdf'] },
  sync: { pollSeconds: 3600 },
}));

function launch(label, extraEnv = {}) {
  const logPath = join(fixture, `${label}.log`), log = createWriteStream(logPath, { flags: 'wx' });
  const child = spawn(process.execPath, [join(backendRoot, 'start.js')], {
    env: {
      ...process.env, NODE_ENV: 'development', DATABASE_URL: '', APP_ROOT: fixture,
      APP_MODE: 'simulation', FEISHU_MODE: 'simulation', PUBLIC_ORIGIN: origin,
      HOST: '127.0.0.1', PORT: String(httpPort), PG_PORT: String(pgPort), PG_DATA_DIR: dataDir,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  const state = { child, logPath, result: null, done: null };
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once('error', error => { state.spawnError = error.message; });
  state.done = new Promise(resolve => child.once('close', (code, signal) => {
    state.result = { code, signal, ...(state.spawnError ? { error: state.spawnError } : {}) };
    log.end(() => resolve(state.result));
  }));
  running = state;
  return state;
}
async function bounded(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); })]);
  } finally { clearTimeout(timeout); }
}
async function start(label) {
  const state = launch(label), deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (state.result) throw new Error(`Backend startup exited ${JSON.stringify(state.result)}. Inspect ${state.logPath}`);
    try {
      const response = await fetch(origin + '/api/public/config', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { transcript.push({ started: label }); return state; }
    } catch {}
    await delay(100);
  }
  throw new Error(`Backend startup timeout. Inspect ${state.logPath}; data is preserved.`);
}
async function stop(state = running) {
  if (!state || state.result) return;
  assert.equal(state.child.connected, true, 'The regression must use the controlled IPC graceful shutdown route.');
  const send = () => new Promise((resolve, reject) => state.child.send('shutdown', error => error ? reject(error) : resolve()));
  // Concurrent requests must share one shutdown, one Pool.end and one pg_ctl stop.
  await Promise.all([send(), send()]);
  const result = await bounded(state.done, 25000, `Graceful IPC shutdown timeout. Inspect ${state.logPath}; no forced kill or PID deletion was attempted.`);
  assert.equal(result.code, 0, `Shutdown failed: ${JSON.stringify(result)}; inspect ${state.logPath}`);
  assert.equal(result.signal, null);
  assert.equal(existsSync(join(dataDir, 'postmaster.pid')), false, 'pg_ctl must remove the PostgreSQL PID file through normal shutdown.');
  assert.equal(existsSync(join(dataDir, 'PG_VERSION')), true);
  transcript.push({ stoppedWith: 'IPC shutdown (shared Ctrl+C handler)', repeatedRequests: 2, exitCode: result.code });
  if (running === state) running = undefined;
}
async function failedStart(label, env, expectedLog) {
  const state = launch(label, env);
  const result = await bounded(state.done, 45000, `Failed-start cleanup timeout. Inspect ${state.logPath}; data is preserved.`);
  assert.notEqual(result.code, 0, `${label} must fail startup.`);
  assert.equal(existsSync(join(dataDir, 'postmaster.pid')), false, `${label} must leave no owned PostgreSQL process.`);
  assert.match(await readFile(state.logPath, 'utf8'), expectedLog);
  transcript.push({ rejectedStartup: label, exitCode: result.code });
  running = undefined;
}
async function request(path, method = 'GET', body, raw = false) {
  const response = await fetch(origin + path, {
    method, signal: AbortSignal.timeout(15000),
    headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = raw ? await response.text() : await response.json();
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  transcript.push({ method, path, status: response.status });
  return value;
}
async function devCommand(...args) {
  return execute(process.execPath, [join(backendRoot, 'development/dev-simulation.js'), ...args], {
    env: { ...process.env, NODE_ENV: 'development', APP_MODE: 'simulation', FEISHU_MODE: 'simulation', APP_ROOT: fixture, DATABASE_URL: databaseUrl, PUBLIC_ORIGIN: origin },
    windowsHide: true, timeout: 20000,
  });
}

console.log(`Windows regression fixture and retained logs: ${fixture}`);
try {
  await start('01-initial');
  const phone = '13800001234', password = 'Lifecycle-Password-1234';
  const pdf = '%PDF-2.0\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';
  await request('/api/auth/sms/request', 'POST', { phone, purpose: 'register' });
  const code = JSON.parse((await devCommand('sms', phone)).stdout.trim()).code;
  userId = (await request('/api/auth/register', 'POST', { phone, password, code })).user.id;
  await request('/api/me/profile', 'PATCH', { name: 'Windows 持久化测试', email: 'lifecycle@example.org', organization: '虚构测试机构', identity: '研究人员', researchDirection: '数据库生命周期' });
  await request('/api/me/attendance', 'POST', { motivation: 'Windows 持久化回归' });
  fileId = (await request('/api/me/files', 'POST', { name: 'lifecycle.pdf', contentBase64: Buffer.from(pdf).toString('base64') })).file.id;
  await request('/api/me/submission', 'PUT', { title: 'Windows 生命周期回归', abstract: '账户、附件与审核状态跨重启保持。', keywords: ['持久化'], authors: [{ name: 'Windows 持久化测试', affiliation: '虚构测试机构' }], presenter: 'Windows 持久化测试', note: '', attachmentIds: [fileId] });
  await request('/api/me/submission/submit', 'POST', {});
  await devCommand('review', phone, 'submission', 'needs_materials', '补全'); await devCommand('sync');
  await request('/api/me/submission/supplement', 'POST', { note: '已补全' });
  for (const kind of ['submission', 'attendance']) await devCommand('review', phone, kind, 'accepted', '通过');
  await devCommand('sync');

  async function verifyRecords() {
    cookie = undefined;
    assert.equal((await request('/api/auth/login', 'POST', { phone, password })).user.id, userId);
    const profile = await request('/api/me/profile');
    assert.equal(profile.profile.name, 'Windows 持久化测试');
    const submission = (await request('/api/me/submission')).submission;
    assert.equal(submission.status, 'accepted'); assert.equal(submission.reviewRound, 2); assert.equal(submission.note, '已补全');
    const attendance = await request('/api/me/attendance');
    assert.equal(attendance.attendanceStats.total, 1); assert.equal(attendance.attendance.attendanceGranted, true); assert.equal(attendance.attendance.grantSources.length, 2);
    assert.equal(await request(`/api/me/files/${fileId}`, 'GET', undefined, true), pdf);
  }
  for (let cycle = 1; cycle <= 3; cycle++) {
    await stop();
    await start(`0${cycle + 1}-restart`);
    await verifyRecords();
  }
  await stop();
  const pgVersion = await readFile(join(dataDir, 'PG_VERSION'), 'utf8');
  await failedStart('05-invalid-config', { EVENT_CONFIG_PATH: join(fixture, 'missing config.json') }, /ENOENT|config/i);
  await failedStart('06-loopback-guard', { HOST: '0.0.0.0' }, /loopback/i);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(httpPort, '127.0.0.1', resolve); });
  try { await failedStart('07-http-port-conflict', {}, /EADDRINUSE|address already in use/i); }
  finally { await new Promise(resolve => blocker.close(resolve)); }
  assert.equal(await readFile(join(dataDir, 'PG_VERSION'), 'utf8'), pgVersion);
  await start('08-after-startup-failures');
  await verifyRecords();
  await stop();
  await writeFile(join(fixture, 'result.json'), JSON.stringify({
    passed: true, platform: process.platform, node: process.version, preservedAccountId: userId,
    fileId, restartCycles: 3, testedShutdown: 'IPC shutdown using the same handler as SIGINT/SIGTERM',
    actualConsoleCtrlCTested: false, fixture, transcript,
  }, null, 2));
  console.log(`PASS: Windows native pg_ctl shutdown, 3 persistent restarts, repeated shutdown, startup-failure cleanup, and full account/file/review preservation. Evidence: ${fixture}`);
  console.log('Actual terminal Ctrl+C remains a separate manual console check; this script never fakes it with child.kill.');
} catch (error) {
  if (running && !running.result) {
    try { await stop(); } catch (cleanupError) { transcript.push({ cleanupError: cleanupError.message }); }
    // Preserve a still-running process and its files for diagnosis, but do not hold this test's IPC open forever.
    if (running && !running.result) { running.child.stdout.unpipe(); running.child.stderr.unpipe(); running.child.stdout.destroy(); running.child.stderr.destroy(); if (running.child.connected) running.child.disconnect(); running.child.unref(); }
  }
  await writeFile(join(fixture, 'failure.json'), JSON.stringify({ passed: false, error: error.message, fixture, transcript }, null, 2));
  console.error(`FAIL: ${error.message}\nEvidence/data preserved: ${fixture}`);
  process.exitCode = 1;
}
