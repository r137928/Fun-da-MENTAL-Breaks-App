import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { createApp } from './app.js';
import { BreakSchema, ProfileInputSchema, UserSchema, publicUser } from './model.js';

const profile = {
  name: 'Alex', gender: 'unspecified', age: 25, mind_score: 5, presence_score: 55,
  phone: 12025550101, break_pref: ['Walking'], goals: ['Find balance'],
  color_palette: [['now', '#3774AC'], ['goal', '#4C8549']],
};

test('enforces the documented user and break shapes', () => {
  const stored = UserSchema.parse({
    ...profile, user_id: 1, created_at: '2026-11-16T00:00:00Z',
    password: '!provider-managed', role: 'user',
  });
  assert.equal(publicUser(stored).user_id, 1);
  assert.equal('password' in publicUser(stored), false);
  assert.equal(ProfileInputSchema.safeParse({ ...profile, role: 'admin' }).success, false);
  assert.equal(ProfileInputSchema.safeParse({ ...profile, phone: '12025550101' }).success, false);
  assert.equal(ProfileInputSchema.safeParse({ ...profile, color_palette: ['#3774AC'] }).success, false);
  assert.deepEqual(BreakSchema.parse({ title: 'Walk', break_type: 'movement', duration: 60 }),
    { title: 'Walk', break_type: 'movement', duration: 60 });
  assert.equal(BreakSchema.safeParse({ title: 'Walk', break_type: 'movement', duration: 1.5 }).success, false);
});

test('production rejects unsigned access and does not serve demo routes', async () => {
  const pool = new pg.Pool();
  const app = createApp(pool, { env: { AUTH_ENABLED: 'false' } });
  try {
    const response = await app.inject({ url: '/v1/me', headers: { authorization: 'Bearer forged' } });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { code: 'sign_in_required' });
    assert.equal((await app.inject({ method: 'POST', url: '/demo/session', payload: {} })).statusCode, 404);
  } finally {
    await app.close();
    await pool.end();
  }
});
