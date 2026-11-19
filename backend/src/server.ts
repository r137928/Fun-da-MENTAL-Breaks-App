import pg from 'pg';
import { createApp } from './app.js';
import { initializeDemo } from './demo.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const demo = process.argv[2] === 'demo';
if (demo && (process.env.ENABLE_LOCAL_DEMO !== 'true' || process.env.AUTH_ENABLED === 'true')) {
  throw new Error('Demo mode requires ENABLE_LOCAL_DEMO=true and disabled production auth');
}
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');

const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
pool.on('error', () => console.error('Idle PostgreSQL connection failed'));
try {
  if (demo) await initializeDemo(pool);
  const app = createApp(pool, { demo });
  app.addHook('onClose', () => pool.end());
  await app.listen({ host: '0.0.0.0', port });
  const stop = () => void app.close().catch(() => { process.exitCode = 1; });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  await pool.end();
  throw error;
}
