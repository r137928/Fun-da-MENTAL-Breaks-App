import Fastify, { type FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { recommendBreak } from '../../catalog/recommendations.mjs';
import { Auth, authConfig, bearer } from './auth.js';
import { authenticateDemo, contactFor, demoRoutes } from './demo.js';
import {
  ApiError, BreakSuggestionInputSchema, CompletedBreakSchema, ProfileInputSchema, SaveBlueprintSchema, catalog, parse,
} from './model.js';
import { me, readBlueprint, save, saveBreak, updateUser } from './store.js';

export function createApp(pool: Pool, { demo = false, env = process.env } = {}) {
  const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
  const auth = new Auth(pool, authConfig(env));

  const user = (request: FastifyRequest) => {
    const token = bearer(request.headers.authorization);
    return demo ? authenticateDemo(pool, token) : auth.authenticate(token);
  };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({ code: error.code });
    }
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ code: 'invalid_body' });
    }
    console.error('Backend operation failed', error instanceof Error ? error.name : 'unknown');
    return reply.code(500).send({ code: 'storage_error' });
  });

  app.get('/health', async (_request, reply) => reply.code(204).send());
  app.get('/ready', async (_request, reply) => {
    await pool.query('SELECT account_id FROM onboarding.user_profiles LIMIT 0');
    return reply.code(204).send();
  });
  app.get('/v1/me', async request => {
    const account = await user(request);
    const result = await me(pool, account);
    return demo ? { ...result, contact: await contactFor(pool, account) } : result;
  });
  app.put('/v1/me/profile', async request => updateUser(pool, await user(request),
    parse(ProfileInputSchema, request.body, 'user_profile')));
  app.put('/v1/me/blueprint', async request =>
    save(pool, await user(request), parse(SaveBlueprintSchema, request.body, 'save_request')));
  app.post('/v1/me/break-suggestions', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const account = await user(request);
    const checkIn = parse(BreakSuggestionInputSchema, request.body, 'break_check_in');
    const { blueprint, revision } = await readBlueprint(pool, account);
    return { ...recommendBreak(catalog, blueprint, checkIn), blueprint_revision: revision };
  });
  app.post('/v1/me/breaks', async request =>
    saveBreak(pool, await user(request), parse(CompletedBreakSchema, request.body, 'completed_break')));

  if (demo) {
    demoRoutes(app, pool);
  } else {
    app.post('/v1/auth/apple', request => auth.apple(request.body));
    app.post('/v1/auth/email/start', request => auth.emailStart(request.body));
    app.post('/v1/auth/email/verify', request => auth.emailVerify(request.body));
    app.post('/v1/auth/refresh', request => auth.refresh(request.body));
    app.post('/v1/auth/signout', async (request, reply) => {
      await auth.signOut(bearer(request.headers.authorization));
      return reply.code(204).send();
    });
    app.delete('/v1/me', async (request, reply) => {
      await auth.delete(await user(request));
      return reply.code(202).send();
    });
    app.post('/internal/maintenance', async (request, reply) => {
      await auth.maintenance(bearer(request.headers.authorization));
      return reply.code(204).send();
    });
  }
  return app;
}
