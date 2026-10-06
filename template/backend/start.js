import { resolve } from 'node:path';
import { createServer } from './server.js';
import { startLocalPostgres } from './local-postgres.js';
const mode = process.env.APP_MODE || 'simulation';
const appRoot = resolve(process.env.APP_ROOT || resolve(import.meta.dirname, '..'));
let local;
if (!process.env.DATABASE_URL && mode === 'simulation') {
  const dataDir = resolve(process.env.PG_DATA_DIR || resolve(appRoot, 'backend/data/postgres'));
  const pgPort = Number(process.env.PG_PORT || 55432);
  local = await startLocalPostgres({ dataDir, port: pgPort });
  console.log(`SIMULATION ONLY: local PostgreSQL on port ${pgPort}; persistent data: ${dataDir}`);
}
const server = await createServer({ databaseUrl: process.env.DATABASE_URL || local?.connectionString, onError: error => console.error('Backend error:', error.message) });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (server.runtime.mode === 'simulation' ? '127.0.0.1' : '0.0.0.0');
if (server.runtime.mode === 'simulation' && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Simulation mode must listen on loopback only.');
server.listen(port, host, () => console.log(`Event website: ${server.runtime.origin} (${server.runtime.mode}). Simulator: ${server.runtime.origin}/simulation`));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { if (stopping) return; stopping = true; await server.shutdown(); await local?.stop(); process.exit(0); });
