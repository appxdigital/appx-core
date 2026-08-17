import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, startApp, stopApp } from './helpers/harness';

describe('app', () => {
  beforeAll(async () => {
    await startApp();
  });
  afterAll(stopApp);

  it('boots and answers on /', async () => {
    const res = await api().get('/');
    expect(res.status).toBe(200);
  });
});
