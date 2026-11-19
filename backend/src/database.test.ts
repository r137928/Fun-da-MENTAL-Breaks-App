import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from './app.js';
import { initializeDemo } from './demo.js';
import { migrate } from './migrate.js';
import { SaveBlueprintSchema, legacyRequestHash } from './model.js';

const baseline = { color_hex: '#3774AC', mental_balance: 5, body_presence_pct: 55,
  breaks_per_day: 1, duration: 'one_two' };
const blueprint = {
  schema_version: 1, catalog_version: 1, nickname: 'Sample Alex', goal: 'balance',
  now: baseline, target: { ...baseline, color_hex: '#4C8549' }, comfort: 'balanced',
  activities: [{ activity: { activity_id: 'walk', lane: 'movement' }, tag: 'goal' }],
  plan: { weekdays: [1, 1, 1, 1, 1, 0, 0], windows: ['midday'], overrides: {} },
  buddy: { tone: 'calm', nudge: 'one_and_done', support: 'minimal' }, optional: {},
};
const record = {
  id: randomUUID(), completed_at: '2026-11-01T12:00:00Z', time_zone: 'America/Phoenix',
  activity: { lane: 'movement', activity_id: 'walk' }, duration_seconds: 60,
  time_bucket: 'one_two', vibe_words: ['scattered'], mind_before: 5, mind_after: 6,
  presence_pct: 65, source: 'onboarding',
};

async function session(pool: pg.Pool, user: string, token: string) {
  const value = createHash('sha256').update(token).digest('hex').slice(0, 32);
  await pool.query("INSERT INTO onboarding.approved_sessions VALUES ($1::uuid, $2, 'self_declared', 1)",
    [value, user]);
}

