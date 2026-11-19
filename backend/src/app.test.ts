import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import {
  buildWeeklyPlan, recommendBreak, resolveBreakDay, type RecommendationBlueprint,
} from '../../catalog/recommendations.mjs';
import { createApp } from './app.js';
import { BreakSchema, BreakSuggestionInputSchema, ProfileInputSchema, UserSchema, catalog, publicUser } from './model.js';

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

test('uses Blueprint comfort, activity choices and preferred duration when suggesting breaks', () => {
  const blueprint = {
    comfort: 'stillness', goal: 'focus', target: { duration: 'five' },
    activities: [
      { activity: { activity_id: 'meditation' }, tag: 'now_often' },
      { activity: { activity_id: 'breathing' }, tag: 'not_for_me' },
    ],
  } satisfies RecommendationBlueprint;
  const settings = { available_seconds: 900, vibe_words: ['focused'], setting: 'seated' } as const;
  const short = recommendBreak(catalog, blueprint, settings);
  assert.equal(short.best_fit?.activity_id, 'meditation');
  assert.equal(short.best_fit?.duration_seconds, 300);
  const long = recommendBreak(catalog, { ...blueprint, target: { duration: 'ten_fifteen' } }, settings);
  assert.equal(long.best_fit?.duration_seconds, 600);
  assert.ok(!long.alternatives.stillness.some(item => item.activity_id === 'breathing'));

  const brief = recommendBreak(catalog, blueprint, { ...settings, time_bucket: 'one_two', available_seconds: 80 });
  assert.equal(brief.best_fit?.activity_id, 'quiet_sit');
  assert.equal(brief.best_fit.duration_seconds, 80);
});

test('uses live check-in, respects setting and lane, and permits no fit', () => {
  assert.equal(recommendBreak(catalog, { comfort: 'stillness' }, {}).best_fit?.lane, 'stillness');
  assert.equal(recommendBreak(catalog, { comfort: 'movement' }, {}).best_fit?.lane, 'movement');
  const stillness = recommendBreak(catalog, null, { mind_before: 3, vibe_words: ['stressed'] });
  assert.equal(stillness.best_fit?.activity_id, 'breathing');
  const movement = recommendBreak(catalog, null, { mind_before: 7, vibe_words: ['sluggish'] });
  assert.equal(movement.best_fit?.activity_id, 'walk');
  const seated = recommendBreak(catalog, null, {
    lane: 'movement', setting: 'seated', mind_before: 3, available_seconds: 1_200, vibe_words: ['stiff'],
  });
  assert.equal(seated.best_fit?.activity_id, 'stretch');
  const noFit = recommendBreak(catalog, null, { available_seconds: 30 });
  assert.deepEqual(noFit.alternatives, { stillness: [], movement: [] });
  assert.equal(noFit.best_fit, null);
  assert.equal(BreakSuggestionInputSchema.safeParse({ vibe_words: ['stiff', 'stiff'] }).success, false);
  assert.equal(BreakSuggestionInputSchema.safeParse({ user_id: 123 }).success, false);
});

test('spreads a weekly target and honors a dated override with no breaks', () => {
  const plan = {
    weekdays: buildWeeklyPlan(5, [4, 0, 2]),
    windows: ['midday'],
    overrides: { '2026-11-18': { count: 0, windows: [] } },
  };
  assert.deepEqual(plan.weekdays, [2, 0, 2, 0, 1, 0, 0]);
  assert.deepEqual(resolveBreakDay(plan, '2026-11-16'), { count: 2, windows: ['midday'] });
  assert.deepEqual(resolveBreakDay(plan, '2026-11-18'), { count: 0, windows: [] });
  assert.deepEqual(resolveBreakDay(plan, '2026-11-22'), { count: 0, windows: ['midday'] });
});

test('production rejects unsigned access and does not serve demo routes', async () => {
  const pool = new pg.Pool();
  const app = createApp(pool, { env: { AUTH_ENABLED: 'false' } });
  try {
    const response = await app.inject({ url: '/v1/me', headers: { authorization: 'Bearer forged' } });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { code: 'sign_in_required' });
    assert.equal((await app.inject({ method: 'POST', url: '/v1/me/break-suggestions', payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ url: '/recommendations.mjs' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/demo/session', payload: {} })).statusCode, 404);
  } finally {
    await app.close();
    await pool.end();
  }
});
