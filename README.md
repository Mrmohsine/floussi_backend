# Paycheck — Backend

Express + TypeScript + Prisma + PostgreSQL.

## Run

```bash
cp .env.example .env             # set DATABASE_URL + JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run seed                     # creates default categories + demo user
npm run dev
```

API on `http://localhost:4000`. Demo creds: `demo@paycheck.app` / `demo1234`.

## API surface

| Method | Path                            | Auth | Notes                        |
|-------:|---------------------------------|:----:|------------------------------|
| POST   | `/api/auth/register`            |      | `{name,email,password,paySchedule?}` |
| POST   | `/api/auth/login`               |      |                              |
| POST   | `/api/auth/logout`              | ✅   | client drops the token       |
| GET    | `/api/auth/me`                  | ✅   |                              |
| PATCH  | `/api/users/me`                 | ✅   | name + paySchedule           |
| GET    | `/api/categories`               | ✅   | system + user-owned          |
| POST   | `/api/categories`               | ✅   |                              |
| GET    | `/api/budgets/summary?year&month` | ✅ | dashboard data               |
| PUT    | `/api/budgets`                  | ✅   | upsert; auto-loads bills     |
| DELETE | `/api/budgets/:id`              | ✅   |                              |
| GET    | `/api/expenses`                 | ✅   | paginated + filterable       |
| POST   | `/api/expenses`                 | ✅   |                              |
| PATCH  | `/api/expenses/:id`             | ✅   |                              |
| DELETE | `/api/expenses/:id`             | ✅   |                              |
| GET    | `/api/savings`                  | ✅   |                              |
| POST   | `/api/savings`                  | ✅   |                              |
| PATCH  | `/api/savings/:id`              | ✅   |                              |
| POST   | `/api/savings/:id/contribute`   | ✅   | `{amount}`                   |
| DELETE | `/api/savings/:id`              | ✅   |                              |
| GET    | `/api/debts`                    | ✅   |                              |
| POST   | `/api/debts`                    | ✅   |                              |
| PATCH  | `/api/debts/:id`                | ✅   |                              |
| POST   | `/api/debts/:id/pay`            | ✅   | `{amount}`                   |
| DELETE | `/api/debts/:id`                | ✅   |                              |
| GET    | `/api/recurring-bills`          | ✅   |                              |
| POST   | `/api/recurring-bills`          | ✅   |                              |
| PATCH  | `/api/recurring-bills/:id`      | ✅   |                              |
| DELETE | `/api/recurring-bills/:id`      | ✅   |                              |
| GET    | `/api/insights?year&month`      | ✅   | rule-based advice            |
