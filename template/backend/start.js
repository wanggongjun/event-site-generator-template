import { resolve } from 'node:path';
import AsyncExitHook from 'async-exit-hook';
import { createServer } from './server.js';
import { startLocalPostgres } from './local-postgres.js';

// Own these events instead of the dependency's concurrent, 10-second forced
// exit hook. Startup errors and shutdown are fully handled below; removing its
// beforeExit hook also preserves a startup/cleanup failure's nonzero exit code.
for (const event of ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP', 'message', 'beforeExit', 'exit']) AsyncExitHook.unhookEvent(event);
let local, server, stopRequested = false, shutdownPromise;
const startup = start();

function shutdown() {
  stopRequested = true;
  return shutdownPromise ||= (async () => {
    await startup.catch(() => {});
    try { await server?.shutdown(); }
    finally { await local?.stop(); }
    console.log('Shutdown complete; HTTP connections, database pool and owned local PostgreSQL are closed.');
    if (process.connected) process.disconnect();
  })();
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => {
  shutdown().catch(error => { console.error('Shutdown failed:', error.message); process.exitCode = 1; });
});
// Parent-controlled IPC only, never an HTTP shutdown route. Windows child.kill
// force-terminates a process, so automated regression uses this graceful path.
process.on('message', message => { if (message === 'shutdown') shutdown().catch(error => { console.error('Shutdown failed:', error.message); process.exitCode = 1; }); });

async function start() {
  const mode = process.argv.includes('--simulation') ? 'simulation' : (process.env.APP_MODE || 'real');
  if (process.env.NODE_ENV === 'production' && mode !== 'real') throw new Error('Production refuses development simulation.');
  process.env.APP_MODE = mode;
  const appRoot = resolve(process.env.APP_ROOT || resolve(import.meta.dirname, '..'));
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const host = process.env.HOST || (mode === 'simulation' ? '127.0.0.1' : '0.0.0.0');
  if (mode === 'simulation' && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Simulation mode must listen on loopback only.');
  if (!process.env.DATABASE_URL && mode === 'simulation') {
    const dataDir = resolve(process.env.PG_DATA_DIR || resolve(appRoot, 'backend/data/postgres'));
    const pgPort = Number(process.env.PG_PORT || 55432);
    local = await startLocalPostgres({ dataDir, port: pgPort });
    console.log(`Development PostgreSQL on port ${pgPort}; persistent data: ${dataDir}`);
  }
  if (stopRequested) return;
  server = await createServer({ databaseUrl: process.env.DATABASE_URL || local?.connectionString });
  if (stopRequested) return;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  console.log(`Event website: ${server.runtime.origin} (${server.runtime.mode}).`);
}
try { await startup; }
catch (error) {
  console.error('Startup failed:', error.code || error.name, error.message);
  process.exitCode = 1;
  try { await shutdown(); } catch (failure) { console.error('Cleanup failed:', failure.message); }
}
