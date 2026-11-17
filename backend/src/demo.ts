import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError, catalogUrl, parse, unauthorized, type ProfileInput } from './model.js';
import { transaction } from './store.js';

const contacts = {
  alex: { name: 'Alex', email: 'alex@example.test', phone: '+1 202-555-0101' },
  sam: { name: 'Sam', email: 'sam@example.test', phone: '+1 202-555-0112' },
  jamie: { name: 'Jamie', email: 'jamie@example.test', phone: '+1 202-555-0123' },
};
const sessionSchema = z.object({
  sample: z.enum(['adult', 'teen', 'under13']),
  contact: z.strictObject({
    method: z.enum(['email', 'phone']),
    preset: z.enum(['alex', 'sam', 'jamie']),
  }).nullable().optional(),
});

const assets = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/demo.js', 'demo.js', 'text/javascript; charset=utf-8'],
  ['/demo.css', 'demo.css', 'text/css; charset=utf-8'],
  ['/brain-buddy.js', 'brain-buddy.js', 'text/javascript; charset=utf-8'],
  ['/brain-buddy-actions-v1.webp', 'brain-buddy-actions-v1.webp', 'image/webp'],
  ['/brain-buddy.png', 'brain-buddy.png', 'image/png'],
  ['/brain-buddy-refined.webp', 'brain-buddy-refined.webp', 'image/webp'],
  ['/brain-buddy-refined-poster.webp', 'brain-buddy-refined-poster.webp', 'image/webp'],
] as const;

export function demoRoutes(app: FastifyInstance, pool: Pool) {
  const folder = new URL('../../demo/', import.meta.url);
  for (const [route, file, contentType] of assets) {
    app.get(route, async (_request, reply) =>
      reply.type(contentType).send(await readFile(new URL(file, folder))));
  }
  app.get('/catalog.json', async (_request, reply) =>
    reply.type('application/json').send(await readFile(catalogUrl)));
  app.post('/demo/session', request => createSession(pool, request.body));
}

export async function initializeDemo(pool: Pool) {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS onboarding.demo_contacts (' +
    'user_id uuid PRIMARY KEY REFERENCES onboarding.accounts ON DELETE CASCADE, ' +
    "method text NOT NULL CHECK (method IN ('email', 'phone')), value text NOT NULL)",
  );
}

function sessionKey(token: string) {
  const key = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return [key.slice(0, 8), key.slice(8, 12), key.slice(12, 16), key.slice(16, 20), key.slice(20)].join('-');
}

async function createSession(pool: Pool, input: unknown) {
  const { sample, contact } = parse(sessionSchema, input, 'demo_session');
  if (sample === 'under13') throw new ApiError(403, 'age_not_eligible');
  const account = randomUUID();
  const token = randomUUID() + '.' + randomUUID();
  return transaction(pool, async client => {
    await client.query(
      "INSERT INTO onboarding.accounts (id, eligibility_method, policy_version) VALUES ($1, 'self_declared', 1)",
      [account],
    );
    await client.query(
      "INSERT INTO onboarding.approved_sessions VALUES ($1, $2, 'self_declared', 1)", [sessionKey(token), account],
    );
    const profile: ProfileInput = {
      name: 'Sample profile', gender: 'unspecified', age: sample === 'adult' ? 25 : 16,
      mind_score: 5, presence_score: 50,
    };
    if (contact) {
      const preset = contacts[contact.preset];
      const value = preset[contact.method];
      profile.name = preset.name;
      if (contact.method === 'email') profile.email = value;
      else profile.phone = Number(value.replace(/\D/g, ''));
      await client.query('INSERT INTO onboarding.demo_contacts (user_id, method, value) VALUES ($1, $2, $3)',
        [account, contact.method, value]);
    }
    await client.query('INSERT INTO onboarding.user_profiles (account_id, profile) VALUES ($1, $2)', [account, profile]);
    return { token };
  });
}

export async function authenticateDemo(pool: Pool, token: string) {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT a.id FROM onboarding.approved_sessions s JOIN onboarding.accounts a ON a.id = s.user_id ' +
    "WHERE s.session_id = $1 AND a.status = 'active' AND a.eligibility_method = 'self_declared'",
    [sessionKey(token)],
  );
  if (!rows[0]) throw unauthorized();
  return rows[0].id;
}

export async function contactFor(pool: Pool, account: string) {
  const { rows } = await pool.query<{ method: string; value: string }>(
    'SELECT method, value FROM onboarding.demo_contacts WHERE user_id = $1', [account],
  );
  return rows[0] ?? null;
}
