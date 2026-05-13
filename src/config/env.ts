import { config } from 'dotenv';
import { z } from 'zod';

const runtimeNodeEnv = process.env.NODE_ENV;

// override:true so values in our backend/.env file beat any system-wide env
// vars the user might have set (e.g. a personal OPENAI_API_KEY for another
// project would otherwise win and pollute this app's chat).
config({ override: true });
if (runtimeNodeEnv === 'test') {
  process.env.NODE_ENV = 'test';
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default(''),
  // Optional — chat endpoint returns a friendly 503 if the key is missing.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  // Optional — billing endpoints return 503 if these are missing.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Optional — required for syncing native subscriptions into backend plans.
  REVENUECAT_SECRET_KEY: z.string().optional(),
  // Used to build success/cancel URLs that deep-link back into the app.
  APP_DEEP_LINK_SCHEME: z.string().default('paycheck'),
  // Optional — if missing, OTP codes log to stdout instead of being emailed.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Paycheck <onboarding@resend.dev>'),
  // Google OAuth client IDs used to verify native Google id_tokens.
  GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_IOS_CLIENT_ID: z.string().optional(),
  // Plaid — required for bank linking. Routes return 503 if either is missing.
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(['sandbox', 'development', 'production']).default('sandbox'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
