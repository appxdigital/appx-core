import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { api, startApp, stopApp } from './helpers/harness';

/**
 * Route-sweep backstop: every HTTP route the app actually registers is probed
 * as a guest, and anything not explicitly public must deny. A new endpoint
 * with no access rule turns this red the day it lands. Add intentionally
 * public routes to the allowlist — deliberately, one by one.
 */
const PUBLIC_ROUTES = new Set([
  'GET /',
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/login/jwt',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/logout/jwt',
]);

/** Enumerates live routes from the Nest container, walking prototype chains so
 * inherited CRUD routes (CoreController) are included. */
function listRoutes(app: INestApplication): { verb: string; path: string }[] {
  const container = app.get(ModulesContainer);
  const routes: { verb: string; path: string }[] = [];
  for (const moduleRef of container.values()) {
    for (const controller of moduleRef.controllers.values()) {
      const cls = controller.metatype as any;
      if (!cls) continue;
      const prefix = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '').replace(/^\/|\/$/g, '');
      const seen = new Set<string>();
      let proto = cls.prototype;
      while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === 'constructor' || seen.has(name)) continue;
          seen.add(name);
          const descriptor = Object.getOwnPropertyDescriptor(proto, name);
          if (!descriptor || typeof descriptor.value !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, descriptor.value);
          if (method === undefined) continue;
          const suffix = String(Reflect.getMetadata(PATH_METADATA, descriptor.value) ?? '').replace(
            /^\/|\/$/g,
            '',
          );
          routes.push({
            verb: RequestMethod[method],
            path: '/' + [prefix, suffix].filter(Boolean).join('/'),
          });
        }
        proto = Object.getPrototypeOf(proto);
      }
    }
  }
  return routes;
}

describe('route sweep', () => {
  beforeAll(async () => {
    await startApp();
  });
  afterAll(stopApp);

  it('denies a guest on every route not explicitly public', async () => {
    const app = await startApp();
    const failures: string[] = [];
    for (const { verb, path } of listRoutes(app)) {
      const key = `${verb} ${path}`;
      if (PUBLIC_ROUTES.has(key)) continue;
      const agent = api() as any;
      const method = verb.toLowerCase();
      if (typeof agent[method] !== 'function') continue;
      const res = await agent[method](path.replace(/:\w+/g, '1')).send({});
      if (res.status < 400) failures.push(`${key} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
