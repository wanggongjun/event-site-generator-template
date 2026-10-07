import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import pg from 'pg';
import { startLocalPostgres, stopPostgres } from '../local-postgres.js';
import { createServer } from '../server.js';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const freePort = async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
};
function childProcess() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => { assert.fail('PostgreSQL shutdown must use pg_ctl, never child.kill/taskkill.'); };
  child.finish = (code = 0, signal = null) => {
    child.exitCode = code; child.signalCode = signal;
    child.emit('exit', code, signal);
  };
  return child;
}
function fakeDatabase(directory = 'C:\\用户 资料\\活动 回归\\postgres') {
  return { options: { databaseDir: directory, persistent: true }, process: childProcess(), stop() { assert.fail('Upstream Windows stop uses taskkill and must not be called.'); } };
}

test('pg_ctl executable and data-directory paths with spaces/Chinese stay separate arguments without a shell', async () => {
  const database = fakeDatabase();
  const child = database.process;
  const executable = 'C:\\Program Files\\中文 PostgreSQL\\bin\\pg_ctl.exe';
  const calls = [];
  await stopPostgres(database, {
    getBinaries: async () => ({ pg_ctl: executable }),
    execute: async (...args) => { calls.push(args); child.finish(); return { stdout: 'server stopped', stderr: '' }; },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], executable);
  assert.deepEqual(calls[0][1], ['stop', '-D', database.options.databaseDir, '-m', 'fast', '-w', '-t', '15']);
  assert.equal(calls[0][2]?.shell, false);
  assert.equal(database.process, undefined);
  assert.equal(child.listenerCount('exit'), 0);
});

test('successful pg_ctl waits for the owned PostgreSQL child to exit before resolving', async () => {
  const database = fakeDatabase();
  const child = database.process;
  let executed = false, settled = false;
  const stopping = stopPostgres(database, {
    getBinaries: async () => ({ pg_ctl: '/a path/数据库/bin/pg_ctl' }),
    execute: async () => { executed = true; return { stdout: '', stderr: '' }; },
  });
  stopping.then(() => { settled = true; }, () => { settled = true; });
  try {
    await nextTurn();
    assert.equal(executed, true);
    assert.equal(settled, false);
    assert.equal(database.process, child);
  } finally { child.finish(); }
  await stopping;
  assert.equal(database.process, undefined);
});

test('an already-exited or absent process does not invoke pg_ctl', async () => {
  for (const state of ['absent', 'exitCode', 'signalCode']) {
    const database = fakeDatabase();
    if (state === 'absent') database.process = undefined;
    if (state === 'exitCode') database.process.exitCode = 0;
    if (state === 'signalCode') database.process.signalCode = 'SIGINT';
    await stopPostgres(database, {
      getBinaries: async () => { assert.fail('No binary lookup is needed after exit.'); },
      execute: async () => { assert.fail('An exited database must not be stopped twice.'); },
    });
    assert.equal(database.process, undefined);
  }
});

test('pg_ctl cannot confirm shutdown while the owned PostgreSQL process never exits', { timeout: 10000 }, async () => {
  const database = fakeDatabase(), child = database.process;
  await assert.rejects(stopPostgres(database, {
    getBinaries: async () => ({ pg_ctl: '/a path/数据库/bin/pg_ctl' }),
    execute: async () => ({ stdout: 'server stopped', stderr: '' }),
  }), /exit was not confirmed|shutdown was not confirmed/i);
  assert.equal(database.process, child);
  assert.equal(child.exitCode, null);
  assert.equal(child.listenerCount('exit'), 0);
});

test('pg_ctl errors preserve the owned process and PID file instead of killing/resetting data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'event stop error 中文 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pid = join(root, 'postmaster.pid'), marker = '12345\nowned database\n';
  await writeFile(pid, marker);
  const database = fakeDatabase(root), child = database.process;
  const failure = Object.assign(new Error('pg_ctl permission denied'), { code: 1, stderr: 'access denied' });
  await assert.rejects(stopPostgres(database, {
    getBinaries: async () => ({ pg_ctl: 'C:\\路径 空格\\pg_ctl.exe' }),
    execute: async () => { throw failure; },
  }), error => error === failure || error.cause === failure || /permission denied|access denied/.test(error.message));
  assert.equal(database.process, child);
  assert.equal(await readFile(pid, 'utf8'), marker);
  assert.equal(child.exitCode, null);
  assert.equal(child.listenerCount('exit'), 0);
});

