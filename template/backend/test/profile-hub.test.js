import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {
  cleanChanges,
  createProfileHubClient,
  createProfileHubRoutes,
  normalizePhone,
  profileHubConfig,
  shapeHubAnswer,
  signHubRequest,
} from '../profile-hub.js';

const secret = 'forum-hub-secret-0123456789';
const config = {url: 'https://auth.example/api/v1/profile-hub', secret, client: 'panshi-forum'};

const answer = {
  found: true,
  confirmed: {version: 3, fields: {real_name: '已确认姓名', organization: '已确认单位', major: null, research_direction: null},
    sources: {organization: {source: 'panshi-camp', source_updated_at: '2026-09-01T00:00:00Z'}}},
  candidates: [
    {source_system: 'panshi-camp', source_user_id: 'c1', field: 'organization', value: '实训营单位',
      source_updated_at: '2026-09-01T00:00:00Z', imported_at: 1790000000, field_note: null},
    {source_system: 'panshi-forum', source_user_id: 'f1', field: 'organization', value: '论坛单位',
      source_updated_at: null, imported_at: 1790000100, field_note: null},
  ],
};

const makeRes = () => ({status: null, body: null, setHeader() {}});
const send = (res, status, body) => { res.status = status; res.body = body; };
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };

test('configuration requires HTTPS and a long secret', () => {
  assert.equal(profileHubConfig({}), null);
  assert.throws(() => profileHubConfig({PROFILE_HUB_URL: 'http://auth.example/x', PROFILE_HUB_SECRET: secret}), /HTTPS/u);
  assert.throws(() => profileHubConfig({PROFILE_HUB_URL: 'https://auth.example/x', PROFILE_HUB_SECRET: 'short'}), /at least 24/u);
  assert.equal(profileHubConfig({PROFILE_HUB_URL: 'https://auth.example/x', PROFILE_HUB_SECRET: secret}).client, 'event-site');
});

test('phone numbers are normalized or rejected', () => {
  assert.equal(normalizePhone('+8613900000001'), '13900000001');
  assert.equal(normalizePhone('139 0000 0001'), '13900000001');
  assert.equal(normalizePhone('008613900000001'), '13900000001');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(null), null);
});

test('only the four whitelisted fields survive cleaning', () => {
  assert.deepEqual(cleanChanges({real_name: ' 张三 ', organization: ''}), {real_name: '张三'});
  assert.equal(cleanChanges({real_name: null}), null);
  assert.equal(cleanChanges({phone: '13900000001'}), null);
  assert.equal(cleanChanges({real_name: 'x'.repeat(81)}), null);
  assert.equal(cleanChanges({}), null);
});

test('signature covers body, timestamp and nonce', () => {
  const body = '{"phone":"13900000001"}';
  const headers = signHubRequest(secret, body);
  const expected = 'v1=' + createHmac('sha256', secret)
    .update(`${headers['x-tashan-timestamp']}.${headers['x-tashan-nonce']}.${body}`).digest('hex');
  assert.equal(headers['x-tashan-hub-signature'], expected);
  assert.equal(headers['x-tashan-client'], 'panshi-forum');
  assert.match(headers['x-tashan-nonce'], /^[a-f0-9]{32}$/u);
});

test('client sends a signed lookup and maps upstream failures', async () => {
  const seen = [];
  const client = createProfileHubClient({config, fetchImpl: async (url, init) => {
    seen.push({url, init});
    return {ok: true, status: 200, json: async () => answer};
  }});
  const result = await client.lookup('13900000001');
  assert.equal(result.found, true);
  assert.equal(seen[0].url, 'https://auth.example/api/v1/profile-hub/lookup');
  assert.equal(JSON.parse(seen[0].init.body).phone, '13900000001');
  assert.match(seen[0].init.headers['x-tashan-hub-signature'], /^v1=[a-f0-9]{64}$/u);

  const offline = createProfileHubClient({config, fetchImpl: async () => { throw new Error('boom'); }});
  await assert.rejects(offline.lookup('13900000001'), (error) => error.status === 503);

  const conflict = createProfileHubClient({config, fetchImpl: async () => ({ok: false, status: 409, json: async () => ({})})});
  await assert.rejects(conflict.confirm('13900000001', {expected_version: 1, idempotency_key: 'k'.repeat(10), changes: {}}),
    (error) => error.status === 409);
});

