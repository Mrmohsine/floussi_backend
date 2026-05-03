import { config } from 'dotenv';
import { z } from 'zod';

// override:true so values in our backend/.env file beat any system-wide env
// vars the user might have set (e.g. a personal OPENAI_API_KEY for another
// project would otherwise win and pollute this app's chat).
config({ override: true });

const schema = z.object({
  // Accept any non-empty string so file:./dev.db (SQLite) is allowed too.
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Optional — chat endpoint returns a friendly 503 if the key is missing.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4.1-mini'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
