import { AliyunSms } from './aliyun-sms.js';

/** Runtime secrets belong in environment variables, never in config.json. */
export class SimulationSms {
  async send({ code }) { return { mode: 'simulation', simulationCode: code }; }
}

export class HttpSms {
  constructor(env) {
    this.url = env.SMS_SEND_URL;
    this.key = env.SMS_API_KEY;
    this.templateId = env.SMS_TEMPLATE_ID;
    if (!this.url || !this.key || !this.url.startsWith('https://')) throw new Error('Real mode requires HTTPS SMS_SEND_URL and SMS_API_KEY.');
  }
  async send({ phone, purpose, code }) {
    const response = await fetch(this.url, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` }, body: JSON.stringify({ phone, purpose, code, templateId: this.templateId }) });
    if (!response.ok) throw new Error(`SMS provider failed (${response.status}).`);
    return { mode: 'real' };
  }
}

export class SimulationFeishu {
  constructor(db) { this.db = db; }
  async pull(now, force = false) {
    return (await this.db.query(`SELECT * FROM review_queue WHERE applied_at IS NULL ${force ? '' : 'AND due_at <= $1'} ORDER BY id`, force ? [] : [now])).rows;
  }
  async export() { /* Intentional local simulation: no third-party writes. */ }
}

/** Optional, untested live adapter. Fixed table schema, not a form/workflow engine. */
export class FeishuBitable {
  constructor(env, db) {
    for (const key of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BITABLE_APP_TOKEN', 'FEISHU_ATTENDANCE_TABLE_ID', 'FEISHU_SUBMISSION_TABLE_ID']) if (!env[key]) throw new Error(`Real Feishu adapter requires ${key}.`);
    this.env = env; this.db = db;
    this.base = 'https://open.feishu.cn/open-apis';
    this.token = null; this.expires = 0;
  }
  async api(path, options = {}) {
    if (!this.token || Date.now() >= this.expires) {
      const response = await fetch(`${this.base}/auth/v3/tenant_access_token/internal`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: this.env.FEISHU_APP_ID, app_secret: this.env.FEISHU_APP_SECRET }) });
      const data = await response.json();
      if (!response.ok || data.code !== 0) throw new Error('Feishu authentication failed.');
      this.token = data.tenant_access_token; this.expires = Date.now() + Math.max(60, data.expire - 120) * 1000;
    }
    const response = await fetch(`${this.base}${path}`, { ...options, signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${this.token}`, ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...options.headers } });
    const data = await response.json();
    if (!response.ok || data.code !== 0) throw new Error(`Feishu request failed (${data.code ?? response.status}).`);
    return data.data;
  }
  table(kind) { return kind === 'attendance' ? this.env.FEISHU_ATTENDANCE_TABLE_ID : this.env.FEISHU_SUBMISSION_TABLE_ID; }
  path(kind) { return `/bitable/v1/apps/${this.env.FEISHU_BITABLE_APP_TOKEN}/tables/${this.table(kind)}/records`; }
  async pull(now) {
    const reviews = [];
    for (const kind of ['attendance', 'submission']) {
      let pageToken;
      do {
        const query = new URLSearchParams({ page_size: '500', ...(pageToken ? { page_token: pageToken } : {}) });
        const data = await this.api(`${this.path(kind)}?${query}`);
        for (const record of data.items ?? []) {
          const local = (await this.db.query('SELECT * FROM remote_records WHERE kind=$1 AND remote_id=$2', [kind, record.record_id])).rows[0];
          const decision = record.fields['审核状态'];
          const rawFeedback = record.fields['反馈'];
          const feedback = typeof rawFeedback === 'string' ? rawFeedback : Array.isArray(rawFeedback) ? rawFeedback.map(item => item.text || '').join('') : '';
          if (local && ['accepted', 'rejected', 'needs_materials'].includes(decision) && JSON.stringify({ decision, feedback }) !== local.review_fingerprint) reviews.push({ kind, user_id: local.user_id, decision, feedback, remote_id: record.record_id, fingerprint: JSON.stringify({ decision, feedback }) });
        }
        pageToken = data.has_more ? data.page_token : null;
      } while (pageToken);
    }
    return reviews;
  }
  async attachment(file) {
    const cached = (await this.db.query('SELECT file_token FROM feishu_files WHERE file_id=$1', [file.id])).rows[0];
    if (cached) return { file_token: cached.file_token };
    const form = new FormData();
    form.set('file_name', file.name); form.set('parent_type', 'bitable_file'); form.set('parent_node', this.env.FEISHU_BITABLE_APP_TOKEN); form.set('size', String(file.size)); form.set('file', new Blob([file.content]), file.name);
    const result = await this.api('/drive/v1/medias/upload_all', { method: 'POST', body: form });
    await this.db.query('INSERT INTO feishu_files(file_id,file_token) VALUES($1,$2) ON CONFLICT(file_id) DO NOTHING', [file.id, result.file_token]);
    return { file_token: result.file_token };
  }
  async export(records) {
    for (const record of records) {
      const existing = (await this.db.query('SELECT * FROM remote_records WHERE kind=$1 AND user_id=$2', [record.kind, record.userId])).rows[0];
      const snapshot = JSON.stringify({ ...record, files: record.files.map(file => ({ id: file.id, name: file.name, size: file.size })) });
      if (existing?.snapshot === snapshot) continue;
      const fields = { '用户ID': record.userId, '手机号': record.phone, '姓名': record.profile.name, '单位': record.profile.organization, '邮箱': record.profile.email || '', '职业阶段': record.profile.identity, '审核状态': record.status, '反馈': record.feedback || '', '资料JSON': JSON.stringify(record.data) };
      if (record.kind === 'attendance') fields['报名原因'] = record.data.motivation || '';
      if (record.kind === 'submission') {
        fields['标题'] = record.data.title;
        fields['审核轮次'] = record.reviewRound;
        fields['附件'] = await Promise.all(record.files.map(file => this.attachment(file)));
      }
      const result = await this.api(`${this.path(record.kind)}${existing ? `/${existing.remote_id}` : ''}`, { method: existing ? 'PUT' : 'POST', body: JSON.stringify({ fields }) });
      const remoteId = existing?.remote_id || result.record.record_id;
      const fingerprint = JSON.stringify({ decision: record.status, feedback: record.feedback || '' });
      await this.db.query('INSERT INTO remote_records(kind,user_id,remote_id,snapshot,review_fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(kind,user_id) DO UPDATE SET snapshot=excluded.snapshot,review_fingerprint=excluded.review_fingerprint', [record.kind, record.userId, remoteId, snapshot, fingerprint]);
    }
  }
}

/** Real mode defaults to the original Aliyun provider; a gateway is opt-in only. */
export function createRealSms(env) {
  const provider = env.SMS_PROVIDER || 'aliyun';
  if (provider === 'aliyun') return new AliyunSms(env);
  if (provider === 'http') return new HttpSms(env);
  throw new Error('SMS_PROVIDER must be aliyun or http.');
}
