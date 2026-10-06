import { createHash, createHmac, randomUUID } from 'node:crypto';

// Refactored from the pinned Panshi AliyunVerificationProvider's request/acceptance
// semantics. The old SDK wrapper is replaced by official ACS3 native HTTP signing.
// Original: TashanGKD/panshi-ai4s-camp@b743737b4144052579fcdb740719ad6b3b3d07a3
// apps/api/src/modules/identity/aliyun-verification-provider.ts
// Official signing: https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
const encode = value => encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Narrow native signing primitive, exported for an official deterministic vector test. */
export function signAliyunRequest({ method = 'POST', host, action = 'SendSms', version = '2017-05-25', query, accessKeyId, accessKeySecret, timestamp, nonce, securityToken, regionId }) {
  const canonicalQuery = Object.keys(query).sort().map(key => `${encode(key)}=${encode(query[key])}`).join('&');
  const payloadHash = sha256('');
  const headers = { host, 'x-acs-action': action, 'x-acs-content-sha256': payloadHash, 'x-acs-date': timestamp, 'x-acs-signature-nonce': nonce, 'x-acs-version': version };
  if (securityToken) headers['x-acs-security-token'] = securityToken;
  if (regionId) headers['x-acs-region-id'] = regionId;
  const keys = Object.keys(headers).sort();
  const canonicalHeaders = keys.map(key => `${key}:${String(headers[key]).trim()}\n`).join('');
  const signedHeaders = keys.join(';');
  const canonicalRequest = [method, '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const signature = createHmac('sha256', accessKeySecret).update(`ACS3-HMAC-SHA256\n${sha256(canonicalRequest)}`).digest('hex');
  headers.authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`;
  headers.accept = 'application/json';
  return { query: canonicalQuery, headers, signature };
}

export class AliyunSms {
  constructor(env, { transport = fetch, now = () => new Date(), nonce = randomUUID } = {}) {
    this.accessKeyId = env.SMS_ALIYUN_ACCESS_KEY_ID;
    this.accessKeySecret = env.SMS_ALIYUN_ACCESS_KEY_SECRET;
    this.signName = env.SMS_ALIYUN_SIGN_NAME;
    this.templateCode = env.SMS_ALIYUN_TEMPLATE_CODE;
    this.templateParamKey = env.SMS_ALIYUN_TEMPLATE_PARAM_KEY || 'code';
    this.regionId = env.SMS_ALIYUN_REGION_ID || 'cn-hangzhou';
    this.securityToken = env.SMS_ALIYUN_SECURITY_TOKEN;
    const endpoint = env.SMS_ALIYUN_ENDPOINT || 'dysmsapi.aliyuncs.com';
    const parsed = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`);
    if (parsed.protocol !== 'https:' || !/^dysmsapi(?:\.[a-z0-9-]+)?\.aliyuncs\.com$/.test(parsed.hostname) || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('Aliyun SMS endpoint must be an official HTTPS dysmsapi.aliyuncs.com endpoint.');
    this.endpoint = parsed.origin; this.host = parsed.host;
    if ([this.accessKeyId, this.accessKeySecret, this.signName, this.templateCode, this.templateParamKey, this.regionId].some(value => typeof value !== 'string' || !value.trim())) throw new Error('Aliyun SMS configuration is incomplete.');
    this.transport = transport; this.now = now; this.nonce = nonce;
  }
  async send({ phone, code }) {
    const signed = signAliyunRequest({ host: this.host, query: { PhoneNumbers: phone, SignName: this.signName, TemplateCode: this.templateCode, TemplateParam: JSON.stringify({ [this.templateParamKey]: code }) }, accessKeyId: this.accessKeyId, accessKeySecret: this.accessKeySecret, timestamp: this.now().toISOString().replace(/\.\d{3}Z$/, 'Z'), nonce: this.nonce(), securityToken: this.securityToken, regionId: this.regionId });
    // One attempt only: SendSms is not idempotent, so a timeout is never blindly retried.
    const response = await this.transport(`${this.endpoint}/?${signed.query}`, { method: 'POST', headers: signed.headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok || result.Code !== 'OK') throw new Error('Aliyun SMS delivery was not accepted.');
    return { mode: 'real', provider: 'aliyun' };
  }
}
