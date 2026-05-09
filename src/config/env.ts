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
  // Accept any non-empty string so file:./dev.db (SQLite) is allowed too.
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default(''),
  // Optional — chat endpoint returns a friendly 503 if the key is missing.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
  // Optional — billing endpoints return 503 if these are missing.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Used to build success/cancel URLs that deep-link back into the app.
  APP_DEEP_LINK_SCHEME: z.string().default('paycheck'),
  // Optional — if missing, OTP codes log to stdout instead of being emailed.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Paycheck <onboarding@resend.dev>'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
