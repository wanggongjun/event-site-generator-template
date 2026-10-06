import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Local-only demonstration/test PostgreSQL; never used implicitly in real mode. */
export async function startLocalPostgres({ dataDir, port = 55432, user = 'event_demo', password = 'local_demo_only', persistent = true } = {}) {
  if (!dataDir) throw new Error('Local PostgreSQL needs an explicit data directory.');
  const directory = resolve(dataDir);
  // Shared filesystems can span process/network namespaces. PID/TCP absence here
  // never proves that the recorded PostgreSQL owner in another namespace stopped.
  if (existsSync(resolve(directory, 'postmaster.pid'))) throw new Error(`PostgreSQL ownership is active or unknown at ${directory}. postmaster.pid exists; refuse a second owner. Stop the original instance in its original terminal and confirm it has exited. Do not delete the PID file or reinitialize data.`);
  const database = new EmbeddedPostgres({ databaseDir: directory, port, user, password, persistent, authMethod: 'scram-sha-256', postgresFlags: ['-c', 'unix_socket_directories=', '-c', 'listen_addresses=127.0.0.1'] });
  try {
    if (!existsSync(resolve(directory, 'PG_VERSION'))) await database.initialise();
    await database.start();
  } catch (error) {
    // The upstream package rejects startup with undefined on early process exit.
    // Clear only its already-exited process reference; never alter database files.
    if (database.process?.exitCode !== null || database.process?.signalCode) database.process = undefined;
    throw new Error(`Local PostgreSQL could not start at ${directory}. Existing data was left unchanged. Inspect the preceding PostgreSQL logs; do not reset or delete database files. ${error?.message || 'The PostgreSQL process exited before becoming ready.'}`, { cause: error });
  }
  return { database, connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`, stop: () => database.stop() };
}