test('migrates existing records and keeps demo saves, retries and schema objects working', async context => {
  const connectionString = process.env.ONBOARDING_TEST_DATABASE_URL;
  if (!connectionString) throw new Error('Set ONBOARDING_TEST_DATABASE_URL to a disposable empty PostgreSQL database');
  const pool = new pg.Pool({ connectionString });
  const app = createApp(pool, { demo: true, env: {} });
  try {
    const sql = await readFile(new URL('../migrations/0001_onboarding.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    await pool.query('CREATE TABLE public._sqlx_migrations (version bigint PRIMARY KEY, checksum bytea, success boolean)');
    await pool.query('INSERT INTO public._sqlx_migrations VALUES (1, $1, true)',
      [createHash('sha384').update(sql).digest()]);
    const oldAccount = randomUUID();
    const oldToken = randomUUID();
    await pool.query("INSERT INTO onboarding.accounts (id, eligibility_method, policy_version, blueprint_completed_at) VALUES ($1, 'self_declared', 1, now())",
      [oldAccount]);
    await session(pool, oldAccount, oldToken);
    const oldSave = { request_id: randomUUID(), blueprint, first_break: record };
    const legacy = SaveBlueprintSchema.parse(oldSave);
    await pool.query('INSERT INTO onboarding.blueprints VALUES ($1, 1, $2)', [oldAccount, legacy.blueprint]);
    await pool.query('INSERT INTO onboarding.breaks VALUES ($1, $2, $3, $4)',
      [oldAccount, record.id, record.completed_at, legacy.first_break]);
    await pool.query('INSERT INTO onboarding.blueprint_requests VALUES ($1, $2, $3, 1, $4)',
      [oldAccount, oldSave.request_id, legacyRequestHash(legacy), record.id]);

    await migrate(pool);
    await migrate(pool);
    await initializeDemo(pool);
    const oldHeaders = { authorization: 'Bearer ' + oldToken };
    const oldMe = await app.inject({ url: '/v1/me', headers: oldHeaders });
    assert.equal(oldMe.statusCode, 200, oldMe.body);
    assert.equal(oldMe.json().user, null);
    assert.deepEqual(oldMe.json().recent_breaks[0].break,
      { title: 'Walk', break_type: 'movement', duration: 60 });
    const oldRetry = await app.inject({ method: 'PUT', url: '/v1/me/blueprint', headers: oldHeaders, payload: oldSave });
    assert.equal(oldRetry.statusCode, 200, oldRetry.body);
    assert.deepEqual(oldRetry.json(), { revision: 1, break_id: record.id });

    const started = await app.inject({
      method: 'POST', url: '/demo/session', payload: { sample: 'teen', contact: { method: 'phone', preset: 'alex' } },
    });
    assert.equal(started.statusCode, 200, started.body);
    const headers = { authorization: 'Bearer ' + started.json().token };
    const suggestions = (input: Record<string, unknown>) => app.inject({
      method: 'POST', url: '/v1/me/break-suggestions', headers, payload: input,
    });
    const beforeSetup = await suggestions({});
    assert.equal(beforeSetup.statusCode, 200, beforeSetup.body);
    assert.equal(beforeSetup.json().blueprint_revision, null);
    assert.equal(beforeSetup.headers['cache-control'], 'no-store');
    const draft = { request_id: randomUUID(), blueprint, first_break: record };
    const saves = await Promise.all([0, 1].map(() => app.inject({
      method: 'PUT', url: '/v1/me/blueprint', headers, payload: draft,
    })));
    for (const response of saves) {
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), { revision: 1, break_id: record.id });
    }
    const ranked = await suggestions({ mind_before: 6, time_bucket: 'one_two', vibe_words: ['sluggish'] });
    assert.equal(ranked.statusCode, 200, ranked.body);
    assert.equal(ranked.json().blueprint_revision, 1);
    assert.equal(ranked.json().best_fit.activity_id, 'walk');
    assert.ok(ranked.json().best_fit.duration_seconds <= 120);
    assert.equal((await suggestions({ mind_before: 11 })).statusCode, 422);
    const conflict = await app.inject({ method: 'PUT', url: '/v1/me/blueprint', headers,
      payload: { ...draft, blueprint: { ...blueprint, goal: 'focus' } } });
    assert.equal(conflict.statusCode, 409);
    assert.deepEqual(conflict.json(), { code: 'idempotency_key_reused' });
    const response = await app.inject({ url: '/v1/me', headers });
    assert.equal(response.statusCode, 200, response.body);
    const current = response.json();
    assert.equal(typeof current.user.user_id, 'number');
    assert.equal(current.user.age, 16);
    assert.equal(current.user.phone, 12025550101);
    assert.equal(current.user.nickname, 'Sample Alex');
    assert.equal('password' in current.user, false);
    assert.deepEqual(current.user.color_palette, [['now', '#3774AC'], ['goal', '#4C8549']]);
    assert.equal(current.recent_breaks.length, 1);

    const next = { ...record, id: randomUUID(), source: 'manual',
      break: { title: 'Walk to the park', break_type: 'movement', duration: 60, icon: 'walk' } };
    for (const payload of [next, next]) {
      const result = await app.inject({ method: 'POST', url: '/v1/me/breaks', headers, payload });
      assert.equal(result.statusCode, 200, result.body);
      assert.deepEqual(result.json(), { break_id: next.id, break: next.break });
    }
    const mismatched = await app.inject({ method: 'POST', url: '/v1/me/breaks', headers,
      payload: { ...next, break: { ...next.break, duration: 120 } } });
    assert.equal(mismatched.statusCode, 422);
    assert.equal((await app.inject({ url: '/' })).statusCode, 200);
    assert.match((await app.inject({ url: '/recommendations.mjs' })).headers['content-type'] ?? '', /javascript/);
    assert.equal((await app.inject({ url: '/ready' })).statusCode, 204);

    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'ES256' };
    const provider = 'https://provider.example.test';
    context.mock.method(globalThis, 'fetch', async (resource: RequestInfo | URL) => {
      const url = resource instanceof Request ? resource.url : resource.toString();
      assert.equal(url, provider + '/auth/v1/.well-known/jwks.json');
      return Response.json({ keys: [jwk] });
    });
    const appleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    const production = createApp(pool, { env: {
      AUTH_ENABLED: 'true', SUPABASE_URL: provider, SUPABASE_PUBLISHABLE_KEY: 'test',
      SUPABASE_SECRET_KEY: 'test', APPLE_CLIENT_ID: 'test', APPLE_TEAM_ID: 'test', APPLE_KEY_ID: 'test',
      APPLE_PRIVATE_KEY: appleKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      MAINTENANCE_TOKEN: 'disposable-integration-test-token', ALLOW_SELF_DECLARED: 'true',
    } });
    try {
      const sessionId = randomUUID();
      const token = await new SignJWT({ session_id: sessionId }).setSubject(oldAccount)
        .setIssuer(provider + '/auth/v1').setAudience('authenticated').setExpirationTime('5m')
        .setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(privateKey);
      const auth = { authorization: 'Bearer ' + token };
      assert.equal((await production.inject({ url: '/v1/me', headers: auth })).statusCode, 401);
      await pool.query("INSERT INTO onboarding.approved_sessions VALUES ($1, $2, 'self_declared', 1)",
        [sessionId, oldAccount]);
      assert.equal((await production.inject({ url: '/v1/me', headers: auth })).statusCode, 200);
    } finally {
      await production.close();
    }
  } finally {
    await app.close();
    await pool.end();
  }
});
