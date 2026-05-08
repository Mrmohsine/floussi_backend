import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Renaming "Rent / Mortgage" to "Housing" in the database...');
  
  // 1. Rename the system category
  const systemCat = await prisma.category.findFirst({
    where: { name: 'Rent / Mortgage', isSystem: true }
  });

  if (systemCat) {
    await prisma.category.update({
      where: { id: systemCat.id },
      data: { name: 'Housing' }
    });
    console.log('Updated system category.');
  } else {
    console.log('System category "Rent / Mortgage" not found (maybe already renamed).');
  }

  // 2. Rename any user-specific categories with that name
  const result = await prisma.category.updateMany({
    where: { name: 'Rent / Mortgage' },
    data: { name: 'Housing' }
  });
  
  console.log(`Updated ${result.count} total category records.`);
  
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
