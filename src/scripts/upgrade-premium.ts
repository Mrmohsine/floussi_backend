import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Searching for users with "9" before the "@" or ending in "9"...');
  
  const users = await prisma.user.findMany();
  const usersToUpdate = users.filter(u => {
    // Check if email ends in 9 (e.g. user9) or username part ends in 9 (e.g. user9@gmail.com)
    const username = u.email.split('@')[0];
    return u.email.endsWith('9') || username.endsWith('9');
  });

  if (usersToUpdate.length === 0) {
    console.log('No users found matching the criteria.');
    return;
  }

  console.log(`Found ${usersToUpdate.length} users. Upgrading to PREMIUM...`);

  for (const user of usersToUpdate) {
    await prisma.user.update({
      where: { id: user.id },
      data: { plan: 'PREMIUM' }
    });
    console.log(` - Updated: ${user.email} (${user.name})`);
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
