import test from 'node:test';
import assert from 'node:assert/strict';
import { AliyunSms, signAliyunRequest } from '../aliyun-sms.js';
import { createRealSms, HttpSms } from '../adapters.js';

const env = { SMS_ALIYUN_ACCESS_KEY_ID: 'test-id-only', SMS_ALIYUN_ACCESS_KEY_SECRET: 'test-secret-only', SMS_ALIYUN_SIGN_NAME: '测试签名', SMS_ALIYUN_TEMPLATE_CODE: 'SMS_TEST_ONLY', SMS_ALIYUN_TEMPLATE_PARAM_KEY: 'verification_code' };

test('native ACS3 signing matches Alibaba Cloud official fixed test vector', () => {
  const result = signAliyunRequest({ method: 'POST', host: 'ecs.cn-shanghai.aliyuncs.com', action: 'RunInstances', version: '2014-05-26', query: { ImageId: 'win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd', RegionId: 'cn-shanghai' }, accessKeyId: 'YourAccessKeyId', accessKeySecret: 'YourAccessKeySecret', timestamp: '2023-10-26T10:22:32Z', nonce: '3156853299f313e23d1673dc12e1703d' });
  assert.equal(result.signature, '06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0');
});

test('Aliyun adapter preserves legacy SendSms template fields and accepted-code semantics with mocked transport', async () => {
  let calls = 0;
  const sms = new AliyunSms(env, { now: () => new Date('2026-10-05T08:00:00Z'), nonce: () => 'test-unique-nonce', transport: async (url, options) => {
    calls++; const request = new URL(url);
    assert.equal(request.origin, 'https://dysmsapi.aliyuncs.com'); assert.equal(request.searchParams.get('PhoneNumbers'), '+8613800000000');
    assert.equal(request.searchParams.get('SignName'), '测试签名'); assert.equal(request.searchParams.get('TemplateCode'), 'SMS_TEST_ONLY');
    assert.deepEqual(JSON.parse(request.searchParams.get('TemplateParam')), { verification_code: '123456' });
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.headers['x-acs-action'], 'SendSms'); assert.equal(options.headers['x-acs-version'], '2017-05-25');
    assert.match(options.headers.authorization, /^ACS3-HMAC-SHA256 Credential=test-id-only,/);
    assert.equal(url.includes('test-secret-only'), false); assert.equal(JSON.stringify(options).includes('test-secret-only'), false);
    return { ok: true, json: async () => ({ Code: 'OK', RequestId: 'test-request' }) };
  } });
  assert.deepEqual(await sms.send({ phone: '+8613800000000', purpose: 'register', code: '123456' }), { mode: 'real', provider: 'aliyun' }); assert.equal(calls, 1);
  const rejected = new AliyunSms(env, { transport: async () => ({ ok: true, json: async () => ({ Code: 'isv.BUSINESS_LIMIT_CONTROL' }) }) });
  await assert.rejects(rejected.send({ phone: '+8613800000000', code: '123456' }), /not accepted/);
});

test('Aliyun is real default; gateway requires explicit selection and incomplete/unsafe provider config fails closed', () => {
  assert.ok(createRealSms(env) instanceof AliyunSms);
  assert.throws(() => createRealSms({}), /configuration is incomplete/);
  assert.throws(() => new AliyunSms({ ...env, SMS_ALIYUN_ENDPOINT: 'https://evil.example.org' }), /official HTTPS/);
  assert.throws(() => new AliyunSms({ ...env, SMS_ALIYUN_ENDPOINT: 'http://dysmsapi.aliyuncs.com' }), /official HTTPS/);
  assert.ok(createRealSms({ SMS_PROVIDER: 'http', SMS_SEND_URL: 'https://operator.example.org/send', SMS_API_KEY: 'fake-only' }) instanceof HttpSms);
  assert.throws(() => createRealSms({ ...env, SMS_PROVIDER: 'unknown' }), /SMS_PROVIDER/);
});