test('shaping prefers confirmed values and groups candidates per field', () => {
  const shaped = shapeHubAnswer(answer);
  assert.equal(shaped.found, true);
  assert.equal(shaped.version, 3);
  const organization = shaped.fields.find((field) => field.field === 'organization');
  assert.equal(organization.confirmed, '已确认单位');
  assert.deepEqual(organization.values.map((value) => value.source), ['panshi-camp', 'panshi-forum']);
  const major = shaped.fields.find((field) => field.field === 'major');
  assert.equal(major.confirmed, null);
  assert.deepEqual(major.values, []);
});

test('routes read the phone from the session and degrade without the hub', async () => {
  const hub = {lookup: async (phone) => { assert.equal(phone, '13900000001'); return answer; },
    confirm: async () => ({version: 4, replay: false, fields: {real_name: '张三'}})};
  const routes = createProfileHubRoutes({hub, identity: async () => ({id: 'owner-1', phone: '+8613900000001'}),
    error: fail, send, body: async () => ({})});
  const res = makeRes();
  const handled = await routes({method: 'GET', headers: {}}, res, new URL('http://local/api/forum/profile-hub'), 'GET');
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(res.body.available, true);
  assert.equal(res.body.fields.find((field) => field.field === 'organization').confirmed, '已确认单位');

  const offline = createProfileHubRoutes({hub: {lookup: async () => { throw Object.assign(new Error('x'), {status: 503}); }},
    identity: async () => ({id: 'owner-1', phone: '13900000001'}), error: fail, send, body: async () => ({})});
  const offlineRes = makeRes();
  await offline({method: 'GET'}, offlineRes, new URL('http://local/api/forum/profile-hub'), 'GET');
  assert.equal(offlineRes.status, 200);
  assert.equal(offlineRes.body.available, false);
  assert.match(offlineRes.body.message, /暂时不可用/u);
});

test('routes refuse anonymous callers and sessions without a trusted phone', async () => {
  const routes = (identity) => createProfileHubRoutes({hub: {lookup: async () => answer, confirm: async () => ({})},
    identity, error: fail, send, body: async () => ({})});
  await assert.rejects(routes(async () => null)({method: 'GET'}, makeRes(), new URL('http://local/api/forum/profile-hub'), 'GET'),
    (error) => error.status === 401);
  await assert.rejects(routes(async () => ({id: 'owner-1', phone: ''}))({method: 'GET'}, makeRes(),
    new URL('http://local/api/forum/profile-hub'), 'GET'), (error) => error.status === 403);
});

test('confirm validates input and forwards the session phone', async () => {
  const calls = [];
  const routes = createProfileHubRoutes({
    hub: {lookup: async () => answer, confirm: async (phone, payload) => { calls.push({phone, payload}); return {version: 4, replay: false, fields: {}}; }},
    identity: async () => ({id: 'owner-1', phone: '13900000001'}),
    error: fail, send,
    body: async () => ({expectedVersion: 3, idempotencyKey: 'confirm-key-0001', changes: {organization: '新单位'}}),
  });
  const res = makeRes();
  await routes({method: 'POST'}, res, new URL('http://local/api/forum/profile-hub/confirm'), 'POST');
  assert.equal(res.status, 200);
  assert.equal(calls[0].phone, '13900000001');
  assert.deepEqual(calls[0].payload.changes, {organization: '新单位'});

  const badBody = createProfileHubRoutes({
    hub: {lookup: async () => answer, confirm: async () => ({})},
    identity: async () => ({id: 'owner-1', phone: '13900000001'}), error: fail, send,
    body: async () => ({expectedVersion: 0, idempotencyKey: 'x', changes: {phone: '13900000002'}}),
  });
  await assert.rejects(badBody({method: 'POST'}, makeRes(), new URL('http://local/api/forum/profile-hub/confirm'), 'POST'),
    (error) => error.status === 422);
});
