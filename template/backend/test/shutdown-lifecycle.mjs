// Explicit full-record lifecycle regression. Run in one owning terminal/process
// namespace; leaves its newly created fixture and logs as evidence, never resets it.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const fixture = resolve(process.argv[2] || `/tmp/event-lifecycle-${Date.now()}`);
const packageRoot = resolve(import.meta.dirname, '../../..');
const instance = join(fixture, 'instance');
const installedInstance = process.argv[3] ? resolve(process.argv[3]) : null;
if (!installedInstance || !existsSync(join(installedInstance, 'backend/start.js')) || !existsSync(join(installedInstance, 'node_modules/embedded-postgres'))) throw new Error('Pass a generated instance where documented npm install already completed as argument 3. No second template dependency install is needed.');
const python = resolve(process.argv[4] || join(packageRoot, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'));
if (!existsSync(python)) throw new Error(`Project virtual-environment Python not found: ${python}. Follow README venv setup or pass its executable as argument 4.`);
const { startLocalPostgres } = await import(pathToFileURL(join(installedInstance, 'backend/local-postgres.js')));

await mkdir(fixture, { recursive: true });
if (existsSync(join(instance, 'manifest.json'))) throw new Error('Use a new lifecycle fixture; existing evidence/data is never reset by this test.');
const execute = promisify(execFile);
await execute(python, [join(packageRoot, 'scripts/generate.py'), join(packageRoot, 'input/fictional-conference.xlsx'), '--output', instance]);
const freePort = async () => { const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port; };
const httpPort = await freePort(), pgPort = await freePort(), origin = `http://127.0.0.1:${httpPort}`;
const dataDir = join(instance, 'backend/data/postgres');
let child, cookie, userId, fileId;
const transcript = [];
async function request(path, method = 'GET', body, raw = false) {
  const response = await fetch(origin + path, { method, headers: { origin, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = raw ? await response.text() : await response.json();
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  transcript.push({ method, path, status: response.status });
  return value;
}
async function start(label) {
  const log = join(fixture, `${label}.log`);
  child = spawn(process.execPath, [join(installedInstance, 'backend/start.js')], { env: { ...process.env, DATABASE_URL: '', APP_ROOT: instance, APP_MODE: 'simulation', PUBLIC_ORIGIN: origin, PORT: String(httpPort), PG_PORT: String(pgPort), PG_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => appendFile(log, chunk)); child.stderr.on('data', chunk => appendFile(log, chunk));
  let terminated; child.once('exit', (code, signal) => { terminated = { code, signal }; });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (terminated) throw new Error(`Backend startup exited: ${JSON.stringify(terminated)}; inspect ${log}`);
    try { const response = await fetch(origin + '/api/public/config'); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Backend did not become ready; inspect ${log}`);
}
async function devCommand(...args) {
  return execute(process.execPath, [join(installedInstance,'backend/development/dev-simulation.js'),...args], {env:{...process.env,APP_MODE:'simulation',APP_ROOT:instance,DATABASE_URL:`postgresql://event_demo:local_demo_only@127.0.0.1:${pgPort}/postgres`,PUBLIC_ORIGIN:origin}});
}
async function stop(signal) {
  const exit = new Promise(resolve => child.once('exit', (code, actualSignal) => resolve({ code, signal: actualSignal })));
  child.kill(signal);
  const result = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Graceful shutdown timeout; data preserved, no forced kill')), 15000).unref())]);
  assert.equal(result.code, 0); assert.equal(existsSync(join(dataDir, 'postmaster.pid')), false);
  transcript.push({ stoppedWith: signal, exitCode: result.code }); child = undefined;
}
try {
  await start('01-initial');
  const marker = await readFile(join(dataDir, 'postmaster.pid'), 'utf8');
  await assert.rejects(startLocalPostgres({ dataDir, port: pgPort }), /ownership is active or unknown/);
  assert.equal(await readFile(join(dataDir, 'postmaster.pid'), 'utf8'), marker);
  const phone = '13800001234', password = 'Lifecycle-Password-1234';
  await request('/api/auth/sms/request', 'POST', { phone, purpose: 'register' });
  const code = JSON.parse((await devCommand('sms',phone)).stdout.trim()).code;
  userId = (await request('/api/auth/register', 'POST', { phone, password, code })).user.id;
  await request('/api/me/profile', 'PATCH', { name: '持久化测试', email: 'lifecycle@example.org', organization: '虚构测试机构', identity: '研究人员', researchDirection: '数据库生命周期' });
  await request('/api/me/attendance', 'POST', { motivation: '持久化回归' });
  const pdf = '%PDF-2.0\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';
  fileId = (await request('/api/me/files', 'POST', { name: 'lifecycle.pdf', contentBase64: Buffer.from(pdf).toString('base64') })).file.id;
  await request('/api/me/submission', 'PUT', { title: '生命周期回归', abstract: '完整账户、附件与审核状态跨重启保持。', keywords: ['持久化'], authors: [{ name: '持久化测试', affiliation: '虚构测试机构' }], presenter: '持久化测试', note: '', attachmentIds: [fileId] });
  await request('/api/me/submission/submit', 'POST', {});
  await devCommand('review',phone,'submission','needs_materials','补全'); await devCommand('sync');
  await request('/api/me/submission/supplement', 'POST', { note: '已补全' });
  for (const kind of ['submission', 'attendance']) await devCommand('review',phone,kind,'accepted','通过');
  await devCommand('sync');
  for (let round = 1; round <= 3; round++) {
    await stop(round === 2 ? 'SIGINT' : 'SIGTERM');
    const generated = await execute(python, [join(packageRoot, 'scripts/generate.py'), join(packageRoot, 'input/fictional-conference.xlsx'), '--output', instance]);
    await appendFile(join(fixture, 'regeneration.log'), generated.stdout + generated.stderr);
    cookie = undefined; await start(`0${round + 1}-restart`);
    const login = await request('/api/auth/login', 'POST', { phone, password }); assert.equal(login.user.id, userId);
    const submission = (await request('/api/me/submission')).submission; assert.equal(submission.status, 'accepted'); assert.equal(submission.reviewRound, 2); assert.equal(submission.note, '已补全');
    const attendance = await request('/api/me/attendance'); assert.equal(attendance.attendanceStats.total, 1); assert.equal(attendance.attendance.attendanceGranted, true); assert.equal(attendance.attendance.grantSources.length, 2);
    assert.equal(await request(`/api/me/files/${fileId}`, 'GET', undefined, true), pdf);
  }
  await stop('SIGTERM');
  await writeFile(join(fixture, 'result.json'), JSON.stringify({ passed: true, preservedAccountId: userId, fileId, cycles: 3, signals: ['SIGTERM', 'SIGINT', 'SIGTERM'], transcript }, null, 2));
  console.log(`Full-record SIGTERM/SIGINT → regeneration → restart passed3 cycles. Evidence: ${fixture}`);
} catch (error) {
  await writeFile(join(fixture, 'failure.json'), JSON.stringify({ error: error.message, transcript }, null, 2));
  if (child && child.exitCode === null) await stop('SIGTERM').catch(() => {});
  throw error;
}
