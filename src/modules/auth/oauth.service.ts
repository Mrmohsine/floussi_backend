// OAuth (Google + Apple) — verifies a provider-signed id_token and signs the
// user in. The mobile app does the actual user-facing OAuth dance via the
// platform native sheet; we only see the resulting id_token.
//
// Flow:
//   1. Phone runs Google Sign-In / Sign in with Apple → gets id_token (JWT).
//   2. Phone POSTs { idToken } to /auth/oauth/{provider}.
//   3. We pull Google/Apple's public keys (JWKS), verify the signature,
//      check audience matches one of our configured client IDs, check
//      issuer + expiry. If anything is off, 401.
//   4. Find user by (provider, providerSub) → if not found, find by email
//      and link → if neither, create a new user.
//   5. Mint our own JWT and return { token, user } shaped like /auth/login.

import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { badRequest, unauthorized } from '../../utils/errors';
import { signToken } from '../../utils/jwt';

// Cached JWKS clients — `createRemoteJWKSet` builds a key fetcher with its
// own internal cache, so call it once per provider.
const googleJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);
const appleJwks = createRemoteJWKSet(
  new URL('https://appleid.apple.com/auth/keys'),
);

const GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const APPLE_ISSUER = 'https://appleid.apple.com';

interface VerifiedClaims {
  sub: string;          // stable provider-side user ID
  email: string;
  emailVerified: boolean;
  name: string | null;
}

async function verifyGoogleIdToken(idToken: string): Promise<VerifiedClaims> {
  // Google sometimes signs with the iOS client as audience and sometimes
  // with the web one (depending on which native SDK call produced the
  // token). Both are valid for our app — accept either.
  const audiences = [
    env.GOOGLE_OAUTH_WEB_CLIENT_ID,
    env.GOOGLE_OAUTH_IOS_CLIENT_ID,
  ].filter((a): a is string => !!a);

  if (audiences.length === 0) {
    throw badRequest('Google sign-in is not configured on the server.');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks, {
      audience: audiences,
    }));
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      throw unauthorized(`Google id_token rejected: ${err.code}`);
    }
    throw unauthorized('Google id_token rejected.');
  }

  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw unauthorized('Google id_token issuer mismatch.');
  }

  const sub = String(payload.sub ?? '').trim();
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!sub) throw unauthorized('Google id_token missing sub.');
  if (!email) throw unauthorized('Google id_token missing email.');

  return {
    sub,
    email,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' && payload.name.length > 0
      ? payload.name
      : null,
  };
}

async function verifyAppleIdToken(idToken: string): Promise<VerifiedClaims> {
  if (!env.APPLE_BUNDLE_ID) {
    throw badRequest('Apple sign-in is not configured on the server.');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, appleJwks, {
      issuer: APPLE_ISSUER,
      audience: env.APPLE_BUNDLE_ID,
    }));
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      throw unauthorized(`Apple id_token rejected: ${err.code}`);
    }
    throw unauthorized('Apple id_token rejected.');
  }

  const sub = String(payload.sub ?? '').trim();
  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!sub) throw unauthorized('Apple id_token missing sub.');
  // Apple gives us email on the very first sign-in, then never again — so
  // when an existing user re-signs-in, email will be missing here. We don't
  // need it once the user exists (we look them up by sub), but the very
  // first sign-in must include it.
  return {
    sub,
    email,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: null, // Apple sends fullName separately, not in the id_token
  };
}

const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  currency: string;
  paySchedule: string;
  plan: string;
  emailVerified: boolean;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  currency: u.currency,
  paySchedule: u.paySchedule,
  plan: u.plan,
  emailVerified: u.emailVerified,
});

interface OAuthSignInArgs {
  provider: 'google' | 'apple';
  claims: VerifiedClaims;
  // Apple only sends fullName on the first sign-in, in the auth response
  // (not the id_token). The mobile client passes it through so we can use
  // it as the new user's display name.
  fullName?: { givenName?: string | null; familyName?: string | null } | null;
}

async function signInOrCreateOAuthUser({ provider, claims, fullName }: OAuthSignInArgs) {
  // 1. Already linked? Just sign them in.
  let user = await prisma.user.findFirst({
    where: { provider, providerSub: claims.sub },
  });

  // 2. Not linked but email matches an existing email/password account →
  //    auto-link. (Provider verified the email address, so this is safe.)
  if (!user && claims.email) {
    const byEmail = await prisma.user.findUnique({ where: { email: claims.email } });
    if (byEmail) {
      // Don't re-link if this user already has a different OAuth provider
      // attached — surface it as a conflict so the mobile client can ask
      // the user to sign in via their original method.
      if (byEmail.provider && byEmail.provider !== provider) {
        throw badRequest(
          `This email is already linked to ${byEmail.provider}. Sign in with that provider instead.`,
        );
      }
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          provider,
          providerSub: claims.sub,
          // OAuth providers verify email before issuing the token, so flip
          // the verified flag on if it isn't already.
          emailVerified: byEmail.emailVerified || claims.emailVerified,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? (claims.emailVerified ? new Date() : null),
        },
      });
    }
  }

  // 3. Brand-new user → create.
  if (!user) {
    if (!claims.email) {
      // Apple withholds email on the second-and-onward sign-in. If we hit
      // this branch (no link, no email), the only path forward is for the
      // user to revoke the app from Apple ID settings and re-authorize.
      throw badRequest(
        'No account found for this Apple ID. Revoke Paycheck in Apple ID settings and sign in again.',
      );
    }
    const displayName =
      [fullName?.givenName, fullName?.familyName].filter(Boolean).join(' ').trim() ||
      claims.name ||
      claims.email.split('@')[0] ||
      'New user';
    user = await prisma.user.create({
      data: {
        email: claims.email,
        name: displayName,
        provider,
        providerSub: claims.sub,
        emailVerified: claims.emailVerified,
        emailVerifiedAt: claims.emailVerified ? new Date() : null,
        // passwordHash stays null for OAuth users.
      },
    });
  }

  const token = signToken({ sub: user.id, email: user.email });
  return { token, user: publicUser(user) };
}

export async function googleSignIn(idToken: string) {
  const claims = await verifyGoogleIdToken(idToken);
  return signInOrCreateOAuthUser({ provider: 'google', claims });
}

export async function appleSignIn(
  idToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
) {
  if (!env.OAUTH_APPLE_ENABLED) {
    throw badRequest('Apple sign-in is not enabled yet.');
  }
  const claims = await verifyAppleIdToken(idToken);
  return signInOrCreateOAuthUser({ provider: 'apple', claims, fullName });
}
