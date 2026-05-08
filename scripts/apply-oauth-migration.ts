// One-shot script to apply the OAuth migration on Neon, since the
// prisma migrations folder is sqlite-locked from earlier work.
// Idempotent: safe to re-run.
import { Client } from 'pg';
import { env } from '../src/config/env';

async function main() {
  const url = env.DIRECT_URL ?? process.env.DIRECT_URL ?? env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL/DIRECT_URL configured');

  const client = new Client({ connectionString: url });
  await client.connect();

  const stmts: { label: string; sql: string }[] = [
    {
      label: 'passwordHash → nullable',
      sql: 'ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL',
    },
    {
      label: 'add provider column',
      sql: 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "provider" TEXT',
    },
    {
      label: 'add providerSub column',
      sql: 'ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "providerSub" TEXT',
    },
    {
      label: 'unique (provider, providerSub) index',
      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "User_provider_providerSub_key" ON "User"("provider", "providerSub")',
    },
  ];

  for (const { label, sql } of stmts) {
    try {
      await client.query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Postgres is idempotent for IF NOT EXISTS / DROP NOT NULL on already-applied state,
      // but ADD COLUMN without IF NOT EXISTS would throw — ours uses IF NOT EXISTS, so any
      // throw here is a real problem.
      console.log(`  ✗ ${label}: ${msg}`);
      throw err;
    }
  }

  // Verify
  const verify = await client.query(`
    SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'User'
        AND column_name IN ('passwordHash','provider','providerSub')
      ORDER BY column_name
  `);
  console.log('\nVerified columns:');
  for (const row of verify.rows) {
    console.log(`  ${row.column_name.padEnd(15)} nullable=${row.is_nullable}`);
  }

  await client.end();
}

main()
  .then(() => {
    console.log('\nMigration applied.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nMigration failed:', err);
    process.exit(1);
  });
