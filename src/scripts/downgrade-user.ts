import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const USER_EMAIL = 'marwaneakchar9@gmail.com';

async function main() {
  console.log(`Setting user ${USER_EMAIL} plan to FREE...`);
  
  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
  });

  if (!user) {
    console.error(`User ${USER_EMAIL} not found.`);
    return;
  }

  const result = await prisma.user.update({
    where: { id: user.id },
    data: { plan: 'FREE' }
  });

  console.log(`Successfully updated ${result.email}. New plan: ${result.plan}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
