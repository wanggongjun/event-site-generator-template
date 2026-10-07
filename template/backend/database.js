import pg from 'pg';

export async function connectDatabase(connectionString, eventSlug) {
  if (!connectionString) throw new Error('DATABASE_URL is required; PostgreSQL is the only business-data store.');
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', error => { if (!pool.ending) console.error('PostgreSQL idle connection error:', error.code || error.name); });
  try {
    await assertEventDatabase(pool, eventSlug);
    await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
      profile JSONB NOT NULL DEFAULT '{}', profile_complete BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS business (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      attendance_status TEXT CHECK (attendance_status IS NULL OR attendance_status IN ('under_review','accepted','rejected')),
      attendance_data JSONB, attendance_feedback TEXT NOT NULL DEFAULT '', attendance_updated_at BIGINT,
      submission_status TEXT CHECK (submission_status IS NULL OR submission_status IN ('draft','under_review','needs_materials','accepted','rejected')),
      submission_data JSONB, submission_feedback TEXT NOT NULL DEFAULT '', submission_updated_at BIGINT,
      submission_submitted_at BIGINT,
      submission_review_round INTEGER NOT NULL DEFAULT 0 CHECK(submission_review_round >= 0)
    );
    ALTER TABLE business ADD COLUMN IF NOT EXISTS submission_review_round INTEGER NOT NULL DEFAULT 0;
    UPDATE business SET submission_review_round=1 WHERE submission_submitted_at IS NOT NULL AND submission_review_round=0;
    ALTER TABLE business ADD COLUMN IF NOT EXISTS attendance_internal_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE business ADD COLUMN IF NOT EXISTS submission_internal_note TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
      question TEXT NOT NULL, reply TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL,
      replied_at BIGINT, UNIQUE(user_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS questions_user_id ON questions(user_id);
    CREATE TABLE IF NOT EXISTS question_remote_records (
      question_id TEXT PRIMARY KEY REFERENCES questions(id), remote_id TEXT UNIQUE NOT NULL,
      snapshot TEXT NOT NULL, reply_fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS simulation_sms (
      phone TEXT NOT NULL, purpose TEXT NOT NULL, code TEXT NOT NULL, sent_at BIGINT NOT NULL,
      PRIMARY KEY(phone,purpose)
    );
    CREATE TABLE IF NOT EXISTS sync_health (
      id INTEGER PRIMARY KEY CHECK(id=1), last_attempt_at BIGINT, last_success_at BIGINT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );
    INSERT INTO sync_health(id) VALUES(1) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sms_codes (
      phone TEXT NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('register','reset')),
      code_hash TEXT NOT NULL, salt TEXT NOT NULL, expires_at BIGINT NOT NULL,
      sent_at BIGINT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(phone,purpose)
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      mime TEXT NOT NULL, size INTEGER NOT NULL, content BYTEA NOT NULL, created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS files_user_id ON files(user_id);
    CREATE TABLE IF NOT EXISTS review_queue (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      decision TEXT NOT NULL, feedback TEXT NOT NULL, due_at BIGINT NOT NULL, applied_at BIGINT,
      error TEXT
    );
    ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS internal_note TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS review_history (
      id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
      previous_state TEXT, decision TEXT NOT NULL, feedback TEXT NOT NULL, created_at BIGINT NOT NULL,
      source TEXT NOT NULL
    );
    ALTER TABLE review_history ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS remote_records (
      kind TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), remote_id TEXT NOT NULL,
      snapshot TEXT NOT NULL, review_fingerprint TEXT NOT NULL, PRIMARY KEY(kind,user_id), UNIQUE(kind,remote_id)
    );
    ALTER TABLE remote_records ADD COLUMN IF NOT EXISTS review_round INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS feishu_files (
      file_id TEXT PRIMARY KEY REFERENCES files(id), file_token TEXT NOT NULL
    );
  `);
    return pool;
  } catch (error) { await pool.end(); throw error; }
}

export async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

/** Claim a brand-new database once. Never silently reinterpret another event's accounts. */
export async function assertEventDatabase(pool, eventSlug) {
  if (typeof eventSlug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(eventSlug) || eventSlug.length > 64) throw new Error('config.json requires a valid event.slug.');
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('event-template-db-initialize'))");
    await client.query('CREATE TABLE IF NOT EXISTS app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const saved = (await client.query("SELECT value FROM app_metadata WHERE key='event_slug' FOR UPDATE")).rows[0];
    if (saved && saved.value !== eventSlug) throw new Error(`Event database belongs to ${saved.value}; ${eventSlug} requires an independent database. No event data was reset.`);
    if (!saved) {
      for (const table of ['users', 'sms_codes']) {
        const exists = (await client.query('SELECT to_regclass($1) AS existing', [table])).rows[0].existing;
        if (exists && (await client.query(`SELECT EXISTS(SELECT 1 FROM ${table}) AS has_data`)).rows[0].has_data) throw new Error('Database contains unscoped account data; cannot claim it for a new event. Use a separate database or perform an explicit operator migration. No data was reset.');
      }
      await client.query("INSERT INTO app_metadata(key,value) VALUES('event_slug',$1)", [eventSlug]);
    }
  });
}
