import {
  createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes, randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, SignJWT } from 'jose';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {
  ApiError, EligibilitySchema, emailAddress, parse, unauthorized, unavailable, uuid, type Eligibility,
} from './model.js';
import { transaction } from './store.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const appleIssuer = 'https://appleid.apple.com';

export function bearer(header: string | undefined) {
  if (!header?.startsWith('Bearer ') || !header.slice(7)) throw unauthorized();
  return header.slice(7);
}

export function authConfig(env: NodeJS.ProcessEnv) {
  const privateKey = (env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const encryptionKey = Buffer.from(env.APPLE_TOKEN_ENCRYPTION_KEY ?? '', 'base64');
  const config = {
    enabled: env.AUTH_ENABLED === 'true',
    policyVersion: Number(env.AGE_POLICY_VERSION || 1),
    selfDeclared: env.ALLOW_SELF_DECLARED === 'true',
    authUrl: (env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY ?? '',
    secretKey: env.SUPABASE_SECRET_KEY ?? '',
    appleClient: env.APPLE_CLIENT_ID ?? '',
    appleTeam: env.APPLE_TEAM_ID ?? '',
    appleKeyId: env.APPLE_KEY_ID ?? '',
    appleKey: privateKey ? createPrivateKey(privateKey) : undefined,
    encryptionKey,
    maintenanceToken: env.MAINTENANCE_TOKEN ?? '',
  };
  if (env.APPLE_TOKEN_ENCRYPTION_KEY && encryptionKey.length !== 32) {
    throw new Error('APPLE_TOKEN_ENCRYPTION_KEY must encode 32 bytes');
  }
  if (config.enabled) {
    const url = URL.canParse(config.authUrl) ? new URL(config.authUrl) : undefined;
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !config.publishableKey || !config.secretKey || !config.appleClient || !config.appleTeam ||
      !config.appleKeyId || config.appleKey?.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      encryptionKey.length !== 32 || config.maintenanceToken.length < 32 ||
      !Number.isSafeInteger(config.policyVersion) || config.policyVersion < 1) {
      throw new Error('Auth settings are incomplete or invalid');
    }
  }
  return config;
}
type Config = ReturnType<typeof authConfig>;

const sessionSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().nonnegative(),
});
const claimsSchema = z.object({ sub: uuid, session_id: uuid });
type Claims = z.infer<typeof claimsSchema>;
const appleClaimsSchema = z.object({ sub: z.string().min(1), nonce: z.string().optional() });
const emailStartSchema = z.strictObject({ email: z.string(), eligibility: EligibilitySchema });
const emailVerifySchema = z.strictObject({ attempt_id: uuid, code: z.string().regex(/^\d{6,10}$/) });
const appleLoginSchema = z.strictObject({
  identity_token: z.string().min(1),
  authorization_code: z.string().min(1),
  nonce: z.string().min(32).max(128),
  eligibility: EligibilitySchema,
});
const refreshSchema = z.strictObject({ refresh_token: z.string().min(1) });

async function providerRequest(url: string, options: RequestInit = {}) {
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch (error) {
    if (error instanceof Error) throw unavailable();
    throw error;
  }
}

async function providerJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof Error) throw unavailable();
    throw error;
  }
  const result = schema.safeParse(payload);
  if (!result.success) throw unavailable();
  return result.data;
}

async function verify<T>(
  token: string, keys: ReturnType<typeof createRemoteJWKSet>, issuer: string,
  audience: string, algorithms: string[], schema: z.ZodType<T>,
) {
  try {
    if (!decodeProtectedHeader(token).kid) throw unauthorized();
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms, requiredClaims: ['exp'],
    });
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof TypeError ||
      (error instanceof Error && 'code' in error && error.code === 'ERR_JWKS_TIMEOUT')) {
      throw unavailable();
    }
    throw unauthorized();
  }
}

function seal(key: Buffer, subject: string, token: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(subject));
  return Buffer.concat([nonce, cipher.update(token, 'utf8'), cipher.final(), cipher.getAuthTag()]);
}

function unseal(key: Buffer, subject: string, payload: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(-16));
  decipher.setAAD(Buffer.from(subject));
  return Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]).toString('utf8');
}

