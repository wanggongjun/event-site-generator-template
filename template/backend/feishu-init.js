import { open, rename, unlink, lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { FeishuClient, FeishuApiError, feishuId, resolveBitableTarget, feishuClientToken } from './feishu-client.js';
import { FEISHU_TABLES, FEISHU_API_SOURCES } from './feishu-schema.js';

function fieldConflicts(spec, fields) {
  const conflicts = [];
  for (const required of spec.fields) {
    const matching = fields.filter(field => field.field_name === required.field_name);
    if (matching.length > 1) { conflicts.push({ kind: spec.kind, field: required.field_name, issue: 'duplicate_field_name' }); continue; }
    const field = matching[0];
    if (!field) continue;
    if (field.type !== required.type) { conflicts.push({ kind: spec.kind, field: required.field_name, issue: 'field_type', expected: required.type, actual: field.type }); continue; }
    if (required.property?.options) {
      const names = (field.property?.options || []).map(option => option.name);
      const missing = required.property.options.map(option => option.name).filter(name => !names.includes(name));
      if (missing.length) conflicts.push({ kind: spec.kind, field: required.field_name, issue: 'missing_status_options', missing });
      if (new Set(names).size !== names.length) conflicts.push({ kind: spec.kind, field: required.field_name, issue: 'duplicate_status_options' });
    }
  }
  return conflicts;
}
function idsEnv(report) {
  return { FEISHU_BITABLE_APP_TOKEN: report.appToken, ...Object.fromEntries(report.tables.filter(table => table.tableId).map(table => [table.envKey, table.tableId])) };
}
export class FeishuInitializationError extends Error {
  constructor(message, report, cause) { super(message, { cause }); this.name = 'FeishuInitializationError'; this.report = report; }
}
/** Read-only schema and resource-access inspection. Token exchange POST does not mutate Bitable resources. */
export async function planFeishu(env, { client = new FeishuClient(env) } = {}) {
  const report = { mode: 'plan', ready: false, appToken: null, tables: [], operations: [], conflicts: [], errors: [], sources: FEISHU_API_SOURCES, permissions: { initializationAuthorization: 'not required for plan', appApiScopes: 'reads checked by API; write scopes not proven by plan', collaboratorAccess: 'resource reads checked; write access not proven by plan' } };
  try {
    const target = await resolveBitableTarget(env, client); report.appToken = target.appToken; report.sourceType = target.sourceType;
    const root = `/bitable/v1/apps/${report.appToken}/tables`;
    const tables = await client.list(root);
    const inventories = new Map();
    // All table candidates are inspected before any apply, so a later conflict cannot trigger earlier writes.
    for (const table of tables) inventories.set(feishuId(table.table_id, 'Table ID'), await client.list(`${root}/${table.table_id}/fields`));
    const claimed = new Set();
    for (const spec of FEISHU_TABLES) {
      let candidates;
      if (env[spec.envKey]) {
        const id = feishuId(env[spec.envKey], spec.envKey);
        candidates = tables.filter(table => table.table_id === id);
        if (!candidates.length) report.conflicts.push({ kind: spec.kind, issue: 'configured_table_not_found', tableId: id });
      } else {
        candidates = tables.filter(table => table.name === spec.name);
        if (!candidates.length) candidates = tables.filter(table => {
          const fields = inventories.get(table.table_id);
          return !claimed.has(table.table_id) && spec.distinctive.every(name => fields.some(field => field.field_name === name)) && fieldConflicts(spec, fields).length === 0;
        });
      }
      if (candidates.length > 1) { report.conflicts.push({ kind: spec.kind, issue: 'ambiguous_table', tableIds: candidates.map(table => table.table_id) }); report.tables.push({ kind: spec.kind, name: spec.name, envKey: spec.envKey, tableId: null }); continue; }
      const table = candidates[0];
      const entry = { kind: spec.kind, name: table?.name || spec.name, envKey: spec.envKey, tableId: table?.table_id || null, fieldIds: {} };
      report.tables.push(entry);
      if (!table) {
        if (!env[spec.envKey]) report.operations.push({ action: 'create_table', kind: spec.kind, name: spec.name, fields: spec.fields });
        continue;
      }
      if (claimed.has(table.table_id)) report.conflicts.push({ kind: spec.kind, issue: 'table_reused_for_multiple_kinds', tableId: table.table_id });
      claimed.add(table.table_id);
      const fields = inventories.get(table.table_id);
      // Field metadata scopes alone do not prove record-read access. Probe one record and never include its contents in the report.
      await client.api(`${root}/${table.table_id}/records?${new URLSearchParams({ page_size: '1' })}`);
      entry.recordsReadable = true;
      report.conflicts.push(...fieldConflicts(spec, fields).map(conflict => ({ ...conflict, tableId: table.table_id })));
      for (const required of spec.fields) {
        const existing = fields.find(field => field.field_name === required.field_name);
        if (existing) entry.fieldIds[required.field_name] = existing.field_id;
        else report.operations.push({ action: 'create_field', kind: spec.kind, tableId: table.table_id, field: required });
      }
    }
    report.ready = report.conflicts.length === 0 && report.operations.length === 0;
    report.env = idsEnv(report);
  } catch (error) {
    report.errors.push({ category: error instanceof FeishuApiError ? error.category : 'configuration', code: error.code ?? null, requestId: error.requestId ?? null, message: error.message });
  }
  return report;
}
/** Apply only additive fixed-schema operations inside one explicitly authorized existing base. Never creates credentials or changes sharing. */
export async function initializeFeishu(env, { mode = 'plan', authorizeBase, client = new FeishuClient(env), outputFile } = {}) {
  if (!['plan', 'dry-run', 'apply'].includes(mode)) throw new Error('Feishu initialization mode must be plan, dry-run or apply.');
  const report = await planFeishu(env, { client }); report.mode = mode;
  if (report.errors.length) throw new FeishuInitializationError('Feishu initialization inspection is blocked.', report);
  if (mode !== 'apply') {
    if (outputFile && report.ready) await writeFeishuIds(outputFile, report.env);
    return report;
  }
  if (!authorizeBase || authorizeBase !== report.appToken) throw new FeishuInitializationError('Apply requires --authorize-base=<exact resolved app token>. This approval does not grant API scopes or collaborator permissions.', report);
  report.permissions.initializationAuthorization = 'exact base token approved for additive tables/fields';
  if (report.conflicts.length) throw new FeishuInitializationError('Existing Feishu schema conflicts require operator review; no fields, status options or tables were changed.', report);
  const applied = [];
  try {
    for (const operation of report.operations) {
      if (operation.action === 'create_table') {
        // Re-read before create. A previous interrupted run (or another operator) may have already created it.
        const current = await client.list(`/bitable/v1/apps/${report.appToken}/tables`);
        const found = current.filter(table => table.name === operation.name);
        if (found.length > 1) throw new Error(`Ambiguous ${operation.kind} table during apply.`);
        if (found.length) {
          const fields = await client.list(`/bitable/v1/apps/${report.appToken}/tables/${found[0].table_id}/fields`);
          const conflicts = fieldConflicts({ kind: operation.kind, fields: operation.fields }, fields);
          if (conflicts.length) throw new FeishuInitializationError('A table appeared with incompatible fields during apply; stop for operator review.', { ...report, conflicts, applied });
        } else {
          await client.api(`/bitable/v1/apps/${report.appToken}/tables`, { method: 'POST', body: JSON.stringify({ table: { name: operation.name, default_view_name: '全部记录', fields: operation.fields } }) });
          applied.push(operation);
        }
      } else {
        const path = `/bitable/v1/apps/${report.appToken}/tables/${operation.tableId}/fields`;
        const fields = await client.list(path);
        const present = fields.filter(field => field.field_name === operation.field.field_name);
        if (present.length > 1) throw new Error('Ambiguous field during apply.');
        if (present.length) {
          const conflicts = fieldConflicts({ kind: operation.kind, fields: [operation.field] }, fields);
          if (conflicts.length) throw new Error('Field changed incompatibly during apply.');
        } else { await client.api(`${path}?${new URLSearchParams({ client_token: feishuClientToken('event-template-field', report.appToken, operation.tableId, operation.field.field_name) })}`, { method: 'POST', body: JSON.stringify(operation.field) }); applied.push(operation); }
      }
    }
    const verified = await planFeishu(env, { client });
    if (!verified.ready) throw new FeishuInitializationError('Post-apply inspection is not ready; inspect the partial report and rerun plan before retrying.', { ...verified, applied });
    const result = { ...verified, mode: 'apply', applied, permissions: { ...verified.permissions, initializationAuthorization: report.permissions.initializationAuthorization, appApiScopes: applied.length ? 'required writes checked for applied operations' : 'reads checked; no write operation required', collaboratorAccess: applied.length ? 'required writes checked for applied operations' : 'reads checked; no write operation required' } };
    if (outputFile) await writeFeishuIds(outputFile, result.env);
    return result;
  } catch (error) {
    if (error instanceof FeishuInitializationError) throw error;
    throw new FeishuInitializationError('Feishu apply stopped. Completed operations were retained; rerun plan before retrying.', { ...report, ready: false, applied, errors: [{ category: error.category || 'apply', code: error.code ?? null, requestId: error.requestId ?? null, message: error.message }] }, error);
  }
}
export async function writeFeishuIds(filename, env) {
  const keys = ['FEISHU_BITABLE_APP_TOKEN', ...FEISHU_TABLES.map(table => table.envKey)];
  const body = '# Generated non-secret Feishu resource IDs. Load alongside a separate secret env file.\n' + keys.map(key => `${key}=${feishuId(env[key], key)}`).join('\n') + '\n';
  const path = resolve(filename);
  try {
    const existing = await lstat(path);
    if (!existing.isFile()) throw new Error('Refusing to overwrite an existing non-generated file with Feishu IDs.');
    const previous = await readFile(path, 'utf8');
    if (!previous.startsWith('# Generated non-secret Feishu resource IDs.') || previous.split(/\r?\n/).some(line => line.trim() && !line.startsWith('#') && !keys.includes(line.split('=')[0]))) throw new Error('Refusing to overwrite an existing non-generated file with Feishu IDs.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(body); await file.close(); await rename(temporary, path); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}
export async function feishuInitMain(argv = process.argv.slice(2), runtimeEnv = process.env) {
  const { values } = parseArgs({ args: argv, options: { plan: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, 'authorize-base': { type: 'string' }, output: { type: 'string' }, url: { type: 'string' }, 'app-token': { type: 'string' }, help: { type: 'boolean' } }, strict: true });
  if (values.help) { console.log('node --env-file=<secret-env> backend/feishu-init.js [--plan|--dry-run|--apply --authorize-base=<resolved-app-token>] [--url=<base-or-wiki-url>|--app-token=<token>] [--output=<ids-env-file>]'); return 0; }
  if ([values.plan, values['dry-run'], values.apply].filter(Boolean).length > 1) throw new Error('Select only one initialization mode.');
  if (values.url && values['app-token']) throw new Error('Select either --url or --app-token.');
  const env = { ...runtimeEnv };
  if (values.url) { env.FEISHU_BITABLE_URL = values.url; delete env.FEISHU_BITABLE_APP_TOKEN; }
  if (values['app-token']) { env.FEISHU_BITABLE_APP_TOKEN = values['app-token']; delete env.FEISHU_BITABLE_URL; }
  const mode = values.apply ? 'apply' : values['dry-run'] ? 'dry-run' : 'plan';
  try {
    const report = await initializeFeishu(env, { mode, authorizeBase: values['authorize-base'], outputFile: values.output || (values.apply ? '.env.feishu.ids' : undefined) });
    console.log(JSON.stringify(report, null, 2)); return report.conflicts.length ? 1 : 0;
  } catch (error) { console.error(JSON.stringify(error.report || { ready: false, errors: [{ message: error.message }] }, null, 2)); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await feishuInitMain(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
