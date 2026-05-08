import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      plan: true
    }
  });

  console.log('All users:');
  users.forEach(u => {
    console.log(` - ${u.email} (${u.name}) [Plan: ${u.plan}]`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