interface Approval {
  subject: string;
  eligibility_method: Eligibility['method'];
  policy_version: number;
}

interface PendingDeletion {
  apple_revoked: boolean;
  apple_subject: string | null;
  apple_refresh_encrypted: Buffer | null;
}

export class Auth {
  private readonly keySet;
  private readonly appleKeys = createRemoteJWKSet(new URL(appleIssuer + '/auth/keys'), {
    timeoutDuration: 8000,
  });

  constructor(private readonly pool: Pool, private readonly config: Config) {
    this.keySet = config.enabled
      ? createRemoteJWKSet(new URL(config.authUrl + '/auth/v1/.well-known/jwks.json'), {
        timeoutDuration: 8000, cooldownDuration: 30_000, cacheMaxAge: 600_000,
      })
      : undefined;
  }

  private checkEligibility(evidence: Eligibility) {
    if (!this.config.enabled) throw new ApiError(503, 'signup_unavailable');
    if (evidence.policy_version !== this.config.policyVersion) {
      throw new ApiError(409, 'eligibility_check_required');
    }
    if (!evidence.eligible || (evidence.method === 'self_declared' && !this.config.selfDeclared)) {
      throw new ApiError(403, 'age_not_eligible');
    }
  }

  private async sessionClaims(token: string) {
    if (!this.keySet) throw unauthorized();
    return verify(token, this.keySet, this.config.authUrl + '/auth/v1', 'authenticated',
      ['ES256', 'RS256'], claimsSchema);
  }

  async authenticate(token: string) {
    const claims = await this.sessionClaims(token);
    await this.checkSession(claims);
    return claims.sub;
  }

  private async checkSession(claims: Claims) {
    const { rowCount } = await this.pool.query(
      'SELECT 1 FROM onboarding.approved_sessions s JOIN onboarding.accounts a ON a.id = s.user_id ' +
      "WHERE s.session_id = $1 AND a.id = $2 AND a.status = 'active' AND s.policy_version = $3 " +
      "AND ($4 OR s.eligibility_method = 'apple_age_range')",
      [claims.session_id, claims.sub, this.config.policyVersion, this.config.selfDeclared],
    );
    if (rowCount !== 1) throw unauthorized();
  }

  private async request(path: string, payload: unknown) {
    const response = await providerRequest(this.config.authUrl + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: this.config.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 429) throw new ApiError(429, 'try_again_later');
    if (response.status >= 400 && response.status < 500) throw unauthorized();
    if (!response.ok) throw unavailable();
    return response;
  }

