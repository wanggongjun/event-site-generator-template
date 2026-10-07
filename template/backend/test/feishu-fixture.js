import assert from 'node:assert/strict';
import { FEISHU_TABLES } from '../feishu-schema.js';
export const feishuEnv = { FEISHU_APP_ID: 'cli_mock_only', FEISHU_APP_SECRET: 'mock_only_never_live', FEISHU_BITABLE_APP_TOKEN: 'base_mock_only', FEISHU_ATTENDANCE_TABLE_ID: 'tbl_attendance', FEISHU_SUBMISSION_TABLE_ID: 'tbl_submission', FEISHU_QUESTION_TABLE_ID: 'tbl_question' };
export class MockFeishu {
  constructor({ populated = true, pageSize = 2 } = {}) {
    this.tables = []; this.calls = []; this.pageSize = pageSize; this.tokens = new Map(); this.nextRecord = 1; this.nextTable = 1; this.nextField = 1; this.nextFile = 1; this.fail = null;
    if (populated) for (const spec of FEISHU_TABLES) this.addTable(spec);
  }
  addTable(spec, name = spec.name, id = feishuEnv[spec.envKey]) {
    const table = { table_id: id, name, fields: structuredClone(spec.fields).map(field => ({ ...field, field_id: `fld_${this.nextField++}` })), records: [] }; this.tables.push(table); return table;
  }
  table(kind) { return this.tables.find(table => table.table_id === feishuEnv[FEISHU_TABLES.find(spec => spec.kind === kind).envKey]); }
  response(data = {}, code = 0, status = 200) { return { ok: status < 400, status, headers: { get: () => 'mock_request_only' }, json: async () => ({ code, data, ...(data.tenant_access_token ? data : {}) }) }; }
  page(items, url) {
    const start = Number(url.searchParams.get('page_token') || 0); const end = start + Math.min(this.pageSize, Number(url.searchParams.get('page_size')));
    if (url.pathname.endsWith('/records')) assert.ok(['1', '500'].includes(url.searchParams.get('page_size')));
    else assert.equal(url.searchParams.get('page_size'), '100');
    return { items: structuredClone(items.slice(start, end)), has_more: end < items.length, ...(end < items.length ? { page_token: String(end) } : {}) };
  }
  transport = async (input, options = {}) => {
    const url = new URL(input); const method = options.method || 'GET';
    assert.equal(url.origin, 'https://open.feishu.cn'); assert.equal(options.redirect, 'error');
    const body = options.body instanceof FormData ? options.body : options.body ? JSON.parse(options.body) : null;
    this.calls.push({ url, method, body, headers: options.headers });
    if (this.fail) { const failure = await this.fail({ url, method, body }); if (failure) return failure; }
    if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) return this.response({ tenant_access_token: 'mock_tenant_only', expire: 7200 });
    assert.equal(options.headers.authorization, 'Bearer mock_tenant_only');
    if (url.pathname.endsWith('/wiki/v2/spaces/get_node')) return this.response({ node: { obj_type: this.wikiType || 'bitable', obj_token: feishuEnv.FEISHU_BITABLE_APP_TOKEN } });
    if (url.pathname.endsWith('/drive/v1/medias/upload_all')) {
      assert.ok(body instanceof FormData); assert.equal(body.get('parent_type'), 'bitable_file'); assert.equal(body.get('parent_node'), feishuEnv.FEISHU_BITABLE_APP_TOKEN); assert.equal(body.get('size'), String(body.get('file').size));
      return this.response({ file_token: `file_mock_${this.nextFile++}` });
    }
    const match = url.pathname.match(/^\/open-apis\/bitable\/v1\/apps\/([^/]+)\/tables(?:\/([^/]+)(?:\/(fields|records)(?:\/([^/]+))?)?)?$/);
    assert.ok(match, `Unexpected mocked endpoint ${url.pathname}`); assert.equal(match[1], feishuEnv.FEISHU_BITABLE_APP_TOKEN);
    if (!match[2]) {
      if (method === 'GET') return this.response(this.page(this.tables.map(({ table_id, name }) => ({ table_id, name })), url));
      assert.equal(method, 'POST');
      if (this.tables.some(table => table.name === body.table.name)) return this.response({}, 1254013);
      const id = `tbl_created_${this.nextTable++}`;
      const table = { table_id: id, name: body.table.name, fields: body.table.fields.map(field => ({ ...field, field_id: `fld_${this.nextField++}` })), records: [] };
      this.tables.push(table); return this.response({ table_id: id, field_id_list: table.fields.map(field => field.field_id) });
    }
    const table = this.tables.find(table => table.table_id === match[2]); if (!table) return this.response({}, 1254041);
    if (match[3] === 'fields') {
      if (method === 'GET') return this.response(this.page(table.fields, url));
      assert.equal(method, 'POST'); assert.match(url.searchParams.get('client_token'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      if (table.fields.some(field => field.field_name === body.field_name)) return this.response({}, 1254014);
      const field = { ...body, field_id: `fld_${this.nextField++}` }; table.fields.push(field); return this.response({ field });
    }
    if (method === 'GET') return this.response(this.page(table.records, url));
    if (method === 'POST') {
      const token = url.searchParams.get('client_token'); assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      if (this.tokens.has(token)) return this.response({ record: this.tokens.get(token) });
      const record = { record_id: `rec_mock_${this.nextRecord++}`, fields: body.fields }; table.records.push(record); this.tokens.set(token, record); return this.response({ record: structuredClone(record) });
    }
    assert.equal(method, 'PUT'); const record = table.records.find(record => record.record_id === match[4]); assert.ok(record);
    record.fields = { ...record.fields, ...body.fields }; return this.response({ record: structuredClone(record) });
  };
  writes() { return this.calls.filter(call => ['POST', 'PUT', 'DELETE', 'PATCH'].includes(call.method) && !call.url.pathname.includes('/auth/')); }
}
