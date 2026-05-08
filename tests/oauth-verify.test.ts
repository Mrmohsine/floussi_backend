// Sanity check that the OAuth verification path is wired correctly.
// We don't need a real Google id_token (don't have one in CI) — we just
// confirm that:
//   1. jose can fetch Google's JWKS (network + parser path works)
//   2. A garbage token is rejected with a JOSE error code
//   3. The error surface is what /auth/oauth/google would return

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from 'jose';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

test('Google JWKS endpoint is reachable and signs keys', async () => {
  const res = await fetch(GOOGLE_JWKS_URL);
  assert.equal(res.status, 200, 'Google JWKS endpoint should return 200');
  const body = await res.json();
  assert.ok(Array.isArray(body.keys) && body.keys.length > 0, 'should have keys');
});

test('Apple JWKS endpoint is reachable', async () => {
  const res = await fetch(APPLE_JWKS_URL);
  assert.equal(res.status, 200, 'Apple JWKS endpoint should return 200');
});

test('Garbage Google id_token is rejected with a JOSE error', async () => {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const fakeToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZha2UifQ.eyJzdWIiOiJ0ZXN0In0.invalid';

  let caught: unknown = null;
  try {
    await jwtVerify(fakeToken, jwks, {
      audience: '991042418927-sd0vsu338q2agccdqu3ecda7clo5glc2.apps.googleusercontent.com',
    });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof joseErrors.JOSEError, 'should throw JOSEError');
});

test('Empty / malformed token rejected immediately (no network needed)', async () => {
  const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  let caught: unknown = null;
  try {
    await jwtVerify('not-a-jwt-at-all', jwks, { audience: 'whatever' });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof joseErrors.JOSEError, 'should throw JOSEError');
});