  private async registerApproval(provider: 'email' | 'apple', subject: string, eligibility: Eligibility) {
    return transaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [provider + ':' + subject]);
      const { rows } = await client.query<{ count: string }>(
        'SELECT count(*) FROM onboarding.signup_approvals WHERE provider = $1 AND subject = $2 AND expires_at > now()',
        [provider, subject],
      );
      if (Number(rows[0]?.count) >= 5) throw new ApiError(429, 'try_again_later');
      const id = randomUUID();
      await client.query(
        'INSERT INTO onboarding.signup_approvals (id, provider, subject, eligibility_method, policy_version, expires_at) ' +
        "VALUES ($1, $2, $3, $4, $5, now() + interval '15 minutes')",
        [id, provider, subject, eligibility.method, eligibility.policy_version],
      );
      return id;
    });
  }

  async emailStart(input: unknown) {
    const { email: raw, eligibility } = parse(emailStartSchema, input, 'email');
    this.checkEligibility(eligibility);
    const email = emailAddress(raw);
    const attempt_id = await this.registerApproval('email', email, eligibility);
    await this.request('otp', { email, create_user: true, data: { signup_approval: attempt_id } });
    return { attempt_id };
  }

  async emailVerify(input: unknown) {
    if (!this.config.enabled) throw unauthorized();
    const { attempt_id, code } = parse(emailVerifySchema, input, 'code');
    const { rows } = await this.pool.query<Approval>(
      'SELECT subject, eligibility_method, policy_version FROM onboarding.signup_approvals ' +
      "WHERE id = $1 AND provider = 'email' AND expires_at > now()", [attempt_id],
    );
    const approval = rows[0];
    if (!approval) throw unauthorized();
    if (approval.policy_version !== this.config.policyVersion ||
        (approval.eligibility_method === 'self_declared' && !this.config.selfDeclared)) {
      throw new ApiError(409, 'eligibility_check_required');
    }
    const session = await providerJson(await this.request('verify', {
      email: approval.subject, token: code, type: 'email',
    }), sessionSchema);
    const claims = await this.sessionClaims(session.access_token);
    await transaction(this.pool, async client => {
      const consumed = await client.query(
        'DELETE FROM onboarding.signup_approvals WHERE id = $1 AND expires_at > now()', [attempt_id],
      );
      if (consumed.rowCount !== 1) throw unauthorized();
      await this.approveSession(client, claims, approval.eligibility_method, approval.policy_version);
    });
    return session;
  }

  private appleIdentity(token: string) {
    return verify(token, this.appleKeys, appleIssuer, this.config.appleClient, ['RS256'], appleClaimsSchema);
  }

  private async appleRequest(path: 'token' | 'revoke', body: Record<string, string>) {
    const key = this.config.appleKey;
    if (!key) throw unavailable();
    const secret = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: this.config.appleKeyId })
      .setIssuer(this.config.appleTeam).setSubject(this.config.appleClient).setAudience(appleIssuer)
      .setIssuedAt().setExpirationTime('5m').sign(key);
    return providerRequest(appleIssuer + '/auth/' + path, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: this.config.appleClient, client_secret: secret, ...body,
      }),
    });
  }

  async apple(input: unknown) {
    const body = parse(appleLoginSchema, input, 'apple_credentials');
    this.checkEligibility(body.eligibility);
    const identity = await this.appleIdentity(body.identity_token);
    if (identity.nonce !== sha256(body.nonce).toString('hex')) throw unauthorized();
    const response = await this.appleRequest('token', {
      code: body.authorization_code, grant_type: 'authorization_code',
    });
    if (response.status >= 400 && response.status < 500) throw unauthorized();
    if (!response.ok) throw unavailable();
    const tokens = await providerJson(response, z.object({
      id_token: z.string().min(1), refresh_token: z.string().min(1),
    }));
    if ((await this.appleIdentity(tokens.id_token)).sub !== identity.sub) throw unauthorized();
    const encrypted = seal(this.config.encryptionKey, identity.sub, tokens.refresh_token);
    const approval = await this.registerApproval('apple', identity.sub, body.eligibility);
    const session = await providerJson(await this.request('token?grant_type=id_token', {
      provider: 'apple', id_token: body.identity_token, nonce: body.nonce,
    }), sessionSchema);
    const claims = await this.sessionClaims(session.access_token);
    await transaction(this.pool, async client => {
      await this.approveSession(client, claims, body.eligibility.method, body.eligibility.policy_version, {
        subject: identity.sub, encrypted,
      });
      await client.query('DELETE FROM onboarding.signup_approvals WHERE id = $1', [approval]);
    });
    return session;
  }

  private async approveSession(client: PoolClient, claims: Claims, method: string, version: number,
    apple?: { subject: string; encrypted: Buffer }) {
    const changed = await client.query(
      'INSERT INTO onboarding.accounts (id, eligibility_method, policy_version, apple_subject, apple_refresh_encrypted) ' +
      'VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET eligibility_method = EXCLUDED.eligibility_method, ' +
      'policy_version = EXCLUDED.policy_version, eligibility_checked_at = now(), ' +
      'apple_subject = COALESCE(EXCLUDED.apple_subject, accounts.apple_subject), ' +
      'apple_refresh_encrypted = COALESCE(EXCLUDED.apple_refresh_encrypted, accounts.apple_refresh_encrypted) ' +
      "WHERE accounts.status = 'active' AND (accounts.apple_subject IS NULL OR EXCLUDED.apple_subject IS NULL " +
      'OR accounts.apple_subject = EXCLUDED.apple_subject)',
      [claims.sub, method, version, apple?.subject ?? null, apple?.encrypted ?? null],
    );
    if (changed.rowCount !== 1) throw unauthorized();
    await client.query(
      'INSERT INTO onboarding.approved_sessions (session_id, user_id, eligibility_method, policy_version) ' +
      'VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [claims.session_id, claims.sub, method, version],
    );
  }

  async refresh(input: unknown) {
    if (!this.config.enabled) throw unauthorized();
    const body = parse(refreshSchema, input, 'refresh_token');
    const session = await providerJson(await this.request('token?grant_type=refresh_token', body), sessionSchema);
    await this.authenticate(session.access_token);
    return session;
  }

  async signOut(token: string) {
    const claims = await this.sessionClaims(token);
    await this.checkSession(claims);
    await this.pool.query('DELETE FROM onboarding.approved_sessions WHERE user_id = $1 AND session_id = $2',
      [claims.sub, claims.session_id]);
    try {
      const response = await providerRequest(this.config.authUrl + '/auth/v1/logout?scope=local', {
        method: 'POST', headers: { apikey: this.config.publishableKey, Authorization: 'Bearer ' + token },
      });
      if (!response.ok) console.warn('Identity provider logout did not complete');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      console.warn('Identity provider logout did not complete');
    }
  }

  async delete(account: string) {
    await transaction(this.pool, async client => {
      await client.query("UPDATE onboarding.accounts SET status = 'deleting', blueprint_completed_at = NULL WHERE id = $1",
        [account]);
      await client.query('DELETE FROM onboarding.user_profiles WHERE account_id = $1', [account]);
      for (const table of ['approved_sessions', 'blueprints', 'breaks', 'blueprint_requests']) {
        await client.query('DELETE FROM onboarding.' + table + ' WHERE user_id = $1', [account]);
      }
      await client.query('INSERT INTO onboarding.deletions (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [account]);
    });
  }

  async maintenance(token: string) {
    if (!this.config.maintenanceToken ||
        !timingSafeEqual(sha256(token), sha256(this.config.maintenanceToken))) throw unauthorized();
    await this.pool.query('DELETE FROM onboarding.signup_approvals WHERE expires_at <= now()');
    const { rows } = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM onboarding.deletions ORDER BY requested_at LIMIT 20',
    );
    let failed = false;
    for (const { user_id } of rows) {
      try {
        await this.finishDeletion(user_id);
      } catch (error) {
        console.warn('Account deletion will retry', error instanceof ApiError ? error.code : 'storage_error');
        failed = true;
      }
    }
    if (failed) throw unavailable();
  }

  private async finishDeletion(account: string) {
    const ready = await transaction(this.pool, async client => {
      const { rows } = await client.query<PendingDeletion>(
        'SELECT d.apple_revoked, a.apple_subject, a.apple_refresh_encrypted ' +
        'FROM onboarding.deletions d JOIN onboarding.accounts a ON a.id = d.user_id ' +
        'WHERE d.user_id = $1 FOR UPDATE OF d SKIP LOCKED', [account],
      );
      const pending = rows[0];
      if (!pending) return false;
      if (!pending.apple_revoked) {
        if (pending.apple_subject && pending.apple_refresh_encrypted) {
          const token = unseal(this.config.encryptionKey, pending.apple_subject, pending.apple_refresh_encrypted);
          const response = await this.appleRequest('revoke', { token, token_type_hint: 'refresh_token' });
          if (!response.ok) throw unavailable();
        }
        await client.query('UPDATE onboarding.deletions SET apple_revoked = true WHERE user_id = $1', [account]);
        await client.query('UPDATE onboarding.accounts SET apple_refresh_encrypted = NULL WHERE id = $1', [account]);
      }
      return true;
    });
    if (!ready) return;
    await transaction(this.pool, async client => {
      const { rowCount } = await client.query(
        'SELECT 1 FROM onboarding.deletions WHERE user_id = $1 AND apple_revoked FOR UPDATE SKIP LOCKED', [account],
      );
      if (!rowCount) return;
      const response = await providerRequest(this.config.authUrl + '/auth/v1/admin/users/' + account, {
        method: 'DELETE', headers: { apikey: this.config.secretKey },
      });
      if (!response.ok && response.status !== 404) throw unavailable();
      await client.query('DELETE FROM onboarding.accounts WHERE id = $1', [account]);
    });
  }
}
