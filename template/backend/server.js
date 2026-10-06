import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDatabase, assertEventDatabase, transaction } from './database.js';
import { SimulationSms, createRealSms, SimulationFeishu, FeishuBitable } from './adapters.js';
import { detectDocument } from './files.js';

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };
const digest = value => createHash('sha256').update(value).digest('hex');
const id = () => randomBytes(18).toString('base64url');
const clean = (value, max = 1000, label = '字段') => {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail(400, 'INVALID_INPUT', `${label}格式不正确`);
  return value.trim();
};
const normalizePhone = value => {
  const phone = clean(value, 20, '手机号').replace(/[\s-]/g, '');
  if (/^1[3-9]\d{9}$/.test(phone)) return `+86${phone}`;
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  fail(400, 'INVALID_PHONE', '请输入有效手机号（国际号码须含国家区号）');
};
const password = value => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 8 || Buffer.byteLength(value, 'utf8') > 72) fail(400, 'INVALID_PASSWORD', '密码须为8至72个UTF-8字节');
  return value;
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMPTY_SUBMISSION = { title: '', abstract: '', keywords: [], authors: [], presenter: '', note: '', attachmentIds: [] };

export async function createServer(options = {}) {
  const env = { ...process.env, ...options.env };
  const appRoot = resolve(options.appRoot || env.APP_ROOT || resolve(import.meta.dirname, '..'));
  const configPath = options.configPath || env.EVENT_CONFIG_PATH || resolve(appRoot, 'config.json');
  const staticRoot = resolve(options.staticRoot || env.STATIC_DIR || resolve(appRoot, 'dist'));
  const mode = options.mode || env.APP_MODE || 'simulation';
  if (!['simulation', 'real'].includes(mode)) throw new Error('APP_MODE must be simulation or real.');
  const origin = options.publicOrigin || env.PUBLIC_ORIGIN || 'http://localhost:3000';
  if (mode === 'real' && !origin.startsWith('https://')) throw new Error('Real mode requires an HTTPS PUBLIC_ORIGIN.');
  const initialConfig = JSON.parse(await readFile(configPath, 'utf8'));
  if (!initialConfig.event?.title) throw new Error('config.json requires event.title.');
  const eventSlug = initialConfig.event?.slug;
  const db = options.pool || await connectDatabase(options.databaseUrl || env.DATABASE_URL, eventSlug);
  if (options.pool) await assertEventDatabase(db, eventSlug);
  const ownPool = !options.pool;
  const sms = options.smsAdapter || (mode === 'simulation' ? new SimulationSms() : createRealSms(env));
  const feishuMode = env.FEISHU_MODE || (mode === 'simulation' ? 'simulation' : 'real');
  if (mode === 'real' && feishuMode !== 'real') throw new Error('Real mode requires real Feishu configuration.');
  const feishu = options.feishuAdapter || (feishuMode === 'simulation' ? new SimulationFeishu(db) : new FeishuBitable(env, db));
  const now = options.now || (() => Date.now());
  const rates = new Map();
  let syncing = false;
  let syncError = null;
  let lastSyncAt = null;
  let timer;
  async function config() {
    const parsed = JSON.parse(await readFile(configPath, 'utf8'));
    if (!parsed.event?.title) throw new Error('config.json requires event.title.');
    if (parsed.event?.slug !== eventSlug) throw new Error('Event slug changed while running; a different event requires a separate database.');
    return parsed;
  }
  const pollSeconds = Math.max(1, Math.min(3600, Number(env.SYNC_POLL_SECONDS || initialConfig.sync?.pollSeconds || 60)));
  const takeRate = (key, limit, windowMs) => {
    const time = now(), entry = rates.get(key);
    if (!entry || entry.until <= time) rates.set(key, { count: 1, until: time + windowMs });
    else { entry.count++; if (entry.count > limit) fail(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试'); }
    if (rates.size > 10000) for (const [k, value] of rates) if (value.until <= time) rates.delete(k);
  };
  const result = async (sql, args = [], client = db) => (await client.query(sql, args)).rows;
  const one = async (sql, args = [], client = db) => (await result(sql, args, client))[0];
  async function readBody(req, max = 65536) {
    let length = 0; const chunks = [];
    for await (const chunk of req) { length += chunk.length; if (length > max) fail(413, 'TOO_LARGE', '请求内容过大'); chunks.push(chunk); }
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'CONTENT_TYPE', '请使用application/json');
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error(); return body; }
    catch { fail(400, 'INVALID_JSON', 'JSON格式不正确'); }
  }
  const send = (res, status, data, extra = {}) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
    res.end(JSON.stringify(data));
  };
  const cookie = (token, clear = false) => `event_session=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; ${mode === 'real' ? 'Secure; ' : ''}Max-Age=${clear ? 0 : 604800}`;
  async function session(req) {
    const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('event_session='))?.slice(14);
    if (!raw || !/^[A-Za-z0-9_-]{40,60}$/.test(raw)) fail(401, 'UNAUTHENTICATED', '请先登录');
    const user = await one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2', [digest(raw), now()]);
    if (!user) fail(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
    return { user, tokenHash: digest(raw) };
  }
  async function newSession(userId, client = db) {
    const token = randomBytes(32).toString('base64url');
    await client.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [digest(token), userId, now() + 604800000]);
    return token;
  }
  async function checkCode(client, phone, purpose, code) {
    const row = await one('SELECT * FROM sms_codes WHERE phone=$1 AND purpose=$2 FOR UPDATE', [phone, purpose], client);
    if (!row || Number(row.expires_at) < now() || row.attempts >= 5 || !/^\d{6}$/.test(String(code))) return false;
    const correct = timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(digest(`${row.salt}:${code}`), 'hex'));
    if (!correct) { await client.query('UPDATE sms_codes SET attempts=attempts+1 WHERE phone=$1 AND purpose=$2', [phone, purpose]); return false; }
    await client.query('DELETE FROM sms_codes WHERE phone=$1 AND purpose=$2', [phone, purpose]);
    return true;
  }
  function profileData(body, cfg) {
    const data = {};
    for (const key of ['name', 'email', 'organization', 'researchDirection', 'department', 'job', 'personalIntroduction']) data[key] = clean(body[key] ?? '', key === 'personalIntroduction' ? 2000 : 250, key);
    data.identity = clean(body.identity || cfg.profile?.defaultIdentity || '研究人员', 100, '身份');
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail(400, 'INVALID_EMAIL', '邮箱格式不正确');
    return data;
  }
  const profileComplete = profile => ['name', 'email', 'organization', 'identity', 'researchDirection'].every(key => Boolean(profile[key]));
  function submissionData(body) {
    const data = {};
    for (const key of ['title', 'abstract', 'presenter', 'note']) data[key] = clean(body[key] ?? '', key === 'title' ? 250 : key === 'presenter' ? 250 : 15000, key);
    if (!Array.isArray(body.keywords ?? []) || (body.keywords ?? []).length > 20) fail(400, 'INVALID_KEYWORDS', '关键词应为最多20项的数组');
    data.keywords = (body.keywords ?? []).map(x => clean(x, 100, '关键词')).filter(Boolean);
    if (!Array.isArray(body.authors ?? []) || (body.authors ?? []).length > 50) fail(400, 'INVALID_AUTHORS', '作者应为最多50项的数组');
    data.authors = (body.authors ?? []).map(author => {
      if (!author || Array.isArray(author) || typeof author !== 'object') fail(400, 'INVALID_AUTHORS', '每位作者须包含姓名和单位');
      return { name: clean(author.name ?? '', 150, '作者'), affiliation: clean(author.affiliation ?? '', 250, '作者单位') };
    });
    if (!Array.isArray(body.attachmentIds ?? []) || !(body.attachmentIds ?? []).every(x => typeof x === 'string' && /^[\w-]{10,50}$/.test(x))) fail(400, 'INVALID_ATTACHMENTS', '附件ID格式不正确');
    data.attachmentIds = [...new Set(body.attachmentIds ?? [])];
    return data;
  }
  async function checkAttachments(client, userId, ids, cfg, required = false) {
    const max = cfg.files?.maxAttachments ?? 3;
    if (ids.length > max || (required && !ids.length)) fail(400, 'INVALID_ATTACHMENTS', `请添加1至${max}份附件`);
    const files = ids.length ? await result('SELECT id,name,size,mime FROM files WHERE user_id=$1 AND id=ANY($2::text[])', [userId, ids], client) : [];
    if (files.length !== ids.length) fail(403, 'FILE_FORBIDDEN', '只能使用自己的附件');
    return files;
  }
  function checkWindow(cfg, kind, supplement = false) {
    const settings = cfg[kind] || {};
    if (settings.enabled === false) fail(403, 'MODULE_DISABLED', '此功能未开放');
    const open = settings.openAt ? Date.parse(settings.openAt) : NaN;
    const close = supplement ? Date.parse(settings.supplementCloseAt || settings.closeAt || '') : Date.parse(settings.closeAt || '');
    if (Number.isFinite(open) && now() < open || Number.isFinite(close) && now() > close) fail(409, 'WINDOW_CLOSED', '此申请窗口尚未开放或已截止');
  }
  async function stats(cfg, client = db) {
    const counts = await one(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE attendance_status='accepted')::int AS manual, COUNT(*) FILTER (WHERE submission_status='accepted')::int AS submissions FROM business WHERE attendance_status='accepted' OR submission_status='accepted'`, [], client);
    const capacity = Number(cfg.event?.capacity) || null;
    return { total: counts.total, manualApprovals: counts.manual, acceptedSubmissions: counts.submissions, capacity, capacityWarning: Boolean(capacity && counts.total >= capacity) };
  }
  function attendanceView(row) {
    const sources = [];
    if (row?.attendance_status === 'accepted') sources.push('manual_attendance');
    if (row?.submission_status === 'accepted') sources.push('accepted_submission');
    return { status: row?.attendance_status || null, motivation: row?.attendance_data?.motivation || '', feedback: row?.attendance_feedback || '', updatedAt: row?.attendance_updated_at ? new Date(Number(row.attendance_updated_at)).toISOString() : null, attendanceGranted: sources.length > 0, grantSources: sources };
  }
  async function submissionView(row, userId, cfg) {
    if (!row?.submission_status) return null;
    const data = row.submission_data || EMPTY_SUBMISSION;
    const attachments = data.attachmentIds?.length ? await result('SELECT id,name,size,mime FROM files WHERE user_id=$1 AND id=ANY($2::text[])', [userId, data.attachmentIds]) : [];
    return { ...data, reviewRound: row.submission_review_round || 0, status: row.submission_status, feedback: row.submission_feedback || '', attachments, updatedAt: new Date(Number(row.submission_updated_at)).toISOString(), submittedAt: row.submission_submitted_at ? new Date(Number(row.submission_submitted_at)).toISOString() : null };
  }
  async function applyReview(review) {
    return transaction(db, async client => {
      if (review.id) {
        const queued = await one('SELECT applied_at FROM review_queue WHERE id=$1 FOR UPDATE', [review.id], client);
        if (!queued || queued.applied_at) return false;
      }
      const row = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [review.user_id], client);
      const kind = review.kind;
      if (!['attendance', 'submission'].includes(kind)) throw new Error('Invalid review kind.');
      const states = kind === 'attendance' ? ['accepted', 'rejected'] : ['accepted', 'rejected', 'needs_materials'];
      if (!states.includes(review.decision)) throw new Error('Invalid review decision.');
      if (!row?.[`${kind}_status`] || row[`${kind}_status`] === 'draft') throw new Error('No submitted application to review.');
      const previous = row[`${kind}_status`];
      await client.query(`UPDATE business SET ${kind}_status=$1,${kind}_feedback=$2,${kind}_updated_at=$3 WHERE user_id=$4`, [review.decision, clean(review.feedback || '', 10000, '反馈'), now(), review.user_id]);
      await client.query('INSERT INTO review_history(user_id,kind,previous_state,decision,feedback,created_at,source) VALUES($1,$2,$3,$4,$5,$6,$7)', [review.user_id, kind, previous, review.decision, review.feedback || '', now(), review.remote_id ? 'feishu' : 'simulation']);
      if (review.id) await client.query('UPDATE review_queue SET applied_at=$1,error=NULL WHERE id=$2', [now(), review.id]);
      if (review.remote_id) await client.query('UPDATE remote_records SET review_fingerprint=$1 WHERE kind=$2 AND remote_id=$3', [review.fingerprint, kind, review.remote_id]);
      return true;
    });
  }
  async function syncReviews({ force = false } = {}) {
    if (syncing) return { busy: true };
    if (force && mode !== 'simulation') throw new Error('Force synchronization is simulation-only.');
    syncing = true;
    let lockClient;
    let locked = false;
    try {
      lockClient = await db.connect();
      locked = (await lockClient.query("SELECT pg_try_advisory_lock(hashtext('event-template-review-sync')) AS locked")).rows[0].locked;
      if (!locked) return { busy: true };
      await config(); // Refuse a changed event identity before reading or applying reviews.
      const reviews = await feishu.pull(now(), force);
      let applied = 0;
      for (const review of reviews) {
        try { if (await applyReview(review)) applied++; }
        catch (error) {
          if (!review.id) throw error;
          await db.query('UPDATE review_queue SET error=$1,applied_at=$2 WHERE id=$3', [error.message, now(), review.id]);
        }
      }
      const rows = await result('SELECT u.id,u.phone,u.profile,b.* FROM users u JOIN business b ON b.user_id=u.id');
      const records = [];
      for (const row of rows) for (const kind of ['attendance', 'submission']) {
        if (!row[`${kind}_status`] || row[`${kind}_status`] === 'draft') continue;
        const data = row[`${kind}_data`];
        const files = kind === 'submission' && data.attachmentIds?.length ? await result('SELECT * FROM files WHERE user_id=$1 AND id=ANY($2::text[])', [row.id, data.attachmentIds]) : [];
        records.push({ kind, reviewRound: kind === 'submission' ? row.submission_review_round : undefined, userId: row.id, phone: row.phone, profile: row.profile, data, status: row[`${kind}_status`], feedback: row[`${kind}_feedback`], files });
      }
      await feishu.export(records);
      syncError = null; lastSyncAt = now();
      await db.query('DELETE FROM sessions WHERE expires_at<$1', [now()]);
      return { applied, lastSyncAt: new Date(lastSyncAt).toISOString() };
    } catch (error) { syncError = error.message; throw error; }
    finally {
      if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext('event-template-review-sync'))");
      lockClient?.release();
      syncing = false;
    }
  }
  function requireSimulation(req) {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (mode !== 'simulation' || !local || req.headers.host !== new URL(origin).host) fail(404, 'NOT_FOUND', '页面不存在');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, origin);
      let path;
      try { path = decodeURIComponent(url.pathname); } catch { fail(400, 'INVALID_URL', '请求地址格式不正确'); }
      const method = req.method;
      const currentConfig = path.startsWith('/api/') ? await config() : null;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        if (req.headers.origin !== origin) fail(403, 'ORIGIN_FORBIDDEN', '请求来源不被允许');
        takeRate(`all:${req.socket.remoteAddress}`, 180, 60000);
      }
      if (path === '/api/public/config' && method === 'GET') return send(res, 200, { config: currentConfig, runtime: { mode, smsMode: mode, feishuMode, pollSeconds } });
      if (path === '/api/auth/sms/request' && method === 'POST') {
        const body = await readBody(req), phone = normalizePhone(body.phone), purpose = body.purpose;
        if (!['register', 'reset'].includes(purpose)) fail(400, 'INVALID_PURPOSE', '验证码用途不正确');
        takeRate(`sms-ip:${req.socket.remoteAddress}`, 10, 600000); takeRate(`sms:${phone}`, 5, 3600000);
        const existing = await one('SELECT id FROM users WHERE phone=$1', [phone]);
        if (purpose === 'register' && existing) fail(409, 'PHONE_REGISTERED', '此手机号已注册，请使用密码登录或重置密码');
        if (purpose === 'reset' && !existing) return send(res, 200, { ok: true, mode, message: '若该手机号已注册，验证码将发送至该号码' });
        const previous = await one('SELECT sent_at FROM sms_codes WHERE phone=$1 AND purpose=$2', [phone, purpose]);
        if (previous && now() - Number(previous.sent_at) < 60000) fail(429, 'SMS_COOLDOWN', '请60秒后重试');
        const code = String(randomInt(0, 1000000)).padStart(6, '0'), salt = id();
        const response = await sms.send({ phone, purpose, code });
        await db.query('INSERT INTO sms_codes(phone,purpose,code_hash,salt,expires_at,sent_at,attempts) VALUES($1,$2,$3,$4,$5,$6,0) ON CONFLICT(phone,purpose) DO UPDATE SET code_hash=excluded.code_hash,salt=excluded.salt,expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0', [phone, purpose, digest(`${salt}:${code}`), salt, now() + 600000, now()]);
        return send(res, 200, { ok: true, ...response, expiresIn: 600, retryAfter: 60, ...(mode === 'simulation' ? { message: '仅模拟：此验证码未发送短信，请使用simulationCode测试' } : {}) });
      }
      if (path === '/api/auth/register' && method === 'POST') {
        const body = await readBody(req), phone = normalizePhone(body.phone), plain = password(body.password);
        takeRate(`register:${req.socket.remoteAddress}`, 10, 600000);
        const hash = await bcrypt.hash(plain, 12);
        const registered = await transaction(db, async client => {
          if (!await checkCode(client, phone, 'register', body.code)) return null;
          const userId = id();
          await client.query('INSERT INTO users(id,phone,password_hash,created_at) VALUES($1,$2,$3,$4)', [userId, phone, hash, now()]);
          await client.query('INSERT INTO business(user_id) VALUES($1)', [userId]);
          return { user: { id: userId, phone }, token: await newSession(userId, client) };
        });
        if (!registered) fail(400, 'INVALID_CODE', '验证码错误、已使用或已过期');
        return send(res, 201, { user: registered.user, needsProfile: true }, { 'set-cookie': cookie(registered.token) });
      }
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await readBody(req), phone = normalizePhone(body.phone), plain = password(body.password);
        takeRate(`login-ip:${req.socket.remoteAddress}`, 30, 600000); takeRate(`login:${phone}`, 10, 600000);
        const loggedIn = await transaction(db, async client => {
          const user = await one('SELECT * FROM users WHERE phone=$1 FOR UPDATE', [phone], client);
          // Equalize missing-account work with the same bcrypt cost as actual accounts.
          const valid = await bcrypt.compare(plain, user?.password_hash || '$2b$12$zXuUwNFMOXaFmwnCMXfPDObOABKmwdhnLycmPPKaMlRLBuNTjjWTW');
          if (!user || !valid) return null;
          return { user, token: await newSession(user.id, client) };
        });
        if (!loggedIn) fail(401, 'INVALID_CREDENTIALS', '手机号或密码错误');
        return send(res, 200, { user: { id: loggedIn.user.id, phone }, needsProfile: !loggedIn.user.profile_complete }, { 'set-cookie': cookie(loggedIn.token) });
      }
      if (path === '/api/auth/reset' && method === 'POST') {
        const body = await readBody(req), phone = normalizePhone(body.phone), plain = password(body.password);
        takeRate(`reset:${req.socket.remoteAddress}`, 10, 600000);
        const hash = await bcrypt.hash(plain, 12);
        const changed = await transaction(db, async client => {
          if (!await checkCode(client, phone, 'reset', body.code)) return false;
          const user = await one('SELECT id FROM users WHERE phone=$1 FOR UPDATE', [phone], client);
          if (!user) return false;
          await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
          await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
          return true;
        });
        if (!changed) fail(400, 'INVALID_CODE', '验证码错误、已使用或已过期');
        return send(res, 200, { ok: true }, { 'set-cookie': cookie('', true) });
      }
      if (path === '/api/auth/logout' && method === 'POST') {
        const auth = await session(req);
        await db.query('DELETE FROM sessions WHERE token_hash=$1', [auth.tokenHash]);
        return send(res, 200, { ok: true }, { 'set-cookie': cookie('', true) });
      }
      if (path.startsWith('/api/me/')) {
        const { user } = await session(req), cfg = currentConfig;
        const row = await one('SELECT * FROM business WHERE user_id=$1', [user.id]);
        if (path === '/api/me/profile' && method === 'GET') return send(res, 200, { profile: { ...user.profile, phone: user.phone }, complete: user.profile_complete, editable: !row.attendance_status && !row.submission_submitted_at });
        if (path === '/api/me/profile' && method === 'PATCH') {
          const body = await readBody(req);
          if (body.phone !== undefined && normalizePhone(body.phone) !== user.phone) fail(400, 'PHONE_IMMUTABLE', '已验证的手机号不可在个人资料中修改');
          const data = profileData({ ...user.profile, ...body }, cfg);
          await transaction(db, async client => {
            const locked = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [user.id], client);
            if (locked.attendance_status || locked.submission_submitted_at) fail(409, 'PROFILE_LOCKED', '申请已提交，个人资料不可自行修改');
            await client.query('UPDATE users SET profile=$1,profile_complete=$2 WHERE id=$3', [data, profileComplete(data), user.id]);
          });
          return send(res, 200, { profile: { ...data, phone: user.phone }, complete: profileComplete(data), editable: true });
        }
        if (path === '/api/me/attendance' && method === 'GET') return send(res, 200, { attendance: attendanceView(row), attendanceStats: await stats(cfg) });
        if (path === '/api/me/attendance' && method === 'POST') {
          checkWindow(cfg, 'attendance');
          if (!user.profile_complete) fail(409, 'PROFILE_REQUIRED', '请先完整填写个人资料');
          const body = await readBody(req), motivation = clean(body.motivation ?? '', 5000, '参会动机');
          const updated = await transaction(db, async client => {
            const current = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [user.id], client);
            if (current.attendance_status) fail(409, 'ALREADY_APPLIED', '已有参会申请');
            if (current.submission_status === 'accepted') fail(409, 'ATTENDANCE_ALREADY_GRANTED', '投稿已录用，已获得参会资格');
            return one("UPDATE business SET attendance_status='under_review',attendance_data=$1,attendance_updated_at=$2 WHERE user_id=$3 RETURNING *", [{ motivation }, now(), user.id], client);
          });
          return send(res, 201, { attendance: attendanceView(updated), attendanceStats: await stats(cfg) });
        }
        if (path === '/api/me/submission' && method === 'GET') return send(res, 200, { submission: await submissionView(row, user.id, cfg) });
        if (path === '/api/me/submission' && method === 'PUT') {
          checkWindow(cfg, 'submission');
          const body = await readBody(req), data = submissionData(body);
          const updated = await transaction(db, async client => {
            const current = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [user.id], client);
            if (current.submission_status && current.submission_status !== 'draft') fail(409, 'SUBMISSION_LOCKED', '提交后仅在需要补充材料时可补充');
            await checkAttachments(client, user.id, data.attachmentIds, cfg);
            return one("UPDATE business SET submission_status='draft',submission_data=$1,submission_updated_at=$2 WHERE user_id=$3 RETURNING *", [data, now(), user.id], client);
          });
          return send(res, 200, { submission: await submissionView(updated, user.id, cfg) });
        }
        if (path === '/api/me/submission/submit' && method === 'POST') {
          await readBody(req); checkWindow(cfg, 'submission');
          if (!user.profile_complete) fail(409, 'PROFILE_REQUIRED', '请先完整填写个人资料');
          const updated = await transaction(db, async client => {
            const current = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [user.id], client), data = current.submission_data;
            if (current.submission_status !== 'draft') fail(409, 'SUBMISSION_LOCKED', '请先保存草稿，且每个账户只可提交一次');
            if (!data.title || !data.abstract || !data.presenter || !data.keywords.length || !data.authors.length || data.authors.some(author => !author.name || !author.affiliation)) fail(400, 'INCOMPLETE_SUBMISSION', '请填写标题、摘要、关键词、作者及单位和报告人');
            await checkAttachments(client, user.id, data.attachmentIds, cfg, true);
            return one("UPDATE business SET submission_status='under_review',submission_review_round=1,submission_submitted_at=$1,submission_updated_at=$1 WHERE user_id=$2 RETURNING *", [now(), user.id], client);
          });
          return send(res, 200, { submission: await submissionView(updated, user.id, cfg) });
        }
        if (path === '/api/me/submission/supplement' && method === 'POST') {
          const body = await readBody(req); checkWindow(cfg, 'submission', true);
          if (Object.keys(body).some(key => !['note', 'attachmentIds'].includes(key))) fail(400, 'SUPPLEMENT_FIELDS', '补充材料只能更新备注和附件');
          const updated = await transaction(db, async client => {
            const current = await one('SELECT * FROM business WHERE user_id=$1 FOR UPDATE', [user.id], client);
            if (current.submission_status !== 'needs_materials') fail(409, 'SUPPLEMENT_NOT_ALLOWED', '仅在需要补充材料时可补充');
            const data = { ...current.submission_data, note: clean(body.note ?? current.submission_data.note, 15000, '补充备注') };
            if (body.attachmentIds !== undefined) data.attachmentIds = submissionData({ attachmentIds: body.attachmentIds }).attachmentIds;
            await checkAttachments(client, user.id, data.attachmentIds, cfg, true);
            return one("UPDATE business SET submission_status='under_review',submission_review_round=submission_review_round+1,submission_data=$1,submission_updated_at=$2 WHERE user_id=$3 RETURNING *", [data, now(), user.id], client);
          });
          return send(res, 200, { submission: await submissionView(updated, user.id, cfg) });
        }
        if (path === '/api/me/files' && method === 'POST') {
          const maxBytes = Math.min(50 * 1024 * 1024, cfg.files?.maxFileBytes ?? 20 * 1024 * 1024);
          const body = await readBody(req, Math.ceil(maxBytes * 4 / 3) + 8192), name = clean(body.name, 200, '文件名');
          if (!name || /[\/\\]/.test(name) || name.startsWith('.')) fail(400, 'INVALID_FILENAME', '文件名格式不正确');
          if (typeof body.contentBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.contentBase64) || body.contentBase64.length % 4) fail(400, 'INVALID_FILE', '附件内容格式不正确');
          const bytes = Buffer.from(body.contentBase64, 'base64');
          if (!bytes.length || bytes.length > maxBytes) fail(413, 'FILE_TOO_LARGE', `单个附件不能超过${Math.round(maxBytes / 1048576)}MiB`);
          const extension = name.split('.').pop().toLowerCase();
          if (!(cfg.files?.allowedExtensions || ['pdf', 'docx', 'pptx']).map(x => x.replace(/^\./, '').toLowerCase()).includes(extension)) fail(400, 'FILE_TYPE', '不支持此附件类型');
          const mime = detectDocument(bytes, name);
          if (!mime) fail(400, 'FILE_CONTENT', '附件真实内容与允许的文档格式不符');
          const fileId = id();
          await transaction(db, async client => {
            await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
            const count = await one('SELECT COUNT(*)::int AS count,COALESCE(SUM(size),0)::bigint AS bytes FROM files WHERE user_id=$1', [user.id], client);
            if (count.count >= 30 || Number(count.bytes) + bytes.length > maxBytes * 30) fail(429, 'FILE_QUOTA', '此账户已达到附件存储上限');
            await client.query('INSERT INTO files(id,user_id,name,mime,size,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [fileId, user.id, name, mime, bytes.length, bytes, now()]);
          });
          return send(res, 201, { file: { id: fileId, name, mime, size: bytes.length } });
        }
        const fileMatch = path.match(/^\/api\/me\/files\/([\w-]+)$/);
        if (fileMatch && method === 'GET') {
          const file = await one('SELECT * FROM files WHERE id=$1 AND user_id=$2', [fileMatch[1], user.id]);
          if (!file) fail(404, 'FILE_NOT_FOUND', '附件不存在');
          res.writeHead(200, { 'content-type': file.mime, 'content-length': file.size, 'cache-control': 'private, no-store', 'content-disposition': `attachment; filename="document.${file.name.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(file.name)}` });
          return res.end(file.content);
        }
      }
      if (path.startsWith('/api/simulation/')) {
        requireSimulation(req);
        const cfg = currentConfig;
        if (path === '/api/simulation/state' && method === 'GET') {
          const rows = await result('SELECT u.id,u.phone,u.profile,b.* FROM users u JOIN business b ON b.user_id=u.id ORDER BY u.created_at');
          const users = [];
          for (const row of rows) users.push({ id: row.id, phone: row.phone, profile: row.profile, attendance: attendanceView(row), submission: await submissionView(row, row.id, cfg) });
          return send(res, 200, { simulation: true, warning: '仅本地模拟，不是管理员平台；未向飞书发送数据', users, attendanceStats: await stats(cfg), pendingReviews: await result('SELECT id,user_id,kind,decision,feedback,due_at,applied_at,error FROM review_queue ORDER BY id DESC LIMIT 100'), lastSyncAt, syncError, pollSeconds });
        }
        if (path === '/api/simulation/reviews' && method === 'POST') {
          const body = await readBody(req), phone = normalizePhone(body.phone), kind = body.kind, decision = body.decision, feedback = clean(body.feedback ?? '', 10000, '反馈');
          if (!['attendance', 'submission'].includes(kind) || !(kind === 'attendance' ? ['accepted', 'rejected'] : ['accepted', 'rejected', 'needs_materials']).includes(decision)) fail(400, 'INVALID_REVIEW', '审核类型或结果不正确');
          const user = await one('SELECT id FROM users WHERE phone=$1', [phone]);
          if (!user) fail(404, 'USER_NOT_FOUND', '未找到此用户');
          const current = await one('SELECT * FROM business WHERE user_id=$1', [user.id]);
          if (!current?.[`${kind}_status`] || current[`${kind}_status`] === 'draft') fail(409, 'NOT_SUBMITTED', '尚无已提交的申请');
          const review = await one('INSERT INTO review_queue(user_id,kind,decision,feedback,due_at) VALUES($1,$2,$3,$4,$5) RETURNING id,due_at', [user.id, kind, decision, feedback, now() + pollSeconds * 1000]);
          return send(res, 202, { simulation: true, review: { id: review.id, dueAt: new Date(Number(review.due_at)).toISOString() }, message: `模拟审核已排队，约${pollSeconds}秒后同步` });
        }
        if (path === '/api/simulation/sync' && method === 'POST') {
          const body = await readBody(req);
          return send(res, 200, { simulation: true, ...await syncReviews({ force: body.force === true }) });
        }
      }
      if (path === '/simulation' && method === 'GET') {
        requireSimulation(req);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(resolve(import.meta.dirname, 'simulation.html'), 'utf8'));
      }
      if (path === '/simulation.js' && method === 'GET') {
        requireSimulation(req);
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(await readFile(resolve(import.meta.dirname, 'simulation.js'), 'utf8'));
      }
      if (path.startsWith('/api/')) fail(404, 'NOT_FOUND', '接口不存在');
      if (!['GET', 'HEAD'].includes(method)) fail(405, 'METHOD_NOT_ALLOWED', '请求方法不支持');
      let target = resolve(staticRoot, `.${path}`);
      if (target !== staticRoot && !target.startsWith(staticRoot + sep)) fail(404, 'NOT_FOUND', '页面不存在');
      try { if (!(await stat(target)).isFile()) target = resolve(staticRoot, 'index.html'); }
      catch { target = resolve(staticRoot, 'index.html'); }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
      const content = await readFile(target);
      res.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream', 'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      return res.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error.code === '23505') return send(res, 409, { error: { code: 'CONFLICT', message: '已存在此记录' } });
      const status = error.status || 500;
      if (status === 500) options.onError?.(error);
      send(res, status, { error: { code: error.code || 'INTERNAL_ERROR', message: status === 500 ? '服务暂时不可用，请稍后重试' : error.message } });
    }
  });
  if (options.autoSync !== false) {
    timer = setInterval(() => syncReviews().catch(error => options.onError?.(error)), pollSeconds * 1000);
    timer.unref();
  }
  server.syncReviews = syncReviews;
  server.database = db;
  server.runtime = { mode, origin, pollSeconds, configPath, appRoot };
  server.shutdown = async () => { clearInterval(timer); if (server.listening) await new Promise(resolve => server.close(resolve)); if (ownPool) await db.end(); };
  return server;
}
