import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const USER_EMAIL = 'marwaneakchar9@gmail.com';

const SAMPLE_DATA = {
  income: 4500,
  savingsTarget: 500,
  bills: [
    { name: 'Rent', cat: 'Rent / Mortgage', amount: 1500, dueDay: 1 },
    { name: 'Electricity', cat: 'Utilities', amount: 120, dueDay: 15 },
    { name: 'Netflix', cat: 'Subscriptions', amount: 15, dueDay: 10 },
    { name: 'Gym', cat: 'Subscriptions', amount: 40, dueDay: 5 },
  ],
  variableExpenses: [
    { cat: 'Groceries', min: 50, max: 150, frequency: 4 }, // per month
    { cat: 'Dining Out', min: 20, max: 80, frequency: 6 },
    { cat: 'Gas', min: 40, max: 60, frequency: 2 },
    { cat: 'Coffee', min: 5, max: 10, frequency: 10 },
  ]
};

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
  });

  if (!user) {
    console.error(`User ${USER_EMAIL} not found.`);
    return;
  }

  console.log(`Cleaning up data for user: ${USER_EMAIL}...`);
  
  // Delete existing related data
  await prisma.expense.deleteMany({ where: { userId: user.id } });
  await prisma.income.deleteMany({ where: { userId: user.id } });
  await prisma.budgetMonth.deleteMany({ where: { userId: user.id } });
  await prisma.savingsGoal.deleteMany({ where: { userId: user.id } });
  await prisma.debt.deleteMany({ where: { userId: user.id } });
  await prisma.recurringBill.deleteMany({ where: { userId: user.id } });

  console.log('Generating 3 months of data...');

  const cats = await prisma.category.findMany({ where: { isSystem: true } });
  const getCatId = (name: string) => cats.find(c => c.name === name)?.id || cats[0].id;

  // Create Recurring Bills (templates)
  for (const b of SAMPLE_DATA.bills) {
    await prisma.recurringBill.create({
      data: {
        userId: user.id,
        name: b.name,
        categoryId: getCatId(b.cat),
        amount: new Prisma.Decimal(b.amount),
        dueDay: b.dueDay,
        frequency: 'MONTHLY',
      }
    });
  }

  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    console.log(`  Seeding ${year}-${month.toString().padStart(2, '0')}...`);

    const budget = await prisma.budgetMonth.create({
      data: {
        userId: user.id,
        year,
        month,
        plannedIncome: new Prisma.Decimal(SAMPLE_DATA.income),
        savingsTarget: new Prisma.Decimal(SAMPLE_DATA.savingsTarget),
      }
    });

    // Add Incomes (2 per month)
    await prisma.income.create({
      data: {
        userId: user.id,
        budgetMonthId: budget.id,
        amount: new Prisma.Decimal(SAMPLE_DATA.income / 2),
        source: 'Main Employer',
        receivedAt: new Date(year, month - 1, 1),
      }
    });
    await prisma.income.create({
      data: {
        userId: user.id,
        budgetMonthId: budget.id,
        amount: new Prisma.Decimal(SAMPLE_DATA.income / 2),
        source: 'Main Employer',
        receivedAt: new Date(year, month - 1, 15),
      }
    });

    // Add Bill Expenses (Fixed)
    for (const b of SAMPLE_DATA.bills) {
      await prisma.expense.create({
        data: {
          userId: user.id,
          budgetMonthId: budget.id,
          categoryId: getCatId(b.cat),
          amount: new Prisma.Decimal(b.amount),
          date: new Date(year, month - 1, b.dueDay),
          note: b.name,
          type: 'FIXED_BILL',
        }
      });
    }

    // Add Variable Expenses
    for (const v of SAMPLE_DATA.variableExpenses) {
      for (let f = 0; f < v.frequency; f++) {
        const amount = Math.random() * (v.max - v.min) + v.min;
        const day = Math.floor(Math.random() * 28) + 1;
        await prisma.expense.create({
          data: {
            userId: user.id,
            budgetMonthId: budget.id,
            categoryId: getCatId(v.cat),
            amount: new Prisma.Decimal(amount.toFixed(2)),
            date: new Date(year, month - 1, day),
            type: 'VARIABLE',
          }
        });
      }
    }
  }

  // Add some goals and debts
  await prisma.savingsGoal.create({
    data: {
      userId: user.id,
      name: 'Emergency Fund',
      type: 'EMERGENCY_FUND',
      targetAmount: new Prisma.Decimal(10000),
      savedAmount: new Prisma.Decimal(2500),
    }
  });

  await prisma.debt.create({
    data: {
      userId: user.id,
      name: 'Student Loan',
      type: 'STUDENT_LOAN',
      totalAmount: new Prisma.Decimal(15000),
      remainingAmount: new Prisma.Decimal(12400),
      interestRate: new Prisma.Decimal(4.5),
      minimumPayment: new Prisma.Decimal(200),
      dueDay: 20,
    }
  });

  console.log('Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
