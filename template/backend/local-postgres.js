import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
const loadBinaries = () => import(`@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`);
const exited = child => child.exitCode != null || child.signalCode != null;

/** Stop only the cluster/process we started. Never force-kill or remove its PID file. */
export async function stopPostgres(database, { execute = executeFile, getBinaries = loadBinaries } = {}) {
  const child = database.process;
  if (!child) return;
  const directory = database.options.databaseDir;
  if (exited(child)) {
    if (existsSync(resolve(directory, 'postmaster.pid'))) throw new Error(`Local PostgreSQL process already exited but shutdown was not confirmed at ${directory}: postmaster.pid remains. Data was preserved; confirm the original owner has exited before operator recovery. Do not delete the PID file or reinitialize data.`);
    database.process = undefined;
    return;
  }
  let timer;
  let onExit;
  const finished = new Promise(resolve => { onExit = resolve; child.once('exit', onExit); });
  try {
    const { pg_ctl } = await getBinaries();
    const permissions = await database.getUidAndGid?.() || {};
    // Binary/owner resolution is asynchronous; it may have exited meanwhile.
    if (exited(child)) {
      if (existsSync(resolve(directory, 'postmaster.pid'))) throw new Error('The owned PostgreSQL process exited during shutdown preparation but its PID file remains.');
      database.process = undefined; return;
    }
    await execute(pg_ctl, ['stop', '-D', directory, '-m', 'fast', '-w', '-t', '15'], { ...permissions, shell: false, windowsHide: true, timeout: 20000 });
    if (!exited(child)) await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PostgreSQL process exit was not confirmed after pg_ctl completed.')), 5000); })]);
    if (existsSync(resolve(directory, 'postmaster.pid'))) throw new Error('PostgreSQL still has a PID file after shutdown.');
    database.process = undefined;
  } catch (error) {
    throw new Error(`Local PostgreSQL shutdown was not confirmed at ${directory} (owned PID ${child.pid || 'unknown'}). Data and PID files were preserved; inspect PostgreSQL logs and confirm the original process has exited before restarting. ${error.stderr?.trim() || error.message || error.code || 'pg_ctl failed'}`, { cause: error });
  } finally { clearTimeout(timer); child.removeListener('exit', onExit); }
}

/** Local-only demonstration/test PostgreSQL; never used implicitly in real mode. */
export async function startLocalPostgres({ dataDir, port = 55432, user = 'event_demo', password = 'local_demo_only', persistent = true } = {}) {
  if (!dataDir) throw new Error('Local PostgreSQL needs an explicit data directory.');
  if (!persistent) throw new Error('Local PostgreSQL data is always preserved; persistent:false is not supported.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local PostgreSQL port must be an integer between 1 and 65535.');
  const directory = resolve(dataDir);
  // Shared filesystems can span process/network namespaces. PID/TCP absence here
  // never proves that the recorded PostgreSQL owner in another namespace stopped.
  if (existsSync(resolve(directory, 'postmaster.pid'))) throw new Error(`PostgreSQL ownership is active or unknown at ${directory}. postmaster.pid exists; refuse a second owner. Stop the original instance in its original terminal and confirm it has exited. Do not delete the PID file or reinitialize data.`);
  const database = new EmbeddedPostgres({ databaseDir: directory, port, user, password, persistent, authMethod: 'scram-sha-256', postgresFlags: ['-c', 'unix_socket_directories=', '-c', 'listen_addresses=127.0.0.1'] });
  // The dependency's Windows stop uses taskkill /f /t and its exit hook calls
  // database.stop directly. Replace that method too, with one shared close.
  let stopPromise;
  database.stop = () => stopPromise ||= stopPostgres(database);
  try {
    if (!existsSync(resolve(directory, 'PG_VERSION'))) await database.initialise();
    await database.start();
  } catch (error) {
    // The upstream package rejects startup with undefined on early process exit.
    // Clear only its already-exited process reference; never alter database files.
    let cleanupError;
    try { await database.stop(); } catch (failure) { cleanupError = failure; }
    throw new Error(`Local PostgreSQL could not start at ${directory}. Existing data was left unchanged. Inspect the preceding PostgreSQL logs; do not reset or delete database files. ${error?.message || 'The PostgreSQL process exited before becoming ready.'}${cleanupError ? ` Cleanup also failed: ${cleanupError.message}` : ''}`, { cause: error || cleanupError });
  }
  return { database, connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`, stop: database.stop };
}
