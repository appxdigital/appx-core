import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  prisma,
  registerActor,
  sessionAgent,
  startApp,
  stopApp,
  truncateAll,
} from './helpers/harness';

// Convention: assertions are on the database (raw `prisma` client), not just
// the response body — the database is the authority on what actually happened.
describe('authentication', () => {
  beforeAll(async () => {
    await startApp();
  });
  afterAll(stopApp);
  beforeEach(truncateAll);

  it('registers a user with the default USER role and a hashed password', async () => {
    const res = await api()
      .post('/auth/register')
      .send({ email: 'reg@example.com', password: 'Password123!' });
    expect(res.status).toBeLessThan(300);

    const row = await prisma.user.findUnique({
      where: { email: 'reg@example.com' },
    });
    expect(row).not.toBeNull();
    expect(row!.role).toBe('USER');
    expect(row!.password).not.toBe('Password123!');
    expect(JSON.stringify(res.body)).not.toContain('Password123!');
  });

  it('ignores extra fields on register (no mass assignment)', async () => {
    const res = await api().post('/auth/register').send({
      email: 'forged@example.com',
      password: 'Password123!',
      role: 'ADMIN',
    });

    const row = await prisma.user.findUnique({
      where: { email: 'forged@example.com' },
    });
    // Either the request is rejected outright or the forged field is ignored —
    // the database must never hold the forged role.
    if (res.status < 300) {
      expect(row!.role).toBe('USER');
    } else {
      expect(row).toBeNull();
    }
  });

  it('session login reaches /auth/me; a guest is denied', async () => {
    await registerActor('session@example.com');

    const agent = sessionAgent();
    const login = await agent
      .post('/auth/login')
      .send({ email: 'session@example.com', password: 'Password123!' });
    expect(login.status).toBeLessThan(300);

    const me = await agent.get('/auth/me');
    expect(me.status).toBeLessThan(300);
    expect(JSON.stringify(me.body)).toContain('session@example.com');

    const guest = await api().get('/auth/me');
    expect(guest.status).toBeGreaterThanOrEqual(400);
  });

  it('JWT login issues tokens and /auth/refresh rotates them', async () => {
    await registerActor('jwt@example.com');

    const login = await api()
      .post('/auth/login/jwt')
      .send({ email: 'jwt@example.com', password: 'Password123!' });
    expect(login.status).toBeLessThan(300);
    expect(login.body.access_token).toBeTruthy();
    expect(login.body.refresh_token).toBeTruthy();

    const refreshed = await api()
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refresh_token });
    expect(refreshed.status).toBeLessThan(300);
    expect(refreshed.body.access_token).toBeTruthy();

    // The refresh token is persisted per user.
    const count = await prisma.userRefreshToken.count();
    expect(count).toBeGreaterThan(0);
  });
});
