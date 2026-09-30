process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/server');

test('GET /healthz returns 200', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
});
