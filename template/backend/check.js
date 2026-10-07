// Read-only integration inspection: never sends SMS, creates records, or grants permissions.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { businessReadiness } from './readiness.js';
import { createRealSms, FeishuBitable } from './adapters.js';
import { planFeishu } from './feishu-init.js';

export async function checkIntegration(env, { config, plan = planFeishu, pool } = {}) {
  const report = { codeConfigurationReady: false, liveReadChecksPassed: false, productionAcceptancePassed: false, checks: {}, missing: [], risks: ['Live SMS delivery, Feishu write/attachment/review roundtrip, HTTPS and backup restore require preproduction acceptance.'] };
  if (!config) config = JSON.parse(await readFile(env.EVENT_CONFIG_PATH || resolve(env.APP_ROOT || resolve(import.meta.dirname, '..'), 'config.json'), 'utf8'));
  report.checks.eventFacts = businessReadiness(config);
  if (report.checks.eventFacts.mode !== 'ready') report.missing.push(...report.checks.eventFacts.unresolved.map(item => item.key));
  if (env.APP_MODE && env.APP_MODE !== 'real' || env.FEISHU_MODE && env.FEISHU_MODE !== 'real') report.missing.push('Real runtime mode');
  if (!env.PUBLIC_ORIGIN?.startsWith('https://')) report.missing.push('HTTPS PUBLIC_ORIGIN');
  try { createRealSms(env); report.checks.sms = 'provider configuration accepted; no message sent'; }
  catch (error) { report.checks.sms = error.message; report.missing.push('SMS provider configuration'); }
  try { new FeishuBitable(env, null); report.checks.runtimeFeishu = 'existing app identity and all three distinct table IDs configured'; }
  catch (error) { report.checks.runtimeFeishu = error.message; report.missing.push('Feishu runtime identity/resource IDs'); }
  const feishu = await plan(env);
  report.checks.feishu = feishu;
  if (!feishu.ready) report.missing.push('Feishu three-table schema/resource read access');
  if (!env.DATABASE_URL && !pool) report.missing.push('DATABASE_URL');
  else {
    const db = pool || new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN READ ONLY');
      await client.query('SELECT 1');
      const saved = (await client.query("SELECT value FROM app_metadata WHERE key='event_slug'")).rows[0];
      if (saved?.value !== config.event.slug) throw new Error('Database event identity mismatch or not initialized.');
      const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1::text[])", [['users','business','questions','question_remote_records','remote_records','files','sync_health']]);
      if (tables.rows.length !== 7) throw new Error('Database schema migration is incomplete; run the configured backend once before acceptance.');
      report.checks.database = 'event identity and required tables checked read-only';
      report.checks.syncHealth = (await client.query('SELECT last_attempt_at,last_success_at,consecutive_failures,last_error FROM sync_health WHERE id=1')).rows[0];
      await client.query('ROLLBACK');
    } catch (error) { await client?.query('ROLLBACK').catch(() => {}); report.checks.database = error.message; report.missing.push('Database access/schema/event identity'); }
    finally { client?.release(); if (!pool) await db.end(); }
  }
  report.codeConfigurationReady = report.missing.length === 0;
  report.liveReadChecksPassed = report.codeConfigurationReady;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const report = await checkIntegration(process.env); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.codeConfigurationReady ? 0 : 1; }
  catch (error) { console.error(JSON.stringify({ codeConfigurationReady: false, error: error.message })); process.exitCode = 1; }
}
