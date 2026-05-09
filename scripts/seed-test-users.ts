// Seed three test users on Neon, one per plan tier. Idempotent — if a user
// already exists, the plan + password are reset so the script always
// converges to the same state.
//
// Login creds for all three:
//   email: free@gmail.com / pro@gmail.com / premium@gmail.com
//   password: password
//
// Run: npx tsx scripts/seed-test-users.ts
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { env } from '../src/config/env';

const PASSWORD = 'password';
const USERS = [
  { email: 'free@gmail.com',    name: 'Free User',    plan: 'FREE'    },
  { email: 'pro@gmail.com',     name: 'Pro User',     plan: 'PRO'     },
  { email: 'premium@gmail.com', name: 'Premium User', plan: 'PREMIUM' },
] as const;

function cuid(): string {
  // Quick & dirty cuid-like fallback so we don't pull in another dep.
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

async function main() {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');

  const client = new Client({ connectionString: url });
  await client.connect();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  for (const u of USERS) {
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [u.email],
    );

    if (existing.rows.length > 0) {
      // Reset plan + password so re-runs converge.
      await client.query(
        `UPDATE "User"
            SET "passwordHash" = $1,
                "plan" = $2,
                "name" = $3,
                "emailVerified" = true,
                "emailVerifiedAt" = COALESCE("emailVerifiedAt", NOW()),
                "updatedAt" = NOW()
          WHERE email = $4`,
        [passwordHash, u.plan, u.name, u.email],
      );
      console.log(`  ↻ updated   ${u.email.padEnd(22)} plan=${u.plan}`);
    } else {
      await client.query(
        `INSERT INTO "User" (
            id, email, "passwordHash", name, currency, "paySchedule",
            plan, "planSince", "emailVerified", "emailVerifiedAt",
            "createdAt", "updatedAt"
          ) VALUES (
            $1, $2, $3, $4, 'USD', 'BIWEEKLY',
            $5, NOW(), true, NOW(),
            NOW(), NOW()
          )`,
        [cuid(), u.email, passwordHash, u.name, u.plan],
      );
      console.log(`  + created   ${u.email.padEnd(22)} plan=${u.plan}`);
    }
  }

  // Verify
  const verify = await client.query<{ email: string; plan: string; emailVerified: boolean }>(
    `SELECT email, plan, "emailVerified"
       FROM "User"
       WHERE email = ANY($1::text[])
       ORDER BY plan`,
    [USERS.map(u => u.email)],
  );
  console.log('\nFinal state:');
  for (const row of verify.rows) {
    console.log(`  ${row.email.padEnd(22)} plan=${row.plan.padEnd(8)} verified=${row.emailVerified}`);
  }

  await client.end();
  console.log('\nLogin password for all three: ' + PASSWORD);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
