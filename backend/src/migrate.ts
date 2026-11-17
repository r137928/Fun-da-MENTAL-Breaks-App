import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { transaction } from './store.js';

export async function migrate(pool: pg.Pool) {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
  await transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fundamental-breaks-migrations'))");
    await client.query(
      'CREATE TABLE IF NOT EXISTS public.fundamental_breaks_migrations ' +
      '(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      const version = Number(file.slice(0, 4));
      const sql = (await readFile(new URL(file, directory), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = createHash('sha384').update(sql).digest('hex');
      const { rows } = await client.query<{ checksum: string }>(
        'SELECT checksum FROM public.fundamental_breaks_migrations WHERE version = $1', [version],
      );
      if (rows[0]) {
        if (rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + file);
        continue;
      }
      const existing = version === 1 && (await client.query<{ present: boolean }>(
        "SELECT to_regclass('onboarding.accounts') IS NOT NULL AS present",
      )).rows[0]?.present;
      if (existing) {
        const legacy = await client.query<{ success: boolean; checksum: Buffer }>(
          'SELECT success, checksum FROM public._sqlx_migrations WHERE version = $1', [version],
        );
        const windowsChecksum = createHash('sha384').update(sql.replace(/\n/g, '\r\n')).digest('hex');
        if (!legacy.rows[0]?.success ||
          ![checksum, windowsChecksum].includes(legacy.rows[0].checksum.toString('hex'))) {
          throw new Error('Existing onboarding schema does not match the original SQLx migration');
        }
      } else {
        await client.query(sql);
      }
      await client.query(
        'INSERT INTO public.fundamental_breaks_migrations (version, checksum) VALUES ($1, $2)', [version, checksum],
      );
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) throw new Error('MIGRATION_DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
