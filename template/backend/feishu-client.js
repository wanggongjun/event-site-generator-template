import { createHash } from 'node:crypto';
const BASE = 'https://open.feishu.cn/open-apis';
export function feishuId(value, label = 'Feishu ID') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} is missing or invalid.`);
  return value;
}
export function feishuText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('');
  return '';
}
export class FeishuApiError extends Error {
  constructor(code, status, requestId, stage = 'request') {
    const category = code === 99991672 ? 'app_scope' : [91403, 1254302].includes(code) ? 'resource_permission' : stage === 'authentication' ? 'authentication' : 'api';
    const help = category === 'app_scope' ? ' Check the published app API scopes; initialization authorization does not grant API access.' : category === 'resource_permission' ? ' Check the app collaborator/resource permissions; app API scopes do not grant access to this base.' : '';
    super(`Feishu ${stage} failed (${code ?? status}).${help}`);
    this.name = 'FeishuApiError'; this.code = code; this.status = status; this.requestId = requestId; this.category = category;
  }
}
/** Reuses the existing tenant token and paginated OpenAPI protocol, without credential creation or permission changes. */
export class FeishuClient {
  constructor(env, { transport = globalThis.fetch, now = Date.now } = {}) {
    for (const key of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']) if (!env[key]) throw new Error(`Feishu requires ${key} in runtime environment variables.`);
    this.env = env; this.transport = transport; this.now = now; this.token = null; this.expires = 0; this.authenticating = null;
  }
  async authenticate() {
    if (this.token && this.now() < this.expires) return;
    if (!this.authenticating) this.authenticating = (async () => {
      const response = await this.transport(`${BASE}/auth/v3/tenant_access_token/internal`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: this.env.FEISHU_APP_ID, app_secret: this.env.FEISHU_APP_SECRET }) });
      const data = await response.json();
      if (!response.ok || data.code !== 0 || !data.tenant_access_token || !Number.isFinite(Number(data.expire)) || Number(data.expire) <= 0) throw new FeishuApiError(data.code, response.status, response.headers?.get('x-tt-logid'), 'authentication');
      this.token = data.tenant_access_token;
      this.expires = this.now() + Math.max(1, Number(data.expire) - Math.min(120, Number(data.expire) / 2)) * 1000;
    })();
    try { await this.authenticating; } finally { this.authenticating = null; }
  }
  async api(path, options = {}, retryExpired = true) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new Error('Feishu API path must remain on the official HTTPS endpoint.');
    await this.authenticate();
    const response = await this.transport(`${BASE}${path}`, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...(options.body instanceof FormData ? {} : { 'content-type': 'application/json' }), ...options.headers, authorization: `Bearer ${this.token}` } });
    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      if (retryExpired && [99991663, 99991664].includes(data.code)) { this.token = null; this.expires = 0; return this.api(path, options, false); }
      throw new FeishuApiError(data.code, response.status, response.headers?.get('x-tt-logid'));
    }
    return data.data;
  }
  async list(path, params = {}) {
    const items = []; const seen = new Set(); let pageToken;
    do {
      const query = new URLSearchParams({ page_size: path.endsWith('/records') ? '500' : '100', ...params, ...(pageToken ? { page_token: pageToken } : {}) });
      const data = await this.api(`${path}?${query}`);
      if (!data || !Array.isArray(data.items ?? [])) throw new Error('Feishu pagination returned invalid items.');
      items.push(...(data.items || []));
      if (!data.has_more) break;
      pageToken = data.page_token;
      if (!pageToken || seen.has(pageToken)) throw new Error('Feishu pagination did not advance; refusing an incomplete read.');
      seen.add(pageToken);
    } while (true);
    return items;
  }
}
export function parseBitableTarget(input) {
  if (!input) throw new Error('Provide FEISHU_BITABLE_URL or FEISHU_BITABLE_APP_TOKEN.');
  if (!input.includes('://')) return { type: 'base', token: feishuId(input, 'Bitable app token') };
  let url; try { url = new URL(input); } catch { throw new Error('Invalid Feishu base/wiki URL.'); }
  if (url.protocol !== 'https:' || !/(^|\.)feishu\.cn$/.test(url.hostname) || url.username || url.password || url.port) throw new Error('Use an official HTTPS feishu.cn base/wiki URL.');
  const match = url.pathname.match(/^\/(base|wiki)\/([A-Za-z0-9_-]+)\/?$/);
  if (!match) throw new Error('Only Feishu /base/<app_token> and /wiki/<node_token> URLs are supported.');
  return { type: match[1], token: match[2] };
}
export async function resolveBitableTarget(env, client) {
  const input = parseBitableTarget(env.FEISHU_BITABLE_URL || env.FEISHU_BITABLE_APP_TOKEN);
  let appToken = input.token;
  if (input.type === 'wiki') {
    const data = await client.api(`/wiki/v2/spaces/get_node?${new URLSearchParams({ token: input.token })}`);
    if (data?.node?.obj_type !== 'bitable') throw new Error('The authorized wiki node is not a Bitable.');
    appToken = feishuId(data.node.obj_token, 'Resolved Bitable app token');
  }
  if (env.FEISHU_BITABLE_APP_TOKEN && feishuId(env.FEISHU_BITABLE_APP_TOKEN) !== appToken) throw new Error('FEISHU_BITABLE_URL and FEISHU_BITABLE_APP_TOKEN refer to different resources.');
  return { appToken, sourceType: input.type };
}

export function feishuClientToken(...parts) {
  const hex = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32).split('');
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join(''); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
