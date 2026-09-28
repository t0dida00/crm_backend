import request from 'supertest';
import app from '../../src/app';

describe('app error handler', () => {
  it('answers invalid JSON with 400, not a server error', async () => {
    const res = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('"email":"a@b.co"');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "The request body isn't valid JSON." });
  });

  it('answers an oversized JSON body with 413', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });
});
