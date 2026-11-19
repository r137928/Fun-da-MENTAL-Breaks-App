import type { Pool, PoolClient } from 'pg';
import {
  ApiError, BlueprintSchema, CompletedBreakSchema, UserSchema, applyCardDefaults, emailAddress,
  legacyRequestHash, profileFromBlueprint, publicUser, toBreak, unauthorized, validateNewBreak,
  type Blueprint, type CompletedBreak, type ProfileInput, type SaveBlueprint,
} from './model.js';

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollback) {
      broken = true;
      throw new AggregateError([error, rollback], 'Database transaction rollback failed');
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

async function lockActive(client: PoolClient, user: string) {
  const { rows } = await client.query<{ setup_complete: boolean }>(
    "SELECT blueprint_completed_at IS NOT NULL AS setup_complete FROM onboarding.accounts " +
    "WHERE id = $1 AND status = 'active' FOR UPDATE", [user],
  );
  const account = rows[0];
  if (!account) throw unauthorized();
  return account.setup_complete;
}

interface ProfileRow {
  public_id: number;
  created_at: Date;
  profile: ProfileInput;
  role: string;
  password: string;
}

async function readUser(client: PoolClient, account: string) {
  const { rows } = await client.query<ProfileRow>(
    'SELECT a.public_id, a.created_at, p.profile, p.role, p.password ' +
    'FROM onboarding.accounts a JOIN onboarding.user_profiles p ON p.account_id = a.id WHERE a.id = $1',
    [account],
  );
  const row = rows[0];
  if (!row) return null;
  return publicUser(UserSchema.parse({
    ...row.profile,
    user_id: row.public_id,
    created_at: row.created_at.toISOString(),
    role: row.role,
    password: row.password,
  }));
}

export async function updateUser(pool: Pool, account: string, profile: ProfileInput) {
  if (profile.email !== undefined) profile.email = emailAddress(profile.email);
  return transaction(pool, async client => {
    await lockActive(client, account);
    await client.query(
      'INSERT INTO onboarding.user_profiles (account_id, profile) VALUES ($1, $2) ' +
      'ON CONFLICT (account_id) DO UPDATE SET profile = EXCLUDED.profile', [account, profile],
    );
    return readUser(client, account);
  });
}

const withBreak = (record: CompletedBreak) => ({ ...record, break: toBreak(record) });

export async function readBlueprint(pool: Pool, account: string) {
  const { rows } = await pool.query<{ revision: string | null; document: Blueprint | null }>(
    'SELECT b.revision, b.document FROM onboarding.accounts a ' +
    'LEFT JOIN onboarding.blueprints b ON b.user_id = a.id ' +
    "WHERE a.id = $1 AND a.status = 'active'", [account],
  );
  const row = rows[0];
  if (!row) throw unauthorized();
  return { revision: row.revision === null ? null : Number(row.revision), blueprint: row.document };
}

export async function me(pool: Pool, account: string) {
  return transaction(pool, async client => {
    const setup_complete = await lockActive(client, account);
    const { rows: blueprints } = await client.query<{ revision: string; document: Blueprint }>(
      'SELECT revision, document FROM onboarding.blueprints WHERE user_id = $1', [account],
    );
    const { rows: breaks } = await client.query<{ document: CompletedBreak }>(
      'SELECT document FROM onboarding.breaks WHERE user_id = $1 ORDER BY completed_at DESC, id LIMIT 30',
      [account],
    );
    const blueprint = blueprints[0];
    return {
      user_id: account,
      user: await readUser(client, account),
      setup_complete,
      blueprint: blueprint?.document ?? null,
      revision: blueprint ? Number(blueprint.revision) : null,
      recent_breaks: breaks.map(row => withBreak(row.document)),
    };
  });
}

export async function save(pool: Pool, account: string, request: SaveBlueprint) {
  const hash = legacyRequestHash(request);
  return transaction(pool, async client => {
    await lockActive(client, account);
    const { rows: receipts } = await client.query<{ payload_hash: Buffer; revision: string; break_id: string | null }>(
      'SELECT payload_hash, revision, break_id FROM onboarding.blueprint_requests WHERE user_id = $1 AND request_id = $2',
      [account, request.request_id],
    );
    const receipt = receipts[0];
    if (receipt) {
      if (!receipt.payload_hash.equals(hash)) throw new ApiError(409, 'idempotency_key_reused');
      return { revision: Number(receipt.revision), break_id: receipt.break_id };
    }

    const { rows: current } = await client.query<{ revision: string }>(
      'SELECT revision FROM onboarding.blueprints WHERE user_id = $1', [account],
    );
    const previous = current[0] ? Number(current[0].revision) : null;
    if (previous !== request.expected_revision) throw new ApiError(409, 'blueprint_changed');
    const first = request.first_break;
    if (first && (previous !== null || first.source !== 'onboarding')) {
      throw new ApiError(422, 'first_break');
    }
    if (first) validateNewBreak(first);

    const blueprint = BlueprintSchema.parse(request.blueprint);
    applyCardDefaults(blueprint);
    const revision = (previous ?? 0) + 1;
    await client.query(
      'INSERT INTO onboarding.blueprints (user_id, revision, document) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (user_id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document',
      [account, revision, blueprint],
    );
    const break_id = first ? (await insertBreak(client, account, first)).break_id : null;
    await client.query(
      'UPDATE onboarding.accounts SET blueprint_completed_at = COALESCE(blueprint_completed_at, now()) WHERE id = $1',
      [account],
    );
    if (previous === null) {
      const { rows } = await client.query<{ profile: ProfileInput }>(
        'SELECT profile FROM onboarding.user_profiles WHERE account_id = $1', [account],
      );
      if (rows[0]) {
        await client.query('UPDATE onboarding.user_profiles SET profile = $2 WHERE account_id = $1',
          [account, profileFromBlueprint(rows[0].profile, blueprint)]);
      }
    }
    await client.query(
      'INSERT INTO onboarding.blueprint_requests (user_id, request_id, payload_hash, revision, break_id) VALUES ($1, $2, $3, $4, $5)',
      [account, request.request_id, hash, revision, break_id],
    );
    return { revision, break_id };
  });
}

export async function saveBreak(pool: Pool, account: string, record: CompletedBreak) {
  return transaction(pool, async client => {
    if (!(await lockActive(client, account))) throw new ApiError(409, 'save_blueprint_first');
    validateNewBreak(record);
    return insertBreak(client, account, record);
  });
}

function orderedJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(orderedJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => JSON.stringify(key) + ':' + orderedJson(entry)).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function insertBreak(client: PoolClient, account: string, record: CompletedBreak) {
  const document = withBreak(record);
  const inserted = await client.query(
    'INSERT INTO onboarding.breaks (user_id, id, completed_at, document) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
    [account, record.id, record.completed_at, document],
  );
  if (inserted.rowCount === 0) {
    const { rows } = await client.query<{ document: CompletedBreak }>(
      'SELECT document FROM onboarding.breaks WHERE user_id = $1 AND id = $2', [account, record.id],
    );
    const existing = rows[0];
    if (!existing || orderedJson(withBreak(CompletedBreakSchema.parse(existing.document))) !== orderedJson(document)) {
      throw new ApiError(409, 'break_id_reused');
    }
  }
  return { break_id: record.id, break: document.break };
}
