import { AliyunSms } from './aliyun-sms.js';
import { FeishuClient, feishuId, feishuText, feishuClientToken } from './feishu-client.js';
import { FEISHU_TABLES } from './feishu-schema.js';

/** Runtime secrets belong in environment variables, never in config.json. */
export class SimulationSms {
  constructor(db) { this.db = db; }
  async send({ phone, purpose, code }) {
    await this.db.query('INSERT INTO simulation_sms(phone,purpose,code,sent_at) VALUES($1,$2,$3,$4) ON CONFLICT(phone,purpose) DO UPDATE SET code=excluded.code,sent_at=excluded.sent_at', [phone, purpose, code, Date.now()]);
    return { mode: 'simulation' };
  }
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

/** Fixed real three-table adapter. Mocked protocol tests are not live Feishu acceptance. */
export class FeishuBitable extends FeishuClient {
  constructor(env, db, options = {}) {
    super(env, options);
    for (const key of ['FEISHU_BITABLE_APP_TOKEN', ...FEISHU_TABLES.map(table => table.envKey)]) feishuId(env[key], `Real Feishu adapter requires ${key}`);
    if (new Set(FEISHU_TABLES.map(table => env[table.envKey])).size !== 3) throw new Error('Real Feishu adapter requires three distinct operational tables.');
    this.db = db;
  }
  table(kind) {
    const spec = FEISHU_TABLES.find(table => table.kind === kind);
    if (!spec) throw new Error('Unsupported Feishu record kind.');
    return this.env[spec.envKey];
  }
  path(kind) { return `/bitable/v1/apps/${this.env.FEISHU_BITABLE_APP_TOKEN}/tables/${this.table(kind)}/records`; }
  fingerprint({ decision, feedback = '', reviewRound, internalNote = '' }) { return JSON.stringify({ decision, feedback, reviewRound, internalNote }); }
  async remoteIndex(kind) {
    const spec = FEISHU_TABLES.find(table => table.kind === kind);
    const byKey = new Map(); const byId = new Map();
    for (const record of await this.list(this.path(kind))) {
      feishuId(record.record_id, 'Remote record ID');
      if (byId.has(record.record_id)) throw new Error(`Duplicate remote record ID in ${kind} pagination.`);
      byId.set(record.record_id, record);
      const key = feishuText(record.fields?.[spec.key]);
      if (!key) continue; // Empty/unowned rows are never inferred from names or phone numbers.
      if (byKey.has(key)) throw new Error(`Duplicate stable business key in the Feishu ${kind} table; resolve it before syncing.`);
      byKey.set(key, record);
    }
    return { byKey, byId };
  }
  async pull(_now, _force, { continueOnError = false } = {}) {
    const updates = []; const errors = [];
    for (const kind of ['attendance', 'submission', 'question']) {
      try {
        const index = await this.remoteIndex(kind);
        for (const remote of index.byId.values()) {
          try {
            if (kind === 'question') {
              const local = (await this.db.query('SELECT q.user_id,r.* FROM question_remote_records r JOIN questions q ON q.id=r.question_id WHERE r.remote_id=$1', [remote.record_id])).rows[0];
              if (!local) continue;
              if (feishuText(remote.fields['问题ID']) !== local.question_id || feishuText(remote.fields['用户ID']) !== local.user_id) throw new Error('Feishu question stable business key no longer matches its local mapping.');
              const reply = feishuText(remote.fields['回复']); const fingerprint = JSON.stringify({ reply });
              if (fingerprint !== local.reply_fingerprint) updates.push({ kind, question_id: local.question_id, user_id: local.user_id, reply, remote_id: remote.record_id, fingerprint });
              continue;
            }
            const local = (await this.db.query('SELECT * FROM remote_records WHERE kind=$1 AND remote_id=$2', [kind, remote.record_id])).rows[0];
            if (!local) continue;
            if (feishuText(remote.fields['用户ID']) !== local.user_id) throw new Error('Feishu review stable business key no longer matches its local mapping.');
            const decision = remote.fields['审核状态'];
            const reviewRound = Number(remote.fields['审核轮次']);
            if (!Number.isInteger(reviewRound) || reviewRound < 1 || reviewRound !== Number(local.review_round)) continue;
            const allowed = kind === 'attendance' ? ['under_review', 'accepted', 'rejected'] : ['under_review', 'accepted', 'rejected', 'needs_materials'];
            if (!allowed.includes(decision)) continue;
            const feedback = feishuText(remote.fields['反馈']); const internalNote = feishuText(remote.fields['内部备注']);
            const fingerprint = this.fingerprint({ decision, feedback, reviewRound, internalNote });
            if (fingerprint !== local.review_fingerprint) updates.push({ kind, user_id: local.user_id, decision, feedback, reviewRound, internalNote, remote_id: remote.record_id, fingerprint });
          } catch (error) {
            if (!continueOnError) throw error;
            errors.push({ kind, remote_id: remote.record_id, message: error.message, ...(error.category ? { category: error.category } : {}), ...(error.code ? { code: error.code } : {}) });
          }
        }
      } catch (error) {
        if (!continueOnError) throw error;
        errors.push({ kind, message: error.message, ...(error.category ? { category: error.category } : {}), ...(error.code ? { code: error.code } : {}) });
      }
    }
    Object.defineProperty(updates, 'errors', { value: errors, enumerable: false });
    return updates;
  }
  async attachment(file) {
    const cached = (await this.db.query('SELECT file_token FROM feishu_files WHERE file_id=$1', [file.id])).rows[0];
    if (cached) return { file_token: cached.file_token };
    const form = new FormData();
    form.set('file_name', file.name); form.set('parent_type', 'bitable_file'); form.set('parent_node', this.env.FEISHU_BITABLE_APP_TOKEN); form.set('size', String(file.size)); form.set('file', new Blob([file.content]), file.name);
    const result = await this.api('/drive/v1/medias/upload_all', { method: 'POST', body: form });
    feishuId(result.file_token, 'Uploaded file token');
    await this.db.query('INSERT INTO feishu_files(file_id,file_token) VALUES($1,$2) ON CONFLICT(file_id) DO NOTHING', [file.id, result.file_token]);
    return { file_token: result.file_token };
  }
  createToken(kind, key) {
    // Official record create API accepts UUIDv4 client_token. Stable across local save failures and process restarts.
    return feishuClientToken('event-template-record', this.env.FEISHU_BITABLE_APP_TOKEN, this.table(kind), key);
  }
  async export(records, { continueOnError = false } = {}) {
    const indexes = new Map(); const exported = new Set(); const errors = [];
    for (const record of records) {
      try {
        const kind = record.kind; this.table(kind);
        const isQuestion = kind === 'question';
        const key = isQuestion ? record.questionId : record.userId;
        if (typeof key !== 'string' || !key) throw new Error('Feishu export requires a stable business key.');
        const batchKey = `${kind}:${key}`;
        if (exported.has(batchKey)) throw new Error('Duplicate local business record in one Feishu export batch.');
        exported.add(batchKey);
        if (!indexes.has(kind)) indexes.set(kind, this.remoteIndex(kind));
        const index = await indexes.get(kind);
        const existing = (await this.db.query(isQuestion ? 'SELECT * FROM question_remote_records WHERE question_id=$1' : 'SELECT * FROM remote_records WHERE kind=$1 AND user_id=$2', isQuestion ? [key] : [kind, key])).rows[0];
        const mapped = existing && index.byId.get(existing.remote_id);
        const remote = index.byKey.get(key);
        if (mapped && mapped !== remote) throw new Error('Feishu remote mapping conflicts with its stable business key.');
        if (isQuestion && remote && feishuText(remote.fields['用户ID']) !== record.userId) throw new Error('Feishu question belongs to a different local user.');
        if (existing && !remote) throw new Error('The mapped Feishu record is missing; operator review is required before recreation.');
        const reviewRound = isQuestion ? null : kind === 'submission' ? Number(record.reviewRound) : Number(record.reviewRound ?? 1);
        if (!isQuestion && (!Number.isInteger(reviewRound) || reviewRound < 1)) throw new Error('Feishu review requires a positive reviewRound.');
        const files = record.files || [];
        const snapshot = JSON.stringify(isQuestion ? { questionId: key, userId: record.userId, phone: record.phone, profile: record.profile, question: record.question, createdAt: record.createdAt } : { userId: key, phone: record.phone, profile: record.profile, data: record.data, reviewRound, files: files.map(file => ({ id: file.id, name: file.name, size: file.size })) });
        const remoteRound = remote ? Number(remote.fields['审核轮次'] ?? 0) : 0;
        if (!isQuestion && remote && Number.isInteger(remoteRound) && remoteRound > reviewRound) throw new Error('Feishu has a newer review round than the local application; refusing a stale export.');
        const newRound = !isQuestion && kind === 'submission' && remote && reviewRound > remoteRound && reviewRound > Number(existing?.review_round || 0);
        if (remote && existing?.remote_id === remote.record_id && existing.snapshot === snapshot && !newRound) continue;
        const profile = record.profile || {}; const data = record.data || {};
        const fields = isQuestion ? { '问题ID': key, '用户ID': record.userId, '手机号': record.phone, '姓名': profile.name || '', '问题': record.question, '提交时间': this.questionTimestamp(record.createdAt) } : { '用户ID': key, '手机号': record.phone, '姓名': profile.name || '', '单位': profile.organization || '', '邮箱': profile.email || '', '职业阶段': profile.identity || '', '资料JSON': JSON.stringify(data), '审核轮次': reviewRound };
        if (kind === 'attendance') fields['报名原因'] = data.motivation || '';
        if (kind === 'submission') { fields['标题'] = data.title || ''; fields['附件'] = await Promise.all(files.map(file => this.attachment(file))); }
        // Staff own status, feedback, internal notes and answers. Only a genuinely new submission round resets review columns.
        if (!remote) {
          if (!isQuestion && !(kind === 'attendance' ? ['under_review', 'accepted', 'rejected'] : ['under_review', 'accepted', 'rejected', 'needs_materials']).includes(record.status)) throw new Error('Invalid Feishu review state.');
          if (isQuestion) fields['回复'] = '';
          else { fields['审核状态'] = record.status; fields['反馈'] = record.feedback || ''; }
        } else if (newRound) {
          if (record.status !== 'under_review') throw new Error('Only a resubmitted under_review round can reset Feishu review columns.');
          fields['审核状态'] = 'under_review'; fields['反馈'] = '';
        }
        let remoteId = remote?.record_id;
        if (!remote || existing?.snapshot !== snapshot || newRound || existing?.remote_id !== remoteId) {
          const path = `${this.path(kind)}${remote ? `/${remote.record_id}` : `?${new URLSearchParams({ client_token: this.createToken(kind, key) })}`}`;
          const result = await this.api(path, { method: remote ? 'PUT' : 'POST', body: JSON.stringify({ fields }) });
          remoteId ||= feishuId(result?.record?.record_id, 'Created remote record ID');
          const savedRemote = { record_id: remoteId, fields: { ...(remote?.fields || {}), ...fields } };
          index.byKey.set(key, savedRemote); index.byId.set(remoteId, savedRemote);
        }
        if (isQuestion) {
          const fingerprint = existing?.reply_fingerprint ?? JSON.stringify({ reply: record.reply || '' });
          await this.db.query('INSERT INTO question_remote_records(question_id,remote_id,snapshot,reply_fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT(question_id) DO UPDATE SET remote_id=excluded.remote_id,snapshot=excluded.snapshot', [key, remoteId, snapshot, fingerprint]);
        } else {
          const fingerprint = (!remote || newRound) ? this.fingerprint({ decision: newRound ? 'under_review' : record.status, feedback: newRound ? '' : record.feedback || '', reviewRound, internalNote: remote ? feishuText(remote.fields['内部备注']) : '' }) : existing?.review_fingerprint ?? this.fingerprint({ decision: record.status, feedback: record.feedback || '', reviewRound, internalNote: '' });
          await this.db.query('INSERT INTO remote_records(kind,user_id,remote_id,snapshot,review_fingerprint,review_round) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(kind,user_id) DO UPDATE SET remote_id=excluded.remote_id,snapshot=excluded.snapshot,review_fingerprint=excluded.review_fingerprint,review_round=excluded.review_round', [kind, key, remoteId, snapshot, fingerprint, reviewRound]);
        }
      } catch (error) {
        if (!continueOnError) throw error;
        errors.push({ kind: record.kind, key: record.kind === 'question' ? record.questionId : record.userId, message: error.message, ...(error.category ? { category: error.category } : {}), ...(error.code ? { code: error.code } : {}) });
      }
    }
    return { errors };
  }
  questionTimestamp(value) {
    const timestamp = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Question createdAt must be a valid timestamp.');
    return timestamp;
  }
}

/** Real mode defaults to the original Aliyun provider; a gateway is opt-in only. */
export function createRealSms(env) {
  const provider = env.SMS_PROVIDER || 'aliyun';
  if (provider === 'aliyun') return new AliyunSms(env);
  if (provider === 'http') return new HttpSms(env);
  throw new Error('SMS_PROVIDER must be aliyun or http.');
}