test('pg_ctl completion and child exit with a leftover PID file is not reported as a safe shutdown', async t => {
  const root = await mkdtemp(join(tmpdir(), 'event unconfirmed stop 中文 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pid = join(root, 'postmaster.pid'), marker = '12345\nPID must be preserved\n';
  await writeFile(pid, marker);
  const database = fakeDatabase(root), child = database.process;
  await assert.rejects(stopPostgres(database, {
    getBinaries: async () => ({ pg_ctl: 'C:\\路径 空格\\pg_ctl.exe' }),
    execute: async () => { child.finish(); return { stdout: '', stderr: '' }; },
  }), /PID file|shutdown was not confirmed/i);
  assert.equal(await readFile(pid, 'utf8'), marker);
  assert.equal(child.listenerCount('exit'), 0);
});

test('binary lookup errors preserve process ownership and are reported', async () => {
  const database = fakeDatabase(), child = database.process;
  const failure = new Error('pg_ctl binary unavailable');
  await assert.rejects(stopPostgres(database, {
    getBinaries: async () => { throw failure; },
    execute: async () => { assert.fail('Do not execute after a failed binary lookup.'); },
  }), error => error === failure || error.cause === failure || /binary unavailable/.test(error.message));
  assert.equal(database.process, child);
});

test('an existing postmaster.pid is never removed or rewritten to obtain ownership', async t => {
  const root = await mkdtemp(join(tmpdir(), 'event unknown owner 中文 '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = '987654321\nunknown original namespace\n';
  await writeFile(join(root, 'postmaster.pid'), marker);
  await assert.rejects(startLocalPostgres({ dataDir: root, port: await freePort() }), /ownership is active or unknown/);
  assert.equal(await readFile(join(root, 'postmaster.pid'), 'utf8'), marker);
  assert.equal(existsSync(join(root, 'PG_VERSION')), false);
});

test('invalid ports and destructive nonpersistent configuration are rejected before creating files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'event invalid local pg '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, 'must not be created');
  await assert.rejects(startLocalPostgres({ dataDir, persistent: false }), /preserved|persistent:false/);
  for (const port of [0, -1, 65536, 1.5, NaN]) await assert.rejects(startLocalPostgres({ dataDir, port }), /port.*integer/i);
  assert.equal(existsSync(dataDir), false);
});

test('real local PostgreSQL preserves records over restarts, shares one stop promise, and cleans failed startup', { timeout: 120000 }, async t => {
  // This is a newly created fixture. Never point these tests at an existing event database.
  const root = await mkdtemp(join(tmpdir(), 'event pg lifecycle 中文 '));
  const dataDir = join(root, 'postgres'), port = await freePort();
  let local, client, server, blocker;
  t.after(async () => {
    await server?.shutdown();
    await client?.end();
    await local?.stop();
    if (blocker?.listening) await new Promise(resolve => blocker.close(resolve));
    if (!existsSync(join(dataDir, 'postmaster.pid'))) await rm(root, { recursive: true, force: true });
    else console.error(`Lifecycle fixture retained because ownership is still active or unknown: ${root}`);
  });
  for (let cycle = 0; cycle < 3; cycle++) {
    local = await startLocalPostgres({ dataDir, port });
    client = new pg.Client({ connectionString: local.connectionString });
    await client.connect();
    if (cycle === 0) {
      await client.query('CREATE TABLE lifecycle_marker(id integer PRIMARY KEY, note text NOT NULL)');
      await client.query('INSERT INTO lifecycle_marker VALUES ($1, $2)', [1, '空格与中文路径：完整保留']);
    }
    assert.deepEqual((await client.query('SELECT * FROM lifecycle_marker')).rows, [{ id: 1, note: '空格与中文路径：完整保留' }]);
    await client.end(); client = undefined;
    const owned = local.database.process;
    const first = local.stop(), second = local.stop(), upstreamHook = local.database.stop();
    assert.strictEqual(first, second, 'Repeated local.stop must share the same in-flight promise.');
    assert.strictEqual(first, upstreamHook, 'Upstream exit hooks must use the same safe stop promise.');
    await Promise.all([first, second, upstreamHook]);
    assert.notEqual(owned.exitCode ?? owned.signalCode, null);
    assert.equal(local.database.process, undefined);
    assert.equal(existsSync(join(dataDir, 'postmaster.pid')), false);
    assert.equal(existsSync(join(dataDir, 'PG_VERSION')), true);
    assert.strictEqual(local.stop(), first, 'A completed stop must not call pg_ctl again.');
    await local.stop(); local = undefined;
  }

  const versionBefore = await readFile(join(dataDir, 'PG_VERSION'), 'utf8');
  blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once('error', reject); blocker.listen(port, '127.0.0.1', resolve); });
  await assert.rejects(startLocalPostgres({ dataDir, port }), /could not start|failed to start/i);
  assert.equal(existsSync(join(dataDir, 'postmaster.pid')), false);
  assert.equal(await readFile(join(dataDir, 'PG_VERSION'), 'utf8'), versionBefore);
  await new Promise(resolve => blocker.close(resolve)); blocker = undefined;

  local = await startLocalPostgres({ dataDir, port });
  client = new pg.Client({ connectionString: local.connectionString });
  await client.connect();
  assert.equal((await client.query('SELECT note FROM lifecycle_marker WHERE id=1')).rows[0].note, '空格与中文路径：完整保留');
  await client.end(); client = undefined;

  // Check the application's pool shutdown while Pool.end is deliberately waiting for a checked-out client.
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'config.json'), JSON.stringify({ event: { slug: 'pg-lifecycle-regression', title: '独立生命周期测试' }, sync: { pollSeconds: 60 } }));
  server = await createServer({ appRoot: root, databaseUrl: local.connectionString, mode: 'simulation', autoSync: false });
  const checkedOut = await server.database.connect();
  const originalEnd = server.database.end.bind(server.database);
  let endCalls = 0;
  server.database.end = (...args) => { endCalls++; return originalEnd(...args); };
  const firstShutdown = server.shutdown(), secondShutdown = server.shutdown();
  try {
    assert.strictEqual(firstShutdown, secondShutdown, 'Concurrent server.shutdown must share one promise.');
    await nextTurn();
    assert.equal(endCalls, 1, 'The PostgreSQL pool must be ended exactly once.');
  } finally { checkedOut.release(); }
  await Promise.all([firstShutdown, secondShutdown]);
  await server.shutdown();
  assert.equal(endCalls, 1);
  server = undefined;
});
