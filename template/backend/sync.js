import { resolve } from 'node:path';
import pg from 'pg';
import { createServer } from './server.js';
import { startLocalPostgres } from './local-postgres.js';
let local, databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && (process.env.APP_MODE || 'real') === 'simulation') {
  const port = Number(process.env.PG_PORT || 55432);
  databaseUrl = `postgresql://event_demo:local_demo_only@127.0.0.1:${port}/postgres`;
  const probe = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 1500 });
  try { await probe.query('SELECT 1'); }
  catch { local = await startLocalPostgres({ dataDir: process.env.PG_DATA_DIR || resolve(process.env.APP_ROOT || resolve(import.meta.dirname, '..'), 'backend/data/postgres'), port }); databaseUrl = local.connectionString; }
  finally { await probe.end(); }
}
const server = await createServer({ databaseUrl, autoSync: false });
try { console.log(JSON.stringify(await server.syncReviews({ force: process.argv.includes('--force') }))); }
finally { await server.shutdown(); await local?.stop(); }
